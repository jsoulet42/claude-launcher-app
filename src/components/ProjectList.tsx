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
    scannedProjects,
    selectedProject,
    scanning,
    scanMessage,
    setSelectedProject,
    scanProjects,
  } = useProjectsStore();
  const showDetail = useUiStore((s) => s.showDetail);

  const projects = config ? Object.entries(config.projects) : [];
  const hasProjects = projects.length > 0 || scannedProjects.length > 0;

  const handleProjectClick = (slug: string) => {
    setSelectedProject(slug);
    showDetail();
  };

  const handleScan = () => {
    if (config && !scanning) {
      scanProjects(config);
    }
  };

  if (!hasProjects && !scanning) {
    return (
      <div className={`project-list ${expanded ? '' : 'project-list--collapsed'}`}>
        <p className="project-list-empty">Aucun projet</p>
        {expanded && (
          <button className="project-scan-btn" onClick={handleScan}>
            &#x1F50D; Scanner vos dossiers
          </button>
        )}
        {!expanded && (
          <button
            className="project-scan-btn"
            onClick={handleScan}
            title="Scanner vos dossiers"
          >
            &#x1F50D;
          </button>
        )}
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

        {scannedProjects.length > 0 && (
          <>
            {expanded && (
              <li className="project-list-separator">Découverts</li>
            )}
            {scannedProjects.map((sp) => (
              <li
                key={sp.slug}
                className={`project-item ${selectedProject === sp.slug ? 'project-item--selected' : ''}`}
                onClick={() => handleProjectClick(sp.slug)}
                title={expanded ? undefined : sp.name}
              >
                <span
                  className="project-item-color"
                  style={{ backgroundColor: sp.color || '#6c7086' }}
                />
                <span className="project-item-label">{sp.name}</span>
                {expanded && (
                  <span className="project-item-discovered">Découvert</span>
                )}
              </li>
            ))}
          </>
        )}
      </ul>

      <button
        className="project-scan-btn"
        onClick={handleScan}
        disabled={scanning}
        title={expanded ? undefined : 'Scanner'}
      >
        {scanning ? (
          <span className="project-scan-spinner" />
        ) : (
          <>
            &#x1F50D;
            {expanded && <span> Scanner</span>}
          </>
        )}
      </button>

      {scanMessage && (
        <p className="project-scan-message">{scanMessage}</p>
      )}
    </div>
  );
}
