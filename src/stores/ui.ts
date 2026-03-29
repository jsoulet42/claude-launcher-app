import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarSection = 'projects' | 'presets' | 'settings';
export type SettingsTab = 'projects' | 'presets' | 'preferences';

interface UiState {
  sidebarExpanded: boolean;
  sidebarWidth: number;
  activeSidebarSection: SidebarSection;
  showProjectDetail: boolean;
  showPresetDetail: boolean;
  showSettings: boolean;
  settingsTab: SettingsTab;
  selectedPreset: string | null;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActiveSection: (section: SidebarSection) => void;
  showDetail: () => void;
  hideDetail: () => void;
  setSelectedPreset: (slug: string | null) => void;
  showPresetDetailPanel: () => void;
  hidePresetDetail: () => void;
  showSettingsPanel: (tab?: SettingsTab) => void;
  hideSettings: () => void;
  setSettingsTab: (tab: SettingsTab) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarExpanded: true,
      sidebarWidth: 220,
      activeSidebarSection: 'projects',
      showProjectDetail: false,
      showPresetDetail: false,
      showSettings: false,
      settingsTab: 'projects',
      selectedPreset: null,
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setSidebarWidth: (w: number) => {
        // Debounce the persist write by updating state immediately
        // The persist middleware handles storage writes; we clamp here for safety
        const clamped = Math.max(180, Math.min(400, w));
        set({ sidebarWidth: clamped });
      },
      setActiveSection: (section) => set({ activeSidebarSection: section }),
      showDetail: () => set({ showProjectDetail: true, showPresetDetail: false, showSettings: false }),
      hideDetail: () => set({ showProjectDetail: false, showPresetDetail: false, showSettings: false }),
      setSelectedPreset: (slug) => set({ selectedPreset: slug }),
      showPresetDetailPanel: () => set({ showPresetDetail: true, showProjectDetail: false, showSettings: false }),
      hidePresetDetail: () => set({ showPresetDetail: false }),
      showSettingsPanel: (tab) => set({
        showSettings: true,
        showProjectDetail: false,
        showPresetDetail: false,
        ...(tab ? { settingsTab: tab } : {}),
      }),
      hideSettings: () => set({ showSettings: false }),
      setSettingsTab: (tab) => set({ settingsTab: tab }),
    }),
    {
      name: 'claude-launcher-ui',
      partialize: (state) => ({
        sidebarExpanded: state.sidebarExpanded,
        sidebarWidth: state.sidebarWidth,
      }),
    },
  ),
);
