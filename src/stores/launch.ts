import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalsStore } from './terminals';
import type { LayoutNode, PaneNode, SplitNode } from './terminals';
import type { ConfigData, CreateTerminalResult, ScannedProject, TerminalInfo } from '../types/ipc';

const SHELL_READY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRatio(splitDef: string): number {
  const match = splitDef.match(/\((\d+)%\)/);
  return match ? parseInt(match[1], 10) / 100 : 0.5;
}

/**
 * Build a layout tree from splits definitions and pane nodes.
 * Splits DSL:
 *   H          = horizontal split (side by side)
 *   V / V(N%)  = vertical split (top/bottom) with optional ratio
 *   focus-N    = subsequent splits target pane N
 */
function buildLayoutTree(splits: string[], panes: PaneNode[]): LayoutNode {
  if (panes.length === 0) throw new Error('No panes');
  if (panes.length === 1) return panes[0];

  // Filter real splits (non-focus directives)
  const realSplits = splits.filter((s) => !s.startsWith('focus'));

  // Simple case: all H splits → chain of horizontal splits
  if (realSplits.every((s) => s === 'H')) {
    let tree: LayoutNode = panes[0];
    for (let i = 1; i < panes.length; i++) {
      tree = {
        id: crypto.randomUUID(),
        type: 'split',
        direction: 'horizontal',
        children: [tree, panes[i]],
        ratio: i / (i + 1), // distribute space evenly
      } as SplitNode;
    }
    return tree;
  }

  // main-plus-stack: V(N%), H → left pane spanning full height, right side split horizontally
  if (
    realSplits.length === 2 &&
    realSplits[0].startsWith('V') &&
    realSplits[1] === 'H' &&
    panes.length === 3
  ) {
    const ratio = parseRatio(realSplits[0]);
    const rightSplit: SplitNode = {
      id: crypto.randomUUID(),
      type: 'split',
      direction: 'vertical',
      children: [panes[1], panes[2]],
      ratio: 0.5,
    };
    return {
      id: crypto.randomUUID(),
      type: 'split',
      direction: 'horizontal',
      children: [panes[0], rightSplit],
      ratio,
    } as SplitNode;
  }

  // grid-2x2: H, focus-0, V, focus-1, V → 2 columns, each split vertically
  if (
    panes.length === 4 &&
    splits.length >= 5 &&
    splits[0] === 'H' &&
    splits[1] === 'focus-0' &&
    splits[2] === 'V' &&
    splits[3] === 'focus-1' &&
    splits[4] === 'V'
  ) {
    const leftSplit: SplitNode = {
      id: crypto.randomUUID(),
      type: 'split',
      direction: 'vertical',
      children: [panes[0], panes[2]],
      ratio: 0.5,
    };
    const rightSplit: SplitNode = {
      id: crypto.randomUUID(),
      type: 'split',
      direction: 'vertical',
      children: [panes[1], panes[3]],
      ratio: 0.5,
    };
    return {
      id: crypto.randomUUID(),
      type: 'split',
      direction: 'horizontal',
      children: [leftSplit, rightSplit],
      ratio: 0.5,
    } as SplitNode;
  }

  // Simple 2-pane V or V(N%)
  if (realSplits.length === 1 && realSplits[0].startsWith('V') && panes.length === 2) {
    const ratio = parseRatio(realSplits[0]);
    return {
      id: crypto.randomUUID(),
      type: 'split',
      direction: 'horizontal',
      children: [panes[0], panes[1]],
      ratio,
    } as SplitNode;
  }

  // Fallback: chain splits sequentially
  let tree: LayoutNode = panes[0];
  for (let i = 1; i < panes.length; i++) {
    const splitDef = realSplits[i - 1] ?? 'H';
    const direction = splitDef.startsWith('V') ? 'horizontal' as const : 'vertical' as const;
    const ratio = parseRatio(splitDef);
    tree = {
      id: crypto.randomUUID(),
      type: 'split',
      direction,
      children: [tree, panes[i]],
      ratio,
    } as SplitNode;
  }
  return tree;
}

interface LaunchState {
  launching: boolean;
  error: string | null;

  launchPreset: (
    presetSlug: string,
    focusProjectSlug: string | null,
    config: ConfigData,
    scannedProjects: ScannedProject[],
  ) => Promise<string>;
}

export const useLaunchStore = create<LaunchState>((set) => ({
  launching: false,
  error: null,

  launchPreset: async (
    presetSlug: string,
    focusProjectSlug: string | null,
    config: ConfigData,
    scannedProjects: ScannedProject[],
  ): Promise<string> => {
    const preset = config.presets[presetSlug];
    if (!preset) {
      throw new Error(`Preset '${presetSlug}' introuvable`);
    }

    // Guard: {{auto}} panels require a focus project
    const hasAuto = preset.panels.some(
      (p) => !p.project || p.project === '{{auto}}'
    );
    if (hasAuto && !focusProjectSlug) {
      throw new Error(
        'Un projet cible est requis pour les panneaux {{auto}}'
      );
    }

    set({ launching: true, error: null });

    const {
      setActiveWorkspace,
    } = useTerminalsStore.getState();

    try {
      // Resolve panels
      const resolvedPanels = preset.panels.map((panel) => {
        const isAuto = !panel.project || panel.project === '{{auto}}';
        const resolvedSlug = isAuto ? focusProjectSlug : panel.project;
        const project = resolvedSlug
          ? config.projects[resolvedSlug]
          : undefined;
        const scanned = resolvedSlug
          ? scannedProjects.find((sp) => sp.slug === resolvedSlug)
          : undefined;

        const cwd = project?.path ?? scanned?.path;
        const shell =
          panel.command ??
          project?.default_command ??
          scanned?.default_command ??
          'pwsh';

        return { cwd, shell, projectSlug: resolvedSlug ?? undefined };
      });

      // Build project slugs array for IPC
      const projectSlugs = resolvedPanels.map(
        (p) => p.projectSlug ?? null
      );

      // Resolve initial commands via Rust backend
      let initialCommands: (string | null)[] = [];
      try {
        initialCommands = await invoke<(string | null)[]>(
          'resolve_initial_commands',
          { presetSlug, projectSlugs }
        );
      } catch (e) {
        console.error('Failed to resolve initial commands:', e);
        // Non-blocking: continue without initial commands
        initialCommands = resolvedPanels.map(() => null);
      }

      // Determine workspace name and color
      const layout = config.layouts[preset.layout];
      const splits = layout?.splits ?? [];

      const wsName = focusProjectSlug
        ? (config.projects[focusProjectSlug]?.name ?? preset.name)
        : preset.name;
      const wsColor = focusProjectSlug
        ? config.projects[focusProjectSlug]?.color
        : undefined;

      // Create all terminals via IPC
      const terminalIds: string[] = [];
      const paneNodes: PaneNode[] = [];
      const terminalInfos: Record<string, TerminalInfo> = {};
      const now = Date.now();

      for (let i = 0; i < resolvedPanels.length; i++) {
        const p = resolvedPanels[i];
        try {
          const result = await invoke<CreateTerminalResult>('create_terminal', {
            params: {
              shell: p.shell,
              cwd: p.cwd,
              cols: 120,
              rows: 30,
            },
          });
          terminalIds.push(result.id);

          const pane: PaneNode = {
            id: crypto.randomUUID(),
            type: 'terminal',
            terminalId: result.id,
          };
          paneNodes.push(pane);

          terminalInfos[result.id] = {
            id: result.id,
            shell: p.shell || 'pwsh.exe',
            cwd: p.cwd || null,
            cols: 120,
            rows: 30,
            status: 'running',
            created_at: now,
            exit_code: null,
          };
        } catch (e) {
          console.error(`Failed to create terminal for panel ${i}:`, e);
        }
      }

      // Build the correct layout tree from splits definitions
      const layoutTree = buildLayoutTree(splits, paneNodes);

      // Create workspace with pre-built layout
      const wsId = crypto.randomUUID();
      const workspace = {
        id: wsId,
        name: wsName,
        color: wsColor,
        projectSlug: focusProjectSlug ?? undefined,
        layout: layoutTree,
      };

      const lastActivityMap: Record<string, number> = {};
      for (const tid of terminalIds) {
        lastActivityMap[tid] = now;
      }

      useTerminalsStore.setState((s) => ({
        workspaces: [...s.workspaces, workspace],
        activeWorkspaceId: wsId,
        focusedPaneId: paneNodes[0]?.id ?? null,
        focusedPanePerWorkspace: {
          ...s.focusedPanePerWorkspace,
          [wsId]: paneNodes[0]?.id ?? '',
        },
        terminals: { ...s.terminals, ...terminalInfos },
        lastActivity: { ...s.lastActivity, ...lastActivityMap },
      }));

      // Activate workspace immediately (before command injection)
      setActiveWorkspace(wsId);

      // Track launch in history (fire-and-forget)
      invoke('add_history_entry', {
        entry: {
          timestamp: new Date().toISOString().slice(0, 19),
          preset: presetSlug,
          projects: projectSlugs.filter(Boolean),
          branches: {},
          layout: preset.layout,
        },
      }).catch((e: unknown) => {
        console.error('Failed to track launch in history:', e);
      });

      // Inject initial commands (non-blocking for UI)
      for (let i = 0; i < terminalIds.length; i++) {
        const cmd = initialCommands[i];
        if (cmd) {
          delay(SHELL_READY_DELAY_MS).then(() => {
            invoke('write_terminal', {
              params: { id: terminalIds[i], data: cmd + '\r' },
            }).catch((e: unknown) => {
              console.error(
                `Failed to inject initial command for terminal ${terminalIds[i]}:`,
                e
              );
            });
          });
        }
      }

      set({ launching: false, error: null });
      return wsId;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('Launch failed:', errorMsg);
      set({ launching: false, error: errorMsg });
      throw e;
    }
  },
}));
