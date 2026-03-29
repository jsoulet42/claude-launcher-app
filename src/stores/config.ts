import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { ConfigData, ValidationMessage } from '../types/ipc';

interface ConfigState {
  config: ConfigData | null;
  version: string;
  error: string | null;
  loading: boolean;
  loadConfig: () => Promise<void>;
  saveConfig: (config: ConfigData) => Promise<{ ok: boolean; errors: ValidationMessage[] }>;
  validateConfig: (config: ConfigData) => Promise<ValidationMessage[]>;
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

  saveConfig: async (config) => {
    try {
      const messages = await invoke<ValidationMessage[]>('validate_config', { config });
      const errors = messages.filter((m) => m.level === 'Error');
      if (errors.length > 0) {
        return { ok: false, errors };
      }
      await invoke('save_config', { config });
      // Reload config into store after successful save
      const [fresh, version] = await Promise.all([
        invoke<ConfigData>('get_config'),
        invoke<string>('get_app_version'),
      ]);
      set({ config: fresh, version });
      return { ok: true, errors: [] };
    } catch (e) {
      console.error('Failed to save config:', e);
      return { ok: false, errors: [{ level: 'Error' as const, path: '', message: String(e) }] };
    }
  },

  validateConfig: async (config) => {
    try {
      return await invoke<ValidationMessage[]>('validate_config', { config });
    } catch (e) {
      console.error('Failed to validate config:', e);
      return [{ level: 'Error' as const, path: '', message: String(e) }];
    }
  },
}));
