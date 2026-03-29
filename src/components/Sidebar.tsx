import { useUiStore } from '../stores/ui';
import { SidebarSection } from './SidebarSection';
import { ProjectList } from './ProjectList';
import { PresetList } from './PresetList';
import { SettingsSidebarMenu } from './SettingsPanel';
import './Sidebar.css';

export function Sidebar() {
  const { sidebarExpanded, activeSidebarSection, toggleSidebar, setActiveSection } = useUiStore();

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
          <PresetList expanded={sidebarExpanded} />
        </SidebarSection>

        <SidebarSection
          title="Parametres"
          icon="&#x2699;&#xFE0F;"
          expanded={sidebarExpanded}
          active={activeSidebarSection === 'settings'}
          onActivate={() => setActiveSection('settings')}
        >
          <SettingsSidebarMenu expanded={sidebarExpanded} />
        </SidebarSection>
      </nav>
    </aside>
  );
}
