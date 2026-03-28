import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore } from '../stores/config';
import { useProjectsStore } from '../stores/projects';
import { useTerminalsStore } from '../stores/terminals';
import { useUiStore } from '../stores/ui';
import type { GitInfo, Project } from '../types/ipc';
import './ProjectDetail.css';

interface ProjectDetailProps {
  projectSlug: string;
}

export function ProjectDetail({ projectSlug }: ProjectDetailProps) {
  const config = useConfigStore((s) => s.config);
  const { selectedPreset, setSelectedPreset } = useUiStore();
  const createWorkspace = useTerminalsStore((s) => s.createWorkspace);
  const createTerminalInWorkspace = useTerminalsStore((s) => s.createTerminalInWorkspace);
  const setActiveWorkspace = useTerminalsStore((s) => s.setActiveWorkspace);
  const hideDetail = useUiStore((s) => s.hideDetail);

  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Resolve project — either from config or scanned
  const configProject: Project | undefined = config?.projects[projectSlug];
  const scannedProject = useProjectsStore((s) =>
    s.scannedProjects.find((sp) => sp.slug === projectSlug)
  );

  const project = configProject ?? (scannedProject ? {
    name: scannedProject.name,
    path: scannedProject.path,
    color: scannedProject.color,
    default_command: scannedProject.default_command,
  } : null);

  // Fetch git info with commits on mount + polling 5s
  useEffect(() => {
    if (!project) return;

    let cancelled = false;

    const fetchGit = async () => {
      try {
        const info = await invoke<GitInfo>('get_git_info', {
          path: project.path,
          includeCommits: true,
        });
        if (!cancelled) {
          setGitInfo(info);
          setGitError(null);
        }
      } catch (e) {
        console.error(`Failed to fetch git info for ${projectSlug}:`, e);
        if (!cancelled) {
          setGitError(String(e));
        }
      }
    };

    fetchGit();
    const intervalId = setInterval(fetchGit, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [project?.path, projectSlug]);

  if (!project || !config) {
    return (
      <div className="project-detail">
        <p className="project-detail-error">Projet introuvable</p>
      </div>
    );
  }

  const presets = Object.entries(config.presets);

  const handleLaunch = async () => {
    if (!selectedPreset || launching) return;

    const preset = config.presets[selectedPreset];
    if (!preset) return;

    setLaunching(true);
    try {
      const panels = preset.panels.map((panel) => {
        // Resolve {{auto}} → current project slug
        const resolvedProjectSlug = panel.project === '{{auto}}'
          ? projectSlug
          : panel.project;

        const resolvedProject = resolvedProjectSlug
          ? config.projects[resolvedProjectSlug]
          : null;

        return {
          cwd: resolvedProject?.path ?? project.path,
          shell: panel.command || resolvedProject?.default_command || project.default_command,
        };
      });

      // Create workspace with first panel opts
      const firstPanel = panels[0];
      const wsId = await createWorkspace(
        project.name,
        project.color,
        { shell: firstPanel?.shell, cwd: firstPanel?.cwd }
      );

      // Resolve layout splits for direction hints
      const layoutDef = config.layouts[preset.layout];
      const splits = layoutDef?.splits ?? [];

      // Create remaining terminals sequentially, inserting into layout tree
      for (let i = 1; i < panels.length; i++) {
        const p = panels[i];
        const splitChar = splits[i - 1] ?? 'H';
        const direction = splitChar.startsWith('V') ? 'vertical' as const : 'horizontal' as const;
        await createTerminalInWorkspace(wsId, {
          cwd: p.cwd,
          shell: p.shell,
          direction,
        });
      }

      setActiveWorkspace(wsId);
      hideDetail();
    } catch (e) {
      console.error('Failed to launch workspace:', e);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="project-detail">
      <div
        className="project-detail-header"
        style={{ borderTopColor: project.color || '#6c7086' }}
      >
        <h2 className="project-detail-name">{project.name}</h2>
        {scannedProject && (
          <span className="project-detail-stack-badge">
            {scannedProject.stack_type}
          </span>
        )}
      </div>

      {/* Git section */}
      <div className="project-detail-git">
        {gitError && (
          <p className="project-detail-git-error">{gitError}</p>
        )}
        {gitInfo && !gitInfo.is_git && (
          <p className="project-detail-no-git">Pas de repo git</p>
        )}
        {gitInfo && gitInfo.is_git && (
          <>
            <div className="project-detail-git-row">
              <span className="project-detail-git-icon">&#x2387;</span>
              <span className="project-detail-git-branch">{gitInfo.branch}</span>
              <span
                className={`project-detail-git-status ${
                  gitInfo.is_dirty
                    ? 'project-detail-git-status--dirty'
                    : 'project-detail-git-status--clean'
                }`}
              >
                {gitInfo.is_dirty
                  ? `${gitInfo.dirty_count} fichier${gitInfo.dirty_count > 1 ? 's' : ''} modifié${gitInfo.dirty_count > 1 ? 's' : ''}`
                  : 'Clean'}
              </span>
            </div>

            {gitInfo.recent_commits.length > 0 ? (
              <div className="project-detail-commits">
                {gitInfo.recent_commits.slice(0, 3).map((commit) => (
                  <div key={commit.hash} className="project-detail-commit">
                    <span className="project-detail-commit-hash">
                      {commit.hash.slice(0, 7)}
                    </span>
                    <span className="project-detail-commit-msg">
                      {commit.message}
                    </span>
                    <span className="project-detail-commit-time">
                      {commit.time_ago}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="project-detail-no-commits">Aucun commit</p>
            )}
          </>
        )}
      </div>

      {/* Path */}
      <div className="project-detail-path">
        <code>{project.path}</code>
      </div>

      {/* Presets */}
      <div className="project-detail-presets">
        <h3 className="project-detail-section-title">Presets</h3>
        {presets.length === 0 ? (
          <p className="project-detail-no-presets">Aucun preset configuré</p>
        ) : (
          <div className="project-detail-presets-grid">
            {presets.map(([slug, preset]) => (
              <button
                key={slug}
                className={`project-detail-preset ${
                  selectedPreset === slug ? 'project-detail-preset--selected' : ''
                }`}
                onClick={() => setSelectedPreset(slug)}
              >
                <span className="project-detail-preset-name">{preset.name}</span>
                {preset.description && (
                  <span className="project-detail-preset-desc">
                    {preset.description}
                  </span>
                )}
                <span className="project-detail-preset-panels">
                  {preset.panels.length} panneau{preset.panels.length > 1 ? 'x' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Launch button */}
      <button
        className="project-detail-launch"
        disabled={!selectedPreset || launching}
        onClick={handleLaunch}
      >
        {launching ? 'Lancement...' : 'Lancer workspace'}
      </button>
    </div>
  );
}
