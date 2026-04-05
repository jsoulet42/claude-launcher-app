import { useEffect, useMemo, useState } from 'react';
import { useProjectsStore } from '../stores/projects';
import { useTerminalsStore, collectPanes, collectTerminalIds } from '../stores/terminals';
import { useUiStore } from '../stores/ui';
import type { Project } from '../types/ipc';

interface ProjectCardProps {
  slug: string;
  project: Project;
  expanded: boolean;
}

export function ProjectCard({ slug, project, expanded }: ProjectCardProps) {
  const gitInfo = useProjectsStore((s) => s.gitInfo[slug]);
  const stack = useProjectsStore((s) => s.stackTypes[slug]);
  const selectedProject = useProjectsStore((s) => s.selectedProject);
  const setSelectedProject = useProjectsStore((s) => s.setSelectedProject);

  // Filter in body (not selector) to avoid Zustand "new array on every render" issue
  const workspaces = useTerminalsStore((s) => s.workspaces);
  const activeWorkspaces = useMemo(
    () => workspaces.filter((w) => w.projectSlug === slug),
    [workspaces, slug],
  );
  const setActiveWorkspace = useTerminalsStore((s) => s.setActiveWorkspace);
  const activeWorkspaceId = useTerminalsStore((s) => s.activeWorkspaceId);
  const alertingTerminalIds = useTerminalsStore((s) => s.alertingTerminalIds);
  const isAlerting = useMemo(() => {
    const ids = activeWorkspaces.flatMap((w) => collectTerminalIds(w.layout));
    return ids.some((id) => alertingTerminalIds.includes(id));
  }, [activeWorkspaces, alertingTerminalIds]);

  const showDetail = useUiStore((s) => s.showDetail);
  const hideDetail = useUiStore((s) => s.hideDetail);

  const [cardExpanded, setCardExpanded] = useState(false);

  // Auto-close expand when activeCount drops to 0 or 1
  useEffect(() => {
    if (activeWorkspaces.length <= 1) setCardExpanded(false);
  }, [activeWorkspaces.length]);

  const activeCount = activeWorkspaces.length;
  const isSelected = selectedProject === slug;
  const isGit = gitInfo?.is_git ?? false;
  const pathExists = gitInfo?.exists ?? true;
  const dirtyCount = gitInfo?.dirty_count ?? 0;
  const projectColor = project.color;
  const color = projectColor || 'var(--text-muted)';
  // Glow only works with hex colors (we append alpha); use neutral fallback for themed colors
  const glow = projectColor ? `${projectColor}40` : 'var(--bg-hover)';

  const handleCardClick = () => {
    if (activeCount === 0) {
      setSelectedProject(slug);
      showDetail();
    } else if (activeCount === 1) {
      setActiveWorkspace(activeWorkspaces[0].id);
      hideDetail();
    } else {
      setCardExpanded((e) => !e);
    }
  };

  const handleNewWorkspace = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProject(slug);
    showDetail();
  };

  const handleSwitchWorkspace = (e: React.MouseEvent, wsId: string) => {
    e.stopPropagation();
    setActiveWorkspace(wsId);
    hideDetail();
    setCardExpanded(false);
  };

  if (!expanded) {
    // Collapsed sidebar mode
    const handleCollapsedClick = () => {
      if (activeCount === 0) {
        setSelectedProject(slug);
        showDetail();
      } else {
        // 1+ workspaces: switch to the first (insertion order)
        setActiveWorkspace(activeWorkspaces[0].id);
        hideDetail();
      }
    };

    return (
      <div
        className={`project-card project-card--collapsed ${isSelected ? 'project-card--selected' : ''} ${activeCount > 0 ? 'project-card--has-active' : ''}${isAlerting ? ' project-card--alerting' : ''}`}
        onClick={handleCollapsedClick}
        title={`${project.name}${isGit && gitInfo ? ` — ${gitInfo.branch}` : ''}${!pathExists ? ' (introuvable)' : ''}${activeCount > 0 ? ` — ${activeCount} workspace(s) actif(s)` : ''}`}
      >
        <span className="project-item-color" style={{ backgroundColor: color }} />
      </div>
    );
  }

  return (
    <div
      className={`project-card ${isSelected ? 'project-card--selected' : ''} ${!pathExists ? 'project-card--warning' : ''}${isAlerting ? ' project-card--alerting' : ''}`}
      onClick={handleCardClick}
      style={{ borderLeftColor: color, '--project-glow': glow } as React.CSSProperties}
      title={!pathExists ? 'Dossier introuvable' : undefined}
    >
      <div className="project-card__body">
        <div className="project-card__top-row">
          <span className="project-card__name">{project.name}</span>
          {!pathExists && (
            <span className="project-card__warning-icon">&#x26A0;</span>
          )}
          {activeCount > 0 && (
            <span
              className="project-card__ws-badge"
              title={`${activeCount} workspace(s) actif(s)`}
            >
              <span className="project-card__ws-dot" />
              {activeCount}
            </span>
          )}
          {stack && stack !== 'unknown' && (
            <span className="project-card__stack">{stack}</span>
          )}
          {activeCount > 0 && (
            <button
              className="project-card__new-btn"
              onClick={handleNewWorkspace}
              title="Lancer un nouveau workspace"
            >
              +
            </button>
          )}
        </div>
        <div className="project-card__bottom-row">
          {isGit && gitInfo && (
            <span className="project-card__branch">{gitInfo.branch}</span>
          )}
          {!isGit && gitInfo && (
            <span className="project-card__nogit">Pas de repo git</span>
          )}
          {dirtyCount > 0 && (
            <span className="project-card__dirty">{dirtyCount}</span>
          )}
        </div>
        {cardExpanded && activeCount >= 2 && (
          <ul className="project-card__workspaces">
            {activeWorkspaces.map((ws) => {
              const isCurrent = ws.id === activeWorkspaceId;
              const wsColor = ws.color || color;
              const wsTerminalIds = collectTerminalIds(ws.layout);
              const wsIsAlerting = wsTerminalIds.some((id) => alertingTerminalIds.includes(id));
              return (
                <li
                  key={ws.id}
                  className={`project-card__workspace-item${isCurrent ? ' project-card__workspace-item--current' : ''}${wsIsAlerting ? ' project-card__workspace-item--alerting' : ''}`}
                  onClick={(e) => handleSwitchWorkspace(e, ws.id)}
                >
                  <span
                    className="project-card__workspace-swatch"
                    style={{ backgroundColor: wsColor }}
                  />
                  <span className="project-card__workspace-name">{ws.name}</span>
                  <span className="project-card__workspace-panes">
                    {collectPanes(ws.layout).length}p
                  </span>
                  {wsIsAlerting && (
                    <span className="project-card__workspace-alert" title="Agent termine">●</span>
                  )}
                  {isCurrent && !wsIsAlerting && (
                    <span className="project-card__workspace-current" title="Workspace actif">●</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
