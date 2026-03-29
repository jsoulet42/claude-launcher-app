import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalsStore } from './terminals';
import type { ConfigData, ScannedProject } from '../types/ipc';

const SHELL_READY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      createWorkspace,
      createTerminalInWorkspace,
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

      // Create workspace with first panel
      const firstPanel = resolvedPanels[0];
      const wsId = await createWorkspace(wsName, wsColor, {
        shell: firstPanel?.shell,
        cwd: firstPanel?.cwd,
      });

      // Track terminal IDs for initial command injection
      const terminalIds: string[] = [];

      // Get first terminal ID from the workspace just created
      const ws = useTerminalsStore.getState().workspaces.find(
        (w) => w.id === wsId
      );
      if (ws && ws.layout.type === 'terminal') {
        terminalIds.push(ws.layout.terminalId);
      }

      // Create remaining panels
      for (let i = 1; i < resolvedPanels.length; i++) {
        const p = resolvedPanels[i];
        const splitDef = splits[i - 1] ?? 'H';
        const direction = splitDef.startsWith('V')
          ? ('vertical' as const)
          : ('horizontal' as const);

        try {
          const terminalId = await createTerminalInWorkspace(wsId, {
            cwd: p.cwd,
            shell: p.shell,
            direction,
          });
          terminalIds.push(terminalId);
        } catch (e) {
          console.error(
            `Failed to create terminal for panel ${i}:`,
            e
          );
          // Keep workspace with panels already created
        }
      }

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
