import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Renderer = 'webgl' | 'dom';

interface DiagnosticsState {
  renderer: Renderer;
  ansiDebug: boolean;
  setRenderer: (r: Renderer) => void;
  setAnsiDebug: (v: boolean) => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>()(
  persist(
    (set) => ({
      renderer: 'webgl',
      ansiDebug: false,
      setRenderer: (renderer) => set({ renderer }),
      setAnsiDebug: (ansiDebug) => set({ ansiDebug }),
    }),
    {
      name: 'claude-launcher-diagnostics',
      // v1 : reset du renderer à 'webgl'. L'ancien debug P34 laissait
      // renderer:'dom' persisté en localStorage — l'app entière tournait
      // alors sur le renderer DOM (lent avec Claude Code, artefacts),
      // et le cycle de vie WebGL par visibilité restait inactif.
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<DiagnosticsState>;
        if (version < 1) {
          return { ...state, renderer: 'webgl' as Renderer };
        }
        return state;
      },
    },
  ),
);
