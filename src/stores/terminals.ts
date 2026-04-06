import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  TerminalInfo,
  TerminalStatus,
  CreateTerminalResult,
  SavedSession,
  SavedLayoutNode,
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
  projectSlug?: string;
  layout: LayoutNode;
}

// --- Helpers ---

let workspaceCounter = 0;

function uuid(): string {
  return crypto.randomUUID();
}

export function collectTerminalIds(node: LayoutNode): string[] {
  if (node.type === 'terminal') return [node.terminalId];
  return [
    ...collectTerminalIds(node.children[0]),
    ...collectTerminalIds(node.children[1]),
  ];
}

// Collect panes in reading order (depth-first, left-to-right)
export function collectPanes(node: LayoutNode): PaneNode[] {
  if (node.type === 'terminal') return [node];
  return [
    ...collectPanes(node.children[0]),
    ...collectPanes(node.children[1]),
  ];
}

// Find the path from root to a pane (list of ancestor nodes + child indices)
function findPanePath(
  node: LayoutNode,
  paneId: string,
  path: Array<{ node: SplitNode; childIndex: 0 | 1 }> = []
): Array<{ node: SplitNode; childIndex: 0 | 1 }> | null {
  if (node.type === 'terminal') {
    return node.id === paneId ? path : null;
  }
  const leftResult = findPanePath(node.children[0], paneId, [
    ...path,
    { node, childIndex: 0 },
  ]);
  if (leftResult) return leftResult;
  return findPanePath(node.children[1], paneId, [
    ...path,
    { node, childIndex: 1 },
  ]);
}

// Get the first or last pane in a subtree
function getEdgePane(node: LayoutNode, side: 'first' | 'last'): PaneNode {
  if (node.type === 'terminal') return node;
  const childIdx = side === 'first' ? 0 : 1;
  return getEdgePane(node.children[childIdx], side);
}

// Direction → compatible split direction + which child to move toward
const DIRECTION_MAP: Record<
  'left' | 'right' | 'up' | 'down',
  { splitDir: 'horizontal' | 'vertical'; fromChild: 0 | 1; enterSide: 'first' | 'last' }
> = {
  left:  { splitDir: 'horizontal', fromChild: 1, enterSide: 'last' },
  right: { splitDir: 'horizontal', fromChild: 0, enterSide: 'first' },
  up:    { splitDir: 'vertical',   fromChild: 1, enterSide: 'last' },
  down:  { splitDir: 'vertical',   fromChild: 0, enterSide: 'first' },
};

// Find adjacent pane in a direction by walking up the tree
export function findAdjacentPane(
  layout: LayoutNode,
  currentPaneId: string,
  direction: 'left' | 'right' | 'up' | 'down'
): string | null {
  const path = findPanePath(layout, currentPaneId);
  if (!path) return null;

  const { splitDir, fromChild, enterSide } = DIRECTION_MAP[direction];

  // Walk up the path to find a compatible split where we came from the right child
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i];
    if (step.node.direction === splitDir && step.childIndex === fromChild) {
      // Move to the sibling subtree
      const siblingIndex = (1 - fromChild) as 0 | 1;
      const sibling = step.node.children[siblingIndex];
      const target = getEdgePane(sibling, enterSide);
      return target.id;
    }
  }

  return null; // At the edge of the layout
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

export function findPaneTerminalId(
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
  focusedPaneId: string | null;
  focusedPanePerWorkspace: Record<string, string>;
  terminals: Record<string, TerminalInfo>;
  lastActivity: Record<string, number>;
  alertingTerminalIds: string[];
  claudeTitles: Record<string, string>;
  lastDoneTimestamp: Record<string, number>;

  setFocusedPaneId: (paneId: string) => void;

  createWorkspace: (name?: string, color?: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; projectSlug?: string }) => Promise<string>;
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
    status: TerminalStatus,
    exitCode?: number
  ) => void;
  updateLastActivity: (terminalId: string) => void;
  removeTerminal: (terminalId: string) => void;

  addAlert: (terminalId: string) => void;
  clearAlert: (terminalId: string) => void;
  clearAlertsForTerminals: (ids: string[]) => void;
  updateClaudeTitle: (terminalId: string, title: string) => void;
  isAlerting: (terminalId: string) => boolean;

  activeWorkspace: () => Workspace | undefined;
  terminalCount: () => number;

  restoreSession: (session: SavedSession) => Promise<void>;
}

// Cache for the OS default shell (resolved once from backend)
let _defaultShell: string | null = null;
async function getDefaultShell(): Promise<string> {
  if (!_defaultShell) {
    _defaultShell = await invoke<string>('get_default_shell');
  }
  return _defaultShell;
}

export const useTerminalsStore = create<TerminalsState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  focusedPaneId: null,
  focusedPanePerWorkspace: {},
  terminals: {},
  lastActivity: {},
  alertingTerminalIds: [],
  claudeTitles: {},
  lastDoneTimestamp: {},

  setFocusedPaneId: (paneId: string) => {
    set((s) => {
      const update: Partial<TerminalsState> = { focusedPaneId: paneId };
      if (s.activeWorkspaceId) {
        update.focusedPanePerWorkspace = {
          ...s.focusedPanePerWorkspace,
          [s.activeWorkspaceId]: paneId,
        };
      }
      return update as TerminalsState;
    });
  },

  createWorkspace: async (name?: string, color?: string, opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; projectSlug?: string }) => {
    const wsId = uuid();
    workspaceCounter++;
    const wsName = name || `Terminal ${workspaceCounter}`;
    const ds = await getDefaultShell();

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

    const now = Date.now();

    const info: TerminalInfo = {
      id: result.id,
      shell: opts?.shell || ds,
      cwd: opts?.cwd || null,
      cols,
      rows,
      status: 'running',
      created_at: now,
      exit_code: null,
    };

    const workspace: Workspace = {
      id: wsId,
      name: wsName,
      color,
      projectSlug: opts?.projectSlug,
      layout: pane,
    };

    set((s) => ({
      workspaces: [...s.workspaces, workspace],
      activeWorkspaceId: wsId,
      focusedPaneId: pane.id,
      focusedPanePerWorkspace: { ...s.focusedPanePerWorkspace, [wsId]: pane.id },
      terminals: { ...s.terminals, [result.id]: info },
      lastActivity: { ...s.lastActivity, [result.id]: now },
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
      const newClaudeTitles = { ...s.claudeTitles };
      const newLastDone = { ...s.lastDoneTimestamp };
      terminalIds.forEach((id) => {
        delete newTerminals[id];
        delete newClaudeTitles[id];
        delete newLastDone[id];
      });

      let newActive = s.activeWorkspaceId;
      if (newActive === workspaceId) {
        newActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }

      // Clean up focus for removed workspace
      const newFocusPerWs = { ...s.focusedPanePerWorkspace };
      delete newFocusPerWs[workspaceId];

      // Restore focus for new active workspace
      let newFocusedPaneId: string | null = null;
      if (newActive) {
        const nextWs = remaining.find((w) => w.id === newActive);
        if (nextWs) {
          newFocusedPaneId = newFocusPerWs[newActive] ?? collectPanes(nextWs.layout)[0]?.id ?? null;
        }
      }

      return {
        workspaces: remaining,
        activeWorkspaceId: newActive,
        focusedPaneId: newFocusedPaneId,
        focusedPanePerWorkspace: newFocusPerWs,
        terminals: newTerminals,
        alertingTerminalIds: s.alertingTerminalIds.filter((id) => !terminalIds.includes(id)),
        claudeTitles: newClaudeTitles,
        lastDoneTimestamp: newLastDone,
      };
    });
  },

  setActiveWorkspace: (workspaceId: string) => {
    set((s) => {
      const savedPaneId = s.focusedPanePerWorkspace[workspaceId] ?? null;
      // If saved pane no longer exists, fall back to first pane
      let focusedPaneId: string | null = savedPaneId;
      if (!focusedPaneId) {
        const ws = s.workspaces.find((w) => w.id === workspaceId);
        if (ws) {
          const panes = collectPanes(ws.layout);
          focusedPaneId = panes.length > 0 ? panes[0].id : null;
        }
      }
      return { activeWorkspaceId: workspaceId, focusedPaneId };
    });
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

    const ds = await getDefaultShell();
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

    const now = Date.now();

    const info: TerminalInfo = {
      id: result.id,
      shell: opts?.shell || ds,
      cwd: opts?.cwd || null,
      cols,
      rows,
      status: 'running',
      created_at: now,
      exit_code: null,
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
        lastActivity: { ...s.lastActivity, [result.id]: now },
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
      lastActivity: { ...s.lastActivity, [result.id]: now },
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

    const ds = await getDefaultShell();

    const result = await invoke<CreateTerminalResult>('create_terminal', {
      params: { cols: 80, rows: 24 },
    });

    const newPane: PaneNode = {
      id: uuid(),
      type: 'terminal',
      terminalId: result.id,
    };

    const now = Date.now();

    const info: TerminalInfo = {
      id: result.id,
      shell: ds,
      cwd: null,
      cols: 80,
      rows: 24,
      status: 'running',
      created_at: now,
      exit_code: null,
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
      lastActivity: { ...s.lastActivity, [result.id]: now },
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
        const newClaudeTitles = { ...s.claudeTitles };
        const newLastDone = { ...s.lastDoneTimestamp };
        if (terminalId) {
          delete newTerminals[terminalId];
          delete newClaudeTitles[terminalId];
          delete newLastDone[terminalId];
        }

        let newActive = s.activeWorkspaceId;
        if (newActive === workspaceId) {
          newActive =
            remaining.length > 0
              ? remaining[remaining.length - 1].id
              : null;
        }

        // Clean up focus for removed workspace
        const newFocusPerWs = { ...s.focusedPanePerWorkspace };
        delete newFocusPerWs[workspaceId];

        // Focus first pane of the new active workspace
        let newFocusedPaneId: string | null = null;
        if (newActive) {
          const nextWs = remaining.find((w) => w.id === newActive);
          if (nextWs) {
            newFocusedPaneId = newFocusPerWs[newActive] ?? collectPanes(nextWs.layout)[0]?.id ?? null;
          }
        }

        return {
          workspaces: remaining,
          activeWorkspaceId: newActive,
          focusedPaneId: newFocusedPaneId,
          focusedPanePerWorkspace: newFocusPerWs,
          terminals: newTerminals,
          alertingTerminalIds: terminalId
            ? s.alertingTerminalIds.filter((id) => id !== terminalId)
            : s.alertingTerminalIds,
          claudeTitles: newClaudeTitles,
          lastDoneTimestamp: newLastDone,
        };
      });
    } else {
      set((s) => {
        const newTerminals = { ...s.terminals };
        const newClaudeTitles = { ...s.claudeTitles };
        const newLastDone = { ...s.lastDoneTimestamp };
        if (terminalId) {
          delete newTerminals[terminalId];
          delete newClaudeTitles[terminalId];
          delete newLastDone[terminalId];
        }

        // If closed pane was focused, move focus to first remaining pane
        let newFocusedPaneId = s.focusedPaneId;
        const newFocusPerWs = { ...s.focusedPanePerWorkspace };
        if (s.focusedPaneId === paneId) {
          const remainingPanes = collectPanes(newLayout);
          newFocusedPaneId = remainingPanes.length > 0 ? remainingPanes[0].id : null;
          if (newFocusedPaneId) {
            newFocusPerWs[workspaceId] = newFocusedPaneId;
          }
        }

        return {
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId ? { ...w, layout: newLayout } : w
          ),
          focusedPaneId: newFocusedPaneId,
          focusedPanePerWorkspace: newFocusPerWs,
          terminals: newTerminals,
          alertingTerminalIds: terminalId
            ? s.alertingTerminalIds.filter((id) => id !== terminalId)
            : s.alertingTerminalIds,
          claudeTitles: newClaudeTitles,
          lastDoneTimestamp: newLastDone,
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

  updateTerminalStatus: (terminalId: string, status: TerminalStatus, exitCode?: number) => {
    set((s) => {
      const terminal = s.terminals[terminalId];
      if (!terminal) return s;
      return {
        terminals: {
          ...s.terminals,
          [terminalId]: {
            ...terminal,
            status,
            exit_code: exitCode !== undefined ? exitCode : terminal.exit_code,
          },
        },
      };
    });
  },

  updateLastActivity: (terminalId: string) => {
    set((s) => ({
      lastActivity: { ...s.lastActivity, [terminalId]: Date.now() },
    }));
  },

  removeTerminal: (terminalId: string) => {
    set((s) => {
      const newTerminals = { ...s.terminals };
      delete newTerminals[terminalId];
      const newLastActivity = { ...s.lastActivity };
      delete newLastActivity[terminalId];
      return { terminals: newTerminals, lastActivity: newLastActivity };
    });
  },

  addAlert: (terminalId: string) => {
    set((s) => {
      if (s.alertingTerminalIds.includes(terminalId)) return s;
      return { alertingTerminalIds: [...s.alertingTerminalIds, terminalId] };
    });
  },

  clearAlert: (terminalId: string) => {
    set((s) => ({
      alertingTerminalIds: s.alertingTerminalIds.filter((id) => id !== terminalId),
    }));
  },

  clearAlertsForTerminals: (ids: string[]) => {
    set((s) => ({
      alertingTerminalIds: s.alertingTerminalIds.filter((id) => !ids.includes(id)),
    }));
  },

  updateClaudeTitle: (terminalId: string, title: string) => {
    set((s) => ({
      claudeTitles: { ...s.claudeTitles, [terminalId]: title },
    }));
  },

  isAlerting: (terminalId: string) => {
    return get().alertingTerminalIds.includes(terminalId);
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

  restoreSession: async (session: SavedSession) => {
    const restoredWorkspaces: Workspace[] = [];
    const restoredTerminals: Record<string, TerminalInfo> = {};
    const restoredActivity: Record<string, number> = {};
    const ds = await getDefaultShell();

    async function rebuildLayout(
      saved: SavedLayoutNode
    ): Promise<LayoutNode | null> {
      if (saved.type === 'terminal') {
        try {
          const result = await invoke<CreateTerminalResult>(
            'create_terminal',
            {
              params: {
                shell: saved.shell,
                cwd: saved.cwd,
                cols: 120,
                rows: 30,
              },
            }
          );
          const now = Date.now();
          restoredTerminals[result.id] = {
            id: result.id,
            shell: saved.shell ?? ds,
            cwd: saved.cwd ?? null,
            cols: 120,
            rows: 30,
            status: 'running',
            created_at: now,
            exit_code: null,
          };
          restoredActivity[result.id] = now;
          return {
            id: uuid(),
            type: 'terminal',
            terminalId: result.id,
          };
        } catch (e) {
          console.error('Failed to create terminal during restore:', e);
          return null;
        }
      }

      // Split: rebuild both children
      const [left, right] = await Promise.all([
        rebuildLayout(saved.children[0]),
        rebuildLayout(saved.children[1]),
      ]);

      // If both children failed, skip this split
      if (left === null && right === null) return null;
      // If one child failed, return the other directly
      if (left === null) return right;
      if (right === null) return left;

      return {
        id: uuid(),
        type: 'split' as const,
        direction: saved.direction as 'horizontal' | 'vertical',
        ratio: saved.ratio,
        children: [left, right],
      };
    }

    for (const savedWs of session.workspaces) {
      try {
        const layout = await rebuildLayout(savedWs.layout);
        if (layout === null) continue;

        workspaceCounter++;
        restoredWorkspaces.push({
          id: uuid(),
          name: savedWs.name || `Terminal ${workspaceCounter}`,
          color: savedWs.color ?? undefined,
          projectSlug: savedWs.project_slug ?? undefined,
          layout,
        });
      } catch (e) {
        console.error(
          `Failed to restore workspace '${savedWs.name}':`,
          e
        );
      }
    }

    if (restoredWorkspaces.length === 0) return;

    const activeIndex = Math.min(
      session.active_workspace_index,
      restoredWorkspaces.length - 1
    );

    // Initialize focus on first pane of active workspace
    const activeWs = restoredWorkspaces[activeIndex];
    const firstPane = collectPanes(activeWs.layout)[0] ?? null;

    set({
      workspaces: restoredWorkspaces,
      activeWorkspaceId: activeWs.id,
      focusedPaneId: firstPane?.id ?? null,
      focusedPanePerWorkspace: firstPane ? { [activeWs.id]: firstPane.id } : {},
      terminals: restoredTerminals,
      lastActivity: restoredActivity,
      alertingTerminalIds: [],
      claudeTitles: {},
      lastDoneTimestamp: {},
    });
  },
}));

// --- Session snapshot (standalone, reads store state) ---

export function buildSessionSnapshot(): SavedSession | null {
  const { workspaces, activeWorkspaceId, terminals } =
    useTerminalsStore.getState();
  if (workspaces.length === 0) return null;

  // Filter out workspaces where all terminals have exited
  const liveWorkspaces = workspaces.filter((ws) => {
    const ids = collectTerminalIds(ws.layout);
    return ids.some((id) => terminals[id]?.status === 'running');
  });

  if (liveWorkspaces.length === 0) return null;

  const activeIndex = liveWorkspaces.findIndex(
    (w) => w.id === activeWorkspaceId
  );

  function serializeLayout(node: LayoutNode): SavedLayoutNode {
    if (node.type === 'terminal') {
      const info = terminals[node.terminalId];
      return {
        type: 'terminal',
        shell: info?.shell ?? _defaultShell ?? 'shell',
        cwd: info?.cwd ?? null,
      };
    }
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      children: [
        serializeLayout(node.children[0]),
        serializeLayout(node.children[1]),
      ],
    };
  }

  return {
    version: 1,
    saved_at: new Date().toISOString(),
    active_workspace_index: Math.max(0, activeIndex),
    workspaces: liveWorkspaces.map((ws) => ({
      name: ws.name,
      color: ws.color ?? null,
      project_slug: ws.projectSlug ?? null,
      layout: serializeLayout(ws.layout),
    })),
  };
}
