import { useUiStore } from '../stores/ui';
import { useProjectsStore } from '../stores/projects';
import type { SettingsTab } from '../stores/ui';
import { ProjectEditor } from './ProjectEditor';
import { PresetEditor } from './PresetEditor';
import { PreferencesEditor } from './PreferencesEditor';
import './SettingsPanel.css';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'projects', label: 'Projets' },
  { key: 'presets', label: 'Presets' },
  { key: 'preferences', label: 'Preferences' },
];

export function SettingsPanel() {
  const { settingsTab, setSettingsTab, hideSettings } = useUiStore();
  const clearScannedProjects = useProjectsStore((s) => s.clearScannedProjects);

  const handleBack = () => {
    clearScannedProjects();
    hideSettings();
  };

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <button className="settings-panel-back" onClick={handleBack}>
          &#x2190; Retour
        </button>
        <h2 className="settings-panel-title">Parametres</h2>
      </div>

      <div className="settings-panel-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`settings-panel-tab ${settingsTab === tab.key ? 'settings-panel-tab--active' : ''}`}
            onClick={() => setSettingsTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-panel-content">
        {settingsTab === 'projects' && <ProjectEditor />}
        {settingsTab === 'presets' && <PresetEditor />}
        {settingsTab === 'preferences' && <PreferencesEditor />}
      </div>
    </div>
  );
}

interface SettingsSidebarMenuProps {
  expanded: boolean;
}

export function SettingsSidebarMenu({ expanded }: SettingsSidebarMenuProps) {
  const showSettingsPanel = useUiStore((s) => s.showSettingsPanel);

  const items: { key: SettingsTab; icon: string; label: string }[] = [
    { key: 'projects', icon: '\u{1F4C2}', label: 'Projets' },
    { key: 'presets', icon: '\u{1F3AF}', label: 'Presets' },
    { key: 'preferences', icon: '\u{2699}\u{FE0F}', label: 'Preferences' },
  ];

  return (
    <ul className="settings-sidebar-menu">
      {items.map((item) => (
        <li key={item.key}>
          <button
            className="settings-sidebar-btn"
            onClick={() => showSettingsPanel(item.key)}
            title={expanded ? undefined : item.label}
          >
            <span className="settings-sidebar-icon">{item.icon}</span>
            {expanded && <span className="settings-sidebar-label">{item.label}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
