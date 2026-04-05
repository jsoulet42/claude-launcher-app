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
    },
  ),
);
