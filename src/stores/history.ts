import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  ConfigData,
  HistoryEntry,
  PresetSuggestion,
} from '../types/ipc';

interface HistoryState {
  entries: HistoryEntry[];
  suggestions: PresetSuggestion[];
  lastLaunch: HistoryEntry | null;
  loading: boolean;
  error: string | null;

  loadHistory: (limit?: number) => Promise<void>;
  loadSuggestions: (config: ConfigData, isDirty?: boolean) => Promise<void>;
  trackLaunch: (entry: HistoryEntry) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  suggestions: [],
  lastLaunch: null,
  loading: false,
  error: null,

  loadHistory: async (limit?: number) => {
    set({ loading: true, error: null });
    try {
      const entries = await invoke<HistoryEntry[]>('get_history', {
        limit: limit ?? null,
      });
      const lastLaunch = entries.length > 0 ? entries[0] : null;
      set({ entries, lastLaunch, loading: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Failed to load history:', msg);
      set({ loading: false, error: msg });
    }
  },

  loadSuggestions: async (config: ConfigData, isDirty?: boolean) => {
    try {
      const gitContext =
        isDirty !== undefined ? { is_dirty: isDirty } : null;
      const suggestions = await invoke<PresetSuggestion[]>(
        'get_preset_suggestions',
        { config, gitContext },
      );
      set({ suggestions });
    } catch (e) {
      console.error('Failed to load suggestions:', e);
    }
  },

  trackLaunch: async (entry: HistoryEntry) => {
    try {
      await invoke('add_history_entry', { entry });
      // Refresh history after tracking
      const entries = await invoke<HistoryEntry[]>('get_history', {
        limit: null,
      });
      const lastLaunch = entries.length > 0 ? entries[0] : null;
      set({ entries, lastLaunch });
    } catch (e) {
      console.error('Failed to track launch:', e);
    }
  },
}));
