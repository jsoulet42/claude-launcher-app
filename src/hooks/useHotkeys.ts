import { useEffect } from 'react';
import {
  useTerminalsStore,
  collectPanes,
  findAdjacentPane,
  findPaneTerminalId,
} from '../stores/terminals';
import { useUiStore } from '../stores/ui';
import { terminalRefs } from '../terminalRefs';

function focusTerminalDom(terminalId: string | null) {
  if (!terminalId) return;
  const term = terminalRefs.get(terminalId);
  if (term) term.focus();
}

export function useHotkeys() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const state = useTerminalsStore.getState();
      const uiState = useUiStore.getState();

      // Guard: overlays open → disable pane/workspace shortcuts
      if (uiState.showSettings || uiState.showProjectDetail || uiState.showPresetDetail) {
        return;
      }

      // --- Workspace navigation ---

      // Ctrl+1..9 → switch workspace by index
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const target = state.workspaces[idx];
        if (target) {
          state.setActiveWorkspace(target.id);
          // Focus the terminal in the restored pane
          const updated = useTerminalsStore.getState();
          const ws = updated.workspaces.find((w) => w.id === target.id);
          if (ws && updated.focusedPaneId) {
            const tid = findPaneTerminalId(ws.layout, updated.focusedPaneId);
            focusTerminalDom(tid);
          }
        } else {
          console.warn(`[hotkeys] No workspace at index ${idx + 1}`);
        }
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab → next/prev workspace
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        if (state.workspaces.length <= 1) return;
        const idx = state.workspaces.findIndex((w) => w.id === state.activeWorkspaceId);
        const next = e.shiftKey
          ? (idx - 1 + state.workspaces.length) % state.workspaces.length
          : (idx + 1) % state.workspaces.length;
        state.setActiveWorkspace(state.workspaces[next].id);
        const updated = useTerminalsStore.getState();
        const ws = updated.workspaces[next];
        if (ws && updated.focusedPaneId) {
          const tid = findPaneTerminalId(ws.layout, updated.focusedPaneId);
          focusTerminalDom(tid);
        }
        return;
      }

      // --- From here, need an active workspace ---
      const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      if (!ws) {
        // No workspace — only allow Ctrl+Shift+N
        if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'N') {
          e.preventDefault();
          state.createWorkspace();
        }
        return;
      }

      // --- Pane navigation ---

      // Alt+Arrow → move focus
      if (e.altKey && !e.ctrlKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const dir = e.key.replace('Arrow', '').toLowerCase() as 'left' | 'right' | 'up' | 'down';
        const currentPaneId = state.focusedPaneId;
        if (!currentPaneId) {
          console.warn('[hotkeys] No focused pane for directional navigation');
          return;
        }
        const target = findAdjacentPane(ws.layout, currentPaneId, dir);
        if (target) {
          state.setFocusedPaneId(target);
          const tid = findPaneTerminalId(ws.layout, target);
          focusTerminalDom(tid);
        } else {
          console.warn(`[hotkeys] At layout edge, no adjacent pane ${dir}`);
        }
        return;
      }

      // Alt+1..9 → focus pane by index
      if (e.altKey && !e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const panes = collectPanes(ws.layout);
        const idx = parseInt(e.key) - 1;
        if (panes[idx]) {
          state.setFocusedPaneId(panes[idx].id);
          focusTerminalDom(panes[idx].terminalId);
        } else {
          console.warn(`[hotkeys] No pane at index ${idx + 1}`);
        }
        return;
      }

      // --- Pane actions (Ctrl+Shift+*) ---
      if (e.ctrlKey && e.shiftKey) {
        const key = e.key.toUpperCase();
        if (key === 'H' && state.focusedPaneId) {
          e.preventDefault();
          state.splitPane(ws.id, state.focusedPaneId, 'horizontal').then(() => {
            const updated = useTerminalsStore.getState();
            if (updated.focusedPaneId) {
              const tid = findPaneTerminalId(
                updated.workspaces.find((w) => w.id === ws.id)?.layout ?? ws.layout,
                updated.focusedPaneId
              );
              focusTerminalDom(tid);
            }
          }).catch((err) => console.error('[hotkeys] splitPane failed:', err));
          return;
        }
        if (key === 'V' && state.focusedPaneId) {
          e.preventDefault();
          state.splitPane(ws.id, state.focusedPaneId, 'vertical').then(() => {
            const updated = useTerminalsStore.getState();
            if (updated.focusedPaneId) {
              const tid = findPaneTerminalId(
                updated.workspaces.find((w) => w.id === ws.id)?.layout ?? ws.layout,
                updated.focusedPaneId
              );
              focusTerminalDom(tid);
            }
          }).catch((err) => console.error('[hotkeys] splitPane failed:', err));
          return;
        }
        if (key === 'W' && state.focusedPaneId) {
          e.preventDefault();
          state.closePane(ws.id, state.focusedPaneId).then(() => {
            const updated = useTerminalsStore.getState();
            if (updated.focusedPaneId) {
              const updatedWs = updated.workspaces.find((w) => w.id === ws.id);
              if (updatedWs) {
                const tid = findPaneTerminalId(updatedWs.layout, updated.focusedPaneId);
                focusTerminalDom(tid);
              }
            }
          }).catch((err) => console.error('[hotkeys] closePane failed:', err));
          return;
        }
        if (key === 'N') {
          e.preventDefault();
          state.createWorkspace();
          return;
        }
        if (key === 'B') {
          e.preventDefault();
          uiState.toggleSidebar();
          return;
        }
      }
    }

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}
