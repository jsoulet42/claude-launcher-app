import { create } from 'zustand';

export type SidebarSection = 'projects' | 'presets' | 'settings';

interface UiState {
  sidebarExpanded: boolean;
  activeSidebarSection: SidebarSection;
  showProjectDetail: boolean;
  showPresetDetail: boolean;
  selectedPreset: string | null;
  toggleSidebar: () => void;
  setActiveSection: (section: SidebarSection) => void;
  showDetail: () => void;
  hideDetail: () => void;
  setSelectedPreset: (slug: string | null) => void;
  showPresetDetailPanel: () => void;
  hidePresetDetail: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: true,
  activeSidebarSection: 'projects',
  showProjectDetail: false,
  showPresetDetail: false,
  selectedPreset: null,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  setActiveSection: (section) => set({ activeSidebarSection: section }),
  showDetail: () => set({ showProjectDetail: true, showPresetDetail: false }),
  hideDetail: () => set({ showProjectDetail: false }),
  setSelectedPreset: (slug) => set({ selectedPreset: slug }),
  showPresetDetailPanel: () => set({ showPresetDetail: true, showProjectDetail: false }),
  hidePresetDetail: () => set({ showPresetDetail: false }),
}));
