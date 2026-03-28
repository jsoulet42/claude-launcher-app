import { create } from 'zustand';

export type SidebarSection = 'projects' | 'presets' | 'settings';

interface UiState {
  sidebarExpanded: boolean;
  activeSidebarSection: SidebarSection;
  toggleSidebar: () => void;
  setActiveSection: (section: SidebarSection) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarExpanded: true,
  activeSidebarSection: 'projects',
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  setActiveSection: (section) => set({ activeSidebarSection: section }),
}));
