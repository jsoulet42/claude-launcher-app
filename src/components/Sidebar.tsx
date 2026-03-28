import { useUiStore } from '../stores/ui';
import { useConfigStore } from '../stores/config';
import { SidebarSection } from './SidebarSection';
import { ProjectList } from './ProjectList';
import './Sidebar.css';

export function Sidebar() {
  const { sidebarExpanded, activeSidebarSection, toggleSidebar, setActiveSection } = useUiStore();
  const config = useConfigStore((s) => s.config);

  const presets = config ? Object.entries(config.presets) : [];

  return (
    <aside className={`sidebar ${sidebarExpanded ? 'sidebar--expanded' : 'sidebar--collapsed'}`}>
      <button
        className="sidebar-toggle"
        onClick={toggleSidebar}
        title={sidebarExpanded ? 'Reduire la sidebar' : 'Ouvrir la sidebar'}
      >
        &#x2261;
      </button>

      <nav className="sidebar-nav">
        <SidebarSection
          title="Projets"
          icon="&#x1F4C2;"
          expanded={sidebarExpanded}
          active={activeSidebarSection === 'projects'}
          onActivate={() => setActiveSection('projects')}
        >
          <ProjectList expanded={sidebarExpanded} />
        </SidebarSection>

        <SidebarSection
          title="Presets"
          icon="&#x1F3AF;"
          expanded={sidebarExpanded}
          active={activeSidebarSection === 'presets'}
          onActivate={() => setActiveSection('presets')}
        >
          <ul className="sidebar-list">
            {presets.map(([slug, preset]) => (
              <li key={slug} className="sidebar-item">
                <span className="sidebar-item-arrow">&#x25B8;</span>
                <span className="sidebar-item-label">{preset.name}</span>
              </li>
            ))}
          </ul>
        </SidebarSection>

        <SidebarSection
          title="Parametres"
          icon="&#x2699;&#xFE0F;"
          expanded={sidebarExpanded}
          active={activeSidebarSection === 'settings'}
          onActivate={() => setActiveSection('settings')}
        >
          <p className="sidebar-placeholder">Phase 9</p>
        </SidebarSection>
      </nav>
    </aside>
  );
}
