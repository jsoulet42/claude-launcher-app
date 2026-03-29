import { create } from 'zustand';

export type SidebarSection = 'projects' | 'presets' | 'settings';
export type SettingsTab = 'projects' | 'presets' | 'preferences';

interface UiState {
  sidebarExpanded: boolean;
  activeSidebarSection: SidebarSection;
  showProjectDetail: boolean;
  showPresetDetail: boolean;
  showSettings: boolean;
  settingsTab: SettingsTab;
  selectedPreset: string | null;
  toggleSidebar: () => void;
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

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: true,
  activeSidebarSection: 'projects',
  showProjectDetail: false,
  showPresetDetail: false,
  showSettings: false,
  settingsTab: 'projects',
  selectedPreset: null,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  setActiveSection: (section) => set({ activeSidebarSection: section }),
  showDetail: () => set({ showProjectDetail: true, showPresetDetail: false, showSettings: false }),
  hideDetail: () => set({ showProjectDetail: false }),
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
}));
