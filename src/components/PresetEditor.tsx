import { useState } from 'react';
import { useConfigStore } from '../stores/config';
import { LayoutPreview } from './LayoutPreview';
import type { ResolvedPanel } from './LayoutPreview';
import type { ConfigData, Preset, Panel } from '../types/ipc';
import './PresetEditor.css';

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[_ ]/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'preset';
}

function dedupSlug(slug: string, existingSlugs: string[], editingSlug?: string): string {
  const taken = new Set(existingSlugs.filter((s) => s !== editingSlug));
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetFields {
  name: string;
  description: string;
  layout: string;
  panels: Panel[];
}

interface FieldErrors {
  name?: string;
  panels?: string;
}

function presetToFields(p: Preset): PresetFields {
  return {
    name: p.name,
    description: p.description || '',
    layout: p.layout,
    panels: p.panels.map((panel) => ({ ...panel })),
  };
}

function fieldsToPreset(f: PresetFields): Preset {
  return {
    name: f.name.trim(),
    description: f.description.trim() || undefined,
    layout: f.layout,
    panels: f.panels,
  };
}

function validatePreset(
  fields: PresetFields,
  config: ConfigData,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.name.trim()) errors.name = 'Le nom est requis';

  const layout = config.layouts[fields.layout];
  if (layout) {
    const expectedPanels = layout.splits.filter((s) => !s.startsWith('focus')).length + 1;
    if (fields.panels.length !== expectedPanels) {
      errors.panels = `Le layout "${fields.layout}" attend ${expectedPanels} panneau${expectedPanels > 1 ? 'x' : ''}, ${fields.panels.length} configure${fields.panels.length > 1 ? 's' : ''}`;
    }
  }

  if (fields.panels.length === 0) {
    errors.panels = 'Au moins un panneau requis';
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetEditor() {
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const [editing, setEditing] = useState<{ slug: string; isNew: boolean } | null>(null);
  const [fields, setFields] = useState<PresetFields>({
    name: '',
    description: '',
    layout: '',
    panels: [],
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (!config) return null;

  const presets = Object.entries(config.presets);
  const existingSlugs = presets.map(([slug]) => slug);
  const layouts = Object.entries(config.layouts);
  const projectEntries = Object.entries(config.projects);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleEdit = (slug: string) => {
    const preset = config.presets[slug];
    if (!preset) return;
    setFields(presetToFields(preset));
    setEditing({ slug, isNew: false });
    setFieldErrors({});
    setSaveError(null);
  };

  const handleAdd = () => {
    const firstLayout = layouts[0]?.[0] ?? '';
    const layout = config.layouts[firstLayout];
    const panelCount = layout
      ? layout.splits.filter((s) => !s.startsWith('focus')).length + 1
      : 1;
    setFields({
      name: '',
      description: '',
      layout: firstLayout,
      panels: Array.from({ length: panelCount }, () => ({ project: '{{auto}}' })),
    });
    setEditing({ slug: '', isNew: true });
    setFieldErrors({});
    setSaveError(null);
  };

  const handleCancel = () => {
    setEditing(null);
    setFieldErrors({});
    setSaveError(null);
  };

  const handleFieldChange = (key: keyof PresetFields, value: string) => {
    const updated = { ...fields, [key]: value };

    // When layout changes, adjust panel count
    if (key === 'layout') {
      const layout = config.layouts[value];
      if (layout) {
        const expectedPanels = layout.splits.filter((s) => !s.startsWith('focus')).length + 1;
        const currentPanels = fields.panels;
        if (currentPanels.length < expectedPanels) {
          updated.panels = [
            ...currentPanels,
            ...Array.from({ length: expectedPanels - currentPanels.length }, () => ({
              project: '{{auto}}',
            })),
          ];
        } else if (currentPanels.length > expectedPanels) {
          updated.panels = currentPanels.slice(0, expectedPanels);
        }
      }
    }

    setFields(updated);

    // Auto-generate slug
    if (editing?.isNew && key === 'name') {
      const slug = dedupSlug(toSlug(value), existingSlugs);
      setEditing((e) => (e ? { ...e, slug } : e));
    }

    setFieldErrors(validatePreset(updated, config));
  };

  const handlePanelChange = (index: number, key: keyof Panel, value: string) => {
    const newPanels = fields.panels.map((p, i) =>
      i === index ? { ...p, [key]: value || undefined } : p,
    );
    const updated = { ...fields, panels: newPanels };
    setFields(updated);
    setFieldErrors(validatePreset(updated, config));
  };

  const handleSave = async () => {
    if (!editing) return;
    const errors = validatePreset(fields, config);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setSaveError(null);

    const slug = editing.slug;
    const newPresets = { ...config.presets };
    newPresets[slug] = fieldsToPreset(fields);

    const newConfig: ConfigData = { ...config, presets: newPresets };
    const result = await saveConfig(newConfig);
    if (result.ok) {
      setEditing(null);
    } else {
      setSaveError(result.errors.map((e) => e.message).join('\n'));
    }
    setSaving(false);
  };

  const handleDeleteClick = (slug: string) => {
    setConfirmDelete(slug);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setSaving(true);

    const slug = confirmDelete;
    const newPresets = { ...config.presets };
    delete newPresets[slug];

    // If deleted preset was default, set first remaining
    let newPreferences = config.preferences ? { ...config.preferences } : {};
    if (newPreferences.default_preset === slug) {
      const remaining = Object.keys(newPresets);
      newPreferences = { ...newPreferences, default_preset: remaining[0] || undefined };
    }

    const newConfig: ConfigData = { ...config, presets: newPresets, preferences: newPreferences };
    const result = await saveConfig(newConfig);
    if (!result.ok) {
      setSaveError(result.errors.map((e) => e.message).join('\n'));
    }
    setConfirmDelete(null);
    setSaving(false);
  };

  const isLastPreset = presets.length <= 1;

  // ---------------------------------------------------------------------------
  // Build preview panels
  // ---------------------------------------------------------------------------

  const buildPreviewPanels = (): ResolvedPanel[] => {
    return fields.panels.map((panel, i) => {
      const projectSlug = panel.project;
      const project = projectSlug && projectSlug !== '{{auto}}'
        ? config.projects[projectSlug]
        : null;
      return {
        index: i,
        projectName: project?.name ?? (projectSlug === '{{auto}}' ? 'auto' : null),
        projectColor: project?.color ?? null,
        command: panel.command || project?.default_command || 'claude',
      };
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasErrors = Object.keys(fieldErrors).length > 0;

  // --- Edit / Add form ---
  if (editing) {
    const currentLayout = config.layouts[fields.layout];
    const previewPanels = buildPreviewPanels();

    return (
      <div className="preset-editor">
        <h3 className="preset-editor-title">
          {editing.isNew ? 'Ajouter un preset' : `Modifier "${fields.name}"`}
        </h3>

        <div className="preset-editor-split">
          <div className="preset-editor-form">
            {editing.isNew && (
              <div className="preset-editor-field">
                <label>Slug</label>
                <input type="text" value={editing.slug} readOnly className="preset-editor-input preset-editor-input--readonly" />
              </div>
            )}

            <div className="preset-editor-field">
              <label>Nom</label>
              <input
                type="text"
                value={fields.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                className="preset-editor-input"
                placeholder="Mon Preset"
              />
              {fieldErrors.name && <span className="preset-editor-error">{fieldErrors.name}</span>}
            </div>

            <div className="preset-editor-field">
              <label>Description</label>
              <input
                type="text"
                value={fields.description}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                className="preset-editor-input"
                placeholder="Description optionnelle"
              />
            </div>

            <div className="preset-editor-field">
              <label>Layout</label>
              <select
                value={fields.layout}
                onChange={(e) => handleFieldChange('layout', e.target.value)}
                className="preset-editor-select"
              >
                {layouts.map(([slug]) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </select>
            </div>

            <div className="preset-editor-panels">
              <label>Panneaux</label>
              {fieldErrors.panels && (
                <span className="preset-editor-error">{fieldErrors.panels}</span>
              )}
              {fields.panels.map((panel, i) => (
                <div key={i} className="preset-editor-panel">
                  <span className="preset-editor-panel-num">{i + 1}</span>
                  <select
                    value={panel.project || '{{auto}}'}
                    onChange={(e) => handlePanelChange(i, 'project', e.target.value)}
                    className="preset-editor-select preset-editor-select--panel"
                  >
                    <option value="{{auto}}">{'{{auto}}'}</option>
                    {projectEntries.map(([slug, proj]) => (
                      <option key={slug} value={slug}>
                        {proj.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={panel.command || ''}
                    onChange={(e) => handlePanelChange(i, 'command', e.target.value)}
                    className="preset-editor-input preset-editor-input--panel"
                    placeholder="commande (optionnel)"
                  />
                </div>
              ))}
            </div>
          </div>

          {currentLayout && (
            <div className="preset-editor-preview">
              <label>Preview</label>
              <LayoutPreview
                layout={currentLayout}
                panels={previewPanels}
                className="preset-editor-layout-preview"
              />
            </div>
          )}
        </div>

        {saveError && <p className="preset-editor-save-error">{saveError}</p>}

        <div className="preset-editor-actions">
          <button
            className="preset-editor-btn preset-editor-btn--primary"
            disabled={hasErrors || saving}
            onClick={handleSave}
          >
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
          <button className="preset-editor-btn" onClick={handleCancel}>
            Annuler
          </button>
        </div>
      </div>
    );
  }

  // --- List mode ---
  return (
    <div className="preset-editor">
      <h3 className="preset-editor-title">Presets configures</h3>

      {presets.length === 0 && (
        <p className="preset-editor-empty">Aucun preset configure</p>
      )}

      <ul className="preset-editor-list">
        {presets.map(([slug, preset]) => (
          <li key={slug} className="preset-editor-item">
            <span className="preset-editor-item-name">{preset.name}</span>
            <span className="preset-editor-item-panels">
              {preset.panels.length} panneau{preset.panels.length > 1 ? 'x' : ''}
            </span>
            {preset.description && (
              <span className="preset-editor-item-desc">{preset.description}</span>
            )}
            <button
              className="preset-editor-item-btn"
              onClick={() => handleEdit(slug)}
            >
              Editer
            </button>
            <button
              className="preset-editor-item-btn preset-editor-item-btn--danger"
              onClick={() => handleDeleteClick(slug)}
              disabled={isLastPreset}
              title={isLastPreset ? 'Au moins un preset requis' : undefined}
            >
              &#x2715;
            </button>
          </li>
        ))}
      </ul>

      <div className="preset-editor-toolbar">
        <button className="preset-editor-btn preset-editor-btn--primary" onClick={handleAdd}>
          + Ajouter un preset
        </button>
      </div>

      {saveError && <p className="preset-editor-save-error">{saveError}</p>}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="preset-editor-confirm-overlay">
          <div className="preset-editor-confirm">
            <p>Supprimer le preset "{config.presets[confirmDelete]?.name}" ?</p>
            {config.preferences?.default_preset === confirmDelete && (
              <p className="preset-editor-confirm-warning">
                Ce preset est le preset par defaut. Le premier preset restant sera utilise.
              </p>
            )}
            <div className="preset-editor-confirm-actions">
              <button
                className="preset-editor-btn preset-editor-btn--danger"
                onClick={handleDeleteConfirm}
                disabled={saving}
              >
                Supprimer
              </button>
              <button
                className="preset-editor-btn"
                onClick={() => setConfirmDelete(null)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
