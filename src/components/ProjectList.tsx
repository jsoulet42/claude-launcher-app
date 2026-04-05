import { useConfigStore } from '../stores/config';
import { useUiStore } from '../stores/ui';
import { ProjectCard } from './ProjectCard';
import './ProjectList.css';
import './ProjectCard.css';

interface ProjectListProps {
  expanded: boolean;
}

export function ProjectList({ expanded }: ProjectListProps) {
  const config = useConfigStore((s) => s.config);
  const showSettingsPanel = useUiStore((s) => s.showSettingsPanel);

  const projects = config ? Object.entries(config.projects) : [];

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
        {projects.map(([slug, project]) => (
          <ProjectCard key={slug} slug={slug} project={project} expanded={expanded} />
        ))}
      </div>
    </div>
  );
}
