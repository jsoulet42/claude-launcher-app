import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  GitInfo,
  ScannedProject,
  StackType,
  Project,
  ConfigData,
} from '../types/ipc';

let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

interface ProjectsState {
  gitInfo: Record<string, GitInfo>;
  stackTypes: Record<string, StackType>;
  scannedProjects: ScannedProject[];

  selectedProject: string | null;
  selectedPreset: string | null;
  scanning: boolean;
  scanMessage: string | null;
  error: string | null;

  setSelectedProject: (slug: string | null) => void;
  setSelectedPreset: (slug: string | null) => void;
  fetchGitInfo: (slug: string, path: string, includeCommits?: boolean) => Promise<void>;
  fetchAllGitInfo: (projects: Record<string, Project>) => Promise<void>;
  scanProjects: (config: ConfigData) => Promise<void>;
  clearScanMessage: () => void;

  startPolling: (projects: Record<string, Project>) => void;
  stopPolling: () => void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  gitInfo: {},
  stackTypes: {},
  scannedProjects: [],
  selectedProject: null,
  selectedPreset: null,
  scanning: false,
  scanMessage: null,
  error: null,

  setSelectedProject: (slug) => set({ selectedProject: slug, selectedPreset: null }),

  setSelectedPreset: (slug) => set({ selectedPreset: slug }),

  fetchGitInfo: async (slug, path, includeCommits = false) => {
    try {
      const info = await invoke<GitInfo>('get_git_info', {
        path,
        includeCommits,
      });
      set((s) => ({
        gitInfo: { ...s.gitInfo, [slug]: info },
      }));
    } catch (e) {
      console.error(`Failed to fetch git info for ${slug}:`, e);
    }
  },

  fetchAllGitInfo: async (projects) => {
    const entries = Object.entries(projects);
    const currentGitInfo = get().gitInfo;
    const currentStackTypes = get().stackTypes;

    // Fetch git info (skip non-git projects after first fetch)
    await Promise.all(
      entries
        .filter(([slug]) => {
          const cached = currentGitInfo[slug];
          return !cached || cached.is_git;
        })
        .map(([slug, project]) =>
          get().fetchGitInfo(slug, project.path, false)
        )
    );

    // Detect stack types (only once per project)
    const needsStack = entries.filter(([slug]) => !currentStackTypes[slug]);
    if (needsStack.length > 0) {
      await Promise.all(
        needsStack.map(async ([slug, project]) => {
          try {
            const stack = await invoke<string>('detect_project_stack', { path: project.path });
            set((s) => ({
              stackTypes: { ...s.stackTypes, [slug]: stack as StackType },
            }));
          } catch {
            // Silent — stack detection is non-critical
          }
        })
      );
    }
  },

  scanProjects: async (config) => {
    set({ scanning: true, scanMessage: null });
    try {
      const existingPaths = Object.values(config.projects).map((p) => p.path);
      const results = await invoke<ScannedProject[]>('scan_projects', {
        options: {
          directories: config.preferences?.scan_directories ?? [],
          maxDepth: 4,
          existingPaths,
        },
      });

      const filtered = results.filter(
        (sp) => !existingPaths.includes(sp.path)
      );

      if (filtered.length === 0) {
        set({
          scanning: false,
          scanMessage: 'Aucun nouveau projet trouvé',
          scannedProjects: [],
        });
        setTimeout(() => {
          get().clearScanMessage();
        }, 3000);
      } else {
        set({
          scanning: false,
          scannedProjects: filtered,
        });
      }
    } catch (e) {
      console.error('Failed to scan projects:', e);
      set({ scanning: false, error: String(e) });
    }
  },

  clearScanMessage: () => set({ scanMessage: null }),

  startPolling: (projects) => {
    if (pollingIntervalId !== null) return;

    // Initial fetch
    get().fetchAllGitInfo(projects);

    pollingIntervalId = setInterval(() => {
      get().fetchAllGitInfo(projects);
    }, 10000);
  },

  stopPolling: () => {
    if (pollingIntervalId !== null) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  },
}));
