import { create } from 'zustand';

export type SidebarSection = 'projects' | 'presets' | 'settings';

interface UiState {
  sidebarExpanded: boolean;
  activeSidebarSection: SidebarSection;
  showProjectDetail: boolean;
  toggleSidebar: () => void;
  setActiveSection: (section: SidebarSection) => void;
  showDetail: () => void;
  hideDetail: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: true,
  activeSidebarSection: 'projects',
  showProjectDetail: false,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  setActiveSection: (section) => set({ activeSidebarSection: section }),
  showDetail: () => set({ showProjectDetail: true }),
  hideDetail: () => set({ showProjectDetail: false }),
}));
