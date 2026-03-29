import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useConfigStore } from '../stores/config';
import { useProjectsStore } from '../stores/projects';
import type { ConfigData, Preferences } from '../types/ipc';
import './PreferencesEditor.css';

export function PreferencesEditor() {
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const fetchAllGitInfo = useProjectsStore((s) => s.fetchAllGitInfo);

  const [theme, setTheme] = useState('dark');
  const [defaultPreset, setDefaultPreset] = useState('');
  const [scanDirs, setScanDirs] = useState<string[]>([]);
  const [notifyOnWait, setNotifyOnWait] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load current values from config
  useEffect(() => {
    if (!config) return;
    const prefs = config.preferences;
    setTheme(prefs?.theme || 'dark');
    setDefaultPreset(prefs?.default_preset || '');
    setScanDirs(prefs?.scan_directories || []);
    setNotifyOnWait(prefs?.daemon?.notify_on_wait ?? true);
  }, [config]);

  if (!config) return null;

  const presets = Object.entries(config.presets);

  const handleAddScanDir = async () => {
    const selected = await open({ directory: true, title: 'Choisir un dossier a scanner' });
    if (selected && typeof selected === 'string') {
      setScanDirs((dirs) => [...dirs, selected]);
    }
  };

  const handleRemoveScanDir = (index: number) => {
    setScanDirs((dirs) => dirs.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const newPreferences: Preferences = {
      ...config.preferences,
      theme,
      default_preset: defaultPreset || undefined,
      scan_directories: scanDirs,
      daemon: {
        ...config.preferences?.daemon,
        notify_on_wait: notifyOnWait,
      },
    };

    const newConfig: ConfigData = { ...config, preferences: newPreferences };
    const result = await saveConfig(newConfig);
    if (result.ok) {
      setSaveSuccess(true);
      fetchAllGitInfo(newConfig.projects);
      setTimeout(() => setSaveSuccess(false), 2000);
    } else {
      setSaveError(result.errors.map((e) => e.message).join('\n'));
    }
    setSaving(false);
  };

  return (
    <div className="preferences-editor">
      <h3 className="preferences-editor-title">Preferences generales</h3>

      <div className="preferences-editor-form">
        <div className="preferences-editor-field">
          <label>Theme</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="preferences-editor-select"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        <div className="preferences-editor-field">
          <label>Preset par defaut</label>
          <select
            value={defaultPreset}
            onChange={(e) => setDefaultPreset(e.target.value)}
            className="preferences-editor-select"
          >
            <option value="">Aucun</option>
            {presets.map(([slug, preset]) => (
              <option key={slug} value={slug}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>

        <div className="preferences-editor-field">
          <label>Dossiers a scanner</label>
          <div className="preferences-editor-dirs">
            {scanDirs.length === 0 && (
              <p className="preferences-editor-empty">Aucun dossier configure</p>
            )}
            {scanDirs.map((dir, i) => (
              <div key={i} className="preferences-editor-dir">
                <code className="preferences-editor-dir-path">{dir}</code>
                <button
                  className="preferences-editor-dir-remove"
                  onClick={() => handleRemoveScanDir(i)}
                >
                  &#x2715;
                </button>
              </div>
            ))}
            <button className="preferences-editor-btn" onClick={handleAddScanDir}>
              + Ajouter un dossier
            </button>
          </div>
        </div>

        <div className="preferences-editor-field preferences-editor-field--row">
          <label className="preferences-editor-checkbox-label">
            <input
              type="checkbox"
              checked={notifyOnWait}
              onChange={(e) => setNotifyOnWait(e.target.checked)}
            />
            Notifier quand Claude termine
          </label>
        </div>
      </div>

      {saveError && <p className="preferences-editor-save-error">{saveError}</p>}
      {saveSuccess && <p className="preferences-editor-save-success">Preferences sauvegardees</p>}

      <div className="preferences-editor-actions">
        <button
          className="preferences-editor-btn preferences-editor-btn--primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  );
}
