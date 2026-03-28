import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { ConfigData } from '../types/ipc';

interface ConfigState {
  config: ConfigData | null;
  version: string;
  error: string | null;
  loading: boolean;
  loadConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  version: '',
  error: null,
  loading: true,

  loadConfig: async () => {
    set({ loading: true, error: null });
    try {
      const [config, version] = await Promise.all([
        invoke<ConfigData>('get_config'),
        invoke<string>('get_app_version'),
      ]);
      set({ config, version, loading: false });
    } catch (e) {
      console.error('Failed to load config:', e);
      set({ error: String(e), loading: false });
    }
  },
}));
