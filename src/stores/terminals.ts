import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  TerminalInfo,
  TerminalStatus,
  CreateTerminalResult,
} from '../types/ipc';

// --- Layout tree types ---

export interface PaneNode {
  id: string;
  type: 'terminal';
  terminalId: string;
}

export interface SplitNode {
  id: string;
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: [LayoutNode, LayoutNode];
  ratio: number;
}

export type LayoutNode = PaneNode | SplitNode;

export interface Workspace {
  id: string;
  name: string;
  color?: string;
  layout: LayoutNode;
}

// --- Helpers ---

let workspaceCounter = 0;

function uuid(): string {
  return crypto.randomUUID();
}

function collectTerminalIds(node: LayoutNode): string[] {
  if (node.type === 'terminal') return [node.terminalId];
  return [
    ...collectTerminalIds(node.children[0]),
    ...collectTerminalIds(node.children[1]),
  ];
}

function removePaneFromTree(
  node: LayoutNode,
  paneId: string
): LayoutNode | null {
  if (node.type === 'terminal') {
    return node.id === paneId ? null : node;
  }

  const left = removePaneFromTree(node.children[0], paneId);
  const right = removePaneFromTree(node.children[1], paneId);

  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;

  return { ...node, children: [left, right] };
}

function replacePaneInTree(
  node: LayoutNode,
  paneId: string,
  replacement: LayoutNode
): LayoutNode {
  if (node.type === 'terminal') {
    return node.id === paneId ? replacement : node;
  }

  return {
    ...node,
    children: [
      replacePaneInTree(node.children[0], paneId, replacement),
      replacePaneInTree(node.children[1], paneId, replacement),
    ],
  };
}

function updateSplitRatio(
  node: LayoutNode,
  splitId: string,
  ratio: number
): LayoutNode {
  if (node.type === 'terminal') return node;
  if (node.id === splitId) return { ...node, ratio };

  return {
    ...node,
    children: [
      updateSplitRatio(node.children[0], splitId, ratio),
      updateSplitRatio(node.children[1], splitId, ratio),
    ],
  };
}

function findPaneTerminalId(
  node: LayoutNode,
  paneId: string
): string | null {
  if (node.type === 'terminal') {
    return node.id === paneId ? node.terminalId : null;
  }
  return (
    findPaneTerminalId(node.children[0], paneId) ??
    findPaneTerminalId(node.children[1], paneId)
  );
}

// --- Store ---

interface TerminalsState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  terminals: Record<string, TerminalInfo>;

  createWorkspace: (name?: string, color?: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }) => Promise<string>;
  closeWorkspace: (workspaceId: string) => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => void;
  renameWorkspace: (workspaceId: string, name: string) => void;

  createTerminalInWorkspace: (
    workspaceId: string,
    opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; direction?: 'horizontal' | 'vertical' }
  ) => Promise<string>;
  splitPane: (
    workspaceId: string,
    paneId: string,
    direction: 'horizontal' | 'vertical'
  ) => Promise<void>;
  closePane: (workspaceId: string, paneId: string) => Promise<void>;
  resizeSplit: (
    workspaceId: string,
    splitId: string,
    ratio: number
  ) => void;

  updateTerminalStatus: (
    terminalId: string,
    status: TerminalStatus
  ) => void;
  removeTerminal: (terminalId: string) => void;

  activeWorkspace: () => Workspace | undefined;
  terminalCount: () => number;
}

export const useTerminalsStore = create<TerminalsState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  terminals: {},

  createWorkspace: async (name?: string, color?: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }) => {
    const wsId = uuid();
    workspaceCounter++;
    const wsName = name || `Terminal ${workspaceCounter}`;

    const result = await invoke<CreateTerminalResult>('create_terminal', {
      params: { shell: opts?.shell, cwd: opts?.cwd, cols: opts?.cols ?? 80, rows: opts?.rows ?? 24 },
    });

    const cols = opts?.cols ?? 120;
    const rows = opts?.rows ?? 30;

    const pane: PaneNode = {
      id: uuid(),
      type: 'terminal',
      terminalId: result.id,
    };

    const info: TerminalInfo = {
      id: result.id,
      shell: opts?.shell || 'pwsh.exe',
      cwd: opts?.cwd || null,
      cols,
      rows,
      status: 'running',
    };

    const workspace: Workspace = {
      id: wsId,
      name: wsName,
      color,
      layout: pane,
    };

    set((s) => ({
      workspaces: [...s.workspaces, workspace],
      activeWorkspaceId: wsId,
      terminals: { ...s.terminals, [result.id]: info },
    }));

    return wsId;
  },

  closeWorkspace: async (workspaceId: string) => {
    const state = get();
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;

    const terminalIds = collectTerminalIds(ws.layout);
    await Promise.all(
      terminalIds.map((id) =>
        invoke('close_terminal', { params: { id } }).catch(() => {})
      )
    );

    set((s) => {
      const remaining = s.workspaces.filter((w) => w.id !== workspaceId);
      const newTerminals = { ...s.terminals };
      terminalIds.forEach((id) => delete newTerminals[id]);

      let newActive = s.activeWorkspaceId;
      if (newActive === workspaceId) {
        newActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }

      return {
        workspaces: remaining,
        activeWorkspaceId: newActive,
        terminals: newTerminals,
      };
    });
  },

  setActiveWorkspace: (workspaceId: string) => {
    set({ activeWorkspaceId: workspaceId });
  },

  renameWorkspace: (workspaceId: string, name: string) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, name } : w
      ),
    }));
  },

  createTerminalInWorkspace: async (
    workspaceId: string,
    opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; direction?: 'horizontal' | 'vertical' }
  ) => {
    const state = get();
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return '';

    const cols = opts?.cols ?? 120;
    const rows = opts?.rows ?? 30;

    const result = await invoke<CreateTerminalResult>('create_terminal', {
      params: {
        shell: opts?.shell,
        cwd: opts?.cwd,
        cols,
        rows,
      },
    });

    const info: TerminalInfo = {
      id: result.id,
      shell: opts?.shell || 'pwsh.exe',
      cwd: opts?.cwd || null,
      cols,
      rows,
      status: 'running',
    };

    const newPane: PaneNode = {
      id: uuid(),
      type: 'terminal',
      terminalId: result.id,
    };

    // Find the rightmost/bottom pane to split
    const findLastPane = (node: LayoutNode): string => {
      if (node.type === 'terminal') return node.id;
      return findLastPane(node.children[1]);
    };
    const lastPaneId = findLastPane(ws.layout);
    const direction = opts?.direction || 'horizontal';

    const existingTerminalId = findPaneTerminalId(ws.layout, lastPaneId);
    if (existingTerminalId === null) {
      set((s) => ({
        terminals: { ...s.terminals, [result.id]: info },
      }));
      return result.id;
    }

    const oldPaneNode: PaneNode = {
      id: lastPaneId,
      type: 'terminal',
      terminalId: existingTerminalId,
    };

    const splitNode: SplitNode = {
      id: uuid(),
      type: 'split',
      direction,
      children: [oldPaneNode, newPane],
      ratio: 0.5,
    };

    const newLayout = replacePaneInTree(ws.layout, lastPaneId, splitNode);

    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, layout: newLayout } : w
      ),
      terminals: { ...s.terminals, [result.id]: info },
    }));

    return result.id;
  },

  splitPane: async (
    workspaceId: string,
    paneId: string,
    direction: 'horizontal' | 'vertical'
  ) => {
    const state = get();
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;

    const result = await invoke<CreateTerminalResult>('create_terminal', {
      params: { cols: 80, rows: 24 },
    });

    const newPane: PaneNode = {
      id: uuid(),
      type: 'terminal',
      terminalId: result.id,
    };

    const info: TerminalInfo = {
      id: result.id,
      shell: 'pwsh.exe',
      cwd: null,
      cols: 80,
      rows: 24,
      status: 'running',
    };

    const existingPane = findPaneTerminalId(ws.layout, paneId);
    if (existingPane === null) return;

    const oldPaneNode: PaneNode = {
      id: paneId,
      type: 'terminal',
      terminalId: existingPane,
    };

    const splitNode: SplitNode = {
      id: uuid(),
      type: 'split',
      direction,
      children: [oldPaneNode, newPane],
      ratio: 0.5,
    };

    const newLayout = replacePaneInTree(ws.layout, paneId, splitNode);

    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, layout: newLayout } : w
      ),
      terminals: { ...s.terminals, [result.id]: info },
    }));
  },

  closePane: async (workspaceId: string, paneId: string) => {
    const state = get();
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;

    const terminalId = findPaneTerminalId(ws.layout, paneId);
    if (terminalId) {
      await invoke('close_terminal', { params: { id: terminalId } }).catch(
        () => {}
      );
    }

    const newLayout = removePaneFromTree(ws.layout, paneId);

    if (newLayout === null) {
      // Last pane closed — close workspace
      set((s) => {
        const remaining = s.workspaces.filter((w) => w.id !== workspaceId);
        const newTerminals = { ...s.terminals };
        if (terminalId) delete newTerminals[terminalId];

        let newActive = s.activeWorkspaceId;
        if (newActive === workspaceId) {
          newActive =
            remaining.length > 0
              ? remaining[remaining.length - 1].id
              : null;
        }

        return {
          workspaces: remaining,
          activeWorkspaceId: newActive,
          terminals: newTerminals,
        };
      });
    } else {
      set((s) => {
        const newTerminals = { ...s.terminals };
        if (terminalId) delete newTerminals[terminalId];

        return {
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId ? { ...w, layout: newLayout } : w
          ),
          terminals: newTerminals,
        };
      });
    }
  },

  resizeSplit: (workspaceId: string, splitId: string, ratio: number) => {
    const clamped = Math.min(0.85, Math.max(0.15, ratio));
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, layout: updateSplitRatio(w.layout, splitId, clamped) }
          : w
      ),
    }));
  },

  updateTerminalStatus: (terminalId: string, status: TerminalStatus) => {
    set((s) => {
      const terminal = s.terminals[terminalId];
      if (!terminal) return s;
      return {
        terminals: {
          ...s.terminals,
          [terminalId]: { ...terminal, status },
        },
      };
    });
  },

  removeTerminal: (terminalId: string) => {
    set((s) => {
      const newTerminals = { ...s.terminals };
      delete newTerminals[terminalId];
      return { terminals: newTerminals };
    });
  },

  activeWorkspace: () => {
    const { workspaces, activeWorkspaceId } = get();
    return workspaces.find((w) => w.id === activeWorkspaceId);
  },

  terminalCount: () => {
    const { terminals } = get();
    return Object.values(terminals).filter((t) => t.status === 'running')
      .length;
  },
}));
