import { useConfigStore } from '../stores/config';
import { useProjectsStore } from '../stores/projects';
import { useUiStore } from '../stores/ui';
import './ProjectList.css';

interface ProjectListProps {
  expanded: boolean;
}

export function ProjectList({ expanded }: ProjectListProps) {
  const config = useConfigStore((s) => s.config);
  const {
    gitInfo,
    stackTypes,
    selectedProject,
    setSelectedProject,
  } = useProjectsStore();
  const showDetail = useUiStore((s) => s.showDetail);
  const showSettingsPanel = useUiStore((s) => s.showSettingsPanel);

  const projects = config ? Object.entries(config.projects) : [];

  const handleProjectClick = (slug: string) => {
    setSelectedProject(slug);
    showDetail();
  };

  if (projects.length === 0) {
    return (
      <div className={`project-list ${expanded ? '' : 'project-list--collapsed'}`}>
        <p className="project-list-empty">Aucun projet</p>
        <button
          className="project-scan-btn"
          onClick={() => showSettingsPanel('projects')}
          title={expanded ? undefined : 'Ajouter un projet'}
        >
          +{expanded && <span> Ajouter</span>}
        </button>
      </div>
    );
  }

  return (
    <div className={`project-list ${expanded ? '' : 'project-list--collapsed'}`}>
      <div className="project-list-items">
        {projects.map(([slug, project]) => {
          const git = gitInfo[slug];
          const isSelected = selectedProject === slug;
          const isGit = git?.is_git ?? false;
          const pathExists = git?.exists ?? true;
          const dirtyCount = git?.dirty_count ?? 0;
          const stack = stackTypes[slug];
          const color = project.color || '#6c7086';

          if (!expanded) {
            return (
              <div
                key={slug}
                className={`project-card project-card--collapsed ${isSelected ? 'project-card--selected' : ''}`}
                onClick={() => handleProjectClick(slug)}
                title={`${project.name}${isGit ? ` — ${git.branch}` : ''}${!pathExists ? ' (introuvable)' : ''}`}
              >
                <span
                  className="project-item-color"
                  style={{ backgroundColor: color }}
                />
              </div>
            );
          }

          return (
            <div
              key={slug}
              className={`project-card ${isSelected ? 'project-card--selected' : ''} ${!pathExists ? 'project-card--warning' : ''}`}
              onClick={() => handleProjectClick(slug)}
              style={{ borderLeftColor: color, '--project-glow': `${color}40` } as React.CSSProperties}
              title={!pathExists ? 'Dossier introuvable' : undefined}
            >
              <div className="project-card__body">
                <div className="project-card__top-row">
                  <span className="project-card__name">{project.name}</span>
                  {!pathExists && (
                    <span className="project-card__warning-icon">&#x26A0;</span>
                  )}
                  {stack && stack !== 'unknown' && (
                    <span className="project-card__stack">{stack}</span>
                  )}
                </div>
                <div className="project-card__bottom-row">
                  {isGit && (
                    <span className="project-card__branch">{git.branch}</span>
                  )}
                  {!isGit && git && (
                    <span className="project-card__nogit">Pas de repo git</span>
                  )}
                  {dirtyCount > 0 && (
                    <span className="project-card__dirty">{dirtyCount}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
