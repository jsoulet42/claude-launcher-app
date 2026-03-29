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
      <ul className="project-list-items">
        {projects.map(([slug, project]) => {
          const git = gitInfo[slug];
          const isSelected = selectedProject === slug;
          const isGit = git?.is_git ?? false;
          const pathExists = git?.exists ?? true;
          const dirtyCount = git?.dirty_count ?? 0;
          const stack = stackTypes[slug];

          return (
            <li
              key={slug}
              className={`project-item ${isSelected ? 'project-item--selected' : ''} ${!pathExists ? 'project-item--warning' : ''}`}
              onClick={() => handleProjectClick(slug)}
              title={
                expanded
                  ? (!pathExists ? 'Dossier introuvable' : undefined)
                  : `${project.name}${isGit ? ` — ${git.branch}` : ''}${!pathExists ? ' (introuvable)' : ''}`
              }
            >
              <span
                className="project-item-color"
                style={{ backgroundColor: project.color || '#6c7086' }}
              />
              {!pathExists && expanded && (
                <span className="project-item-warning-icon">&#x26A0;</span>
              )}
              <span className="project-item-label">{project.name}</span>
              {isGit && (
                <span className="project-item-branch">{git.branch}</span>
              )}
              {!isGit && git && (
                <span className="project-item-nogit">Pas de repo git</span>
              )}
              {dirtyCount > 0 && (
                <span className="project-item-dirty">{dirtyCount}</span>
              )}
              {stack && stack !== 'unknown' && (
                <span className="project-item-stack">{stack}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
