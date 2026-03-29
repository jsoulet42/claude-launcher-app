import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useConfigStore } from '../stores/config';
import { useProjectsStore } from '../stores/projects';
import type { ConfigData, Project, ScannedProject } from '../types/ipc';
import './ProjectEditor.css';

// ---------------------------------------------------------------------------
// Slug generation (mirrors scanner.rs to_slug)
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[_ ]/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'project';
}

function dedupSlug(slug: string, existingSlugs: string[], editingSlug?: string): string {
  const taken = new Set(existingSlugs.filter((s) => s !== editingSlug));
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface FieldErrors {
  name?: string;
  path?: string;
  color?: string;
  slug?: string;
}

function validateProject(
  slug: string,
  fields: ProjectFields,
  existingSlugs: string[],
  editingSlug?: string,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.name.trim()) errors.name = 'Le nom est requis';
  if (!fields.path.trim()) {
    errors.path = 'Le chemin est requis';
  } else if (!/^[a-zA-Z]:[/\\]/.test(fields.path)) {
    errors.path = 'Chemin Windows absolu requis (ex: C:\\...)';
  }
  if (fields.color && !/^#[0-9a-fA-F]{6}$/.test(fields.color)) {
    errors.color = 'Format #rrggbb requis';
  }
  const otherSlugs = existingSlugs.filter((s) => s !== editingSlug);
  if (otherSlugs.includes(slug)) {
    errors.slug = 'Ce slug existe deja';
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectFields {
  name: string;
  path: string;
  color: string;
  icon: string;
  default_command: string;
  initial_command: string;
}

function projectToFields(p: Project): ProjectFields {
  return {
    name: p.name,
    path: p.path,
    color: p.color || '#808080',
    icon: p.icon || '',
    default_command: p.default_command || 'claude',
    initial_command: p.initial_command || '',
  };
}

function scannedToFields(sp: ScannedProject): ProjectFields {
  return {
    name: sp.name,
    path: sp.path,
    color: sp.color || '#808080',
    icon: sp.icon || '',
    default_command: sp.default_command || 'claude',
    initial_command: '',
  };
}

function fieldsToProject(f: ProjectFields): Project {
  return {
    name: f.name.trim(),
    path: f.path.trim(),
    color: f.color || undefined,
    icon: f.icon || undefined,
    default_command: f.default_command || undefined,
    initial_command: f.initial_command || null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectEditor() {
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const { scannedProjects, scanning, scanMessage, scanProjects, clearScannedProjects } =
    useProjectsStore();
  const fetchAllGitInfo = useProjectsStore((s) => s.fetchAllGitInfo);

  const [editing, setEditing] = useState<{ slug: string; isNew: boolean } | null>(null);
  const [fields, setFields] = useState<ProjectFields>({
    name: '',
    path: '',
    color: '#808080',
    icon: '',
    default_command: 'claude',
    initial_command: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);

  if (!config) return null;

  const projects = Object.entries(config.projects);
  const existingSlugs = projects.map(([slug]) => slug);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleEdit = (slug: string) => {
    const project = config.projects[slug];
    if (!project) return;
    setFields(projectToFields(project));
    setEditing({ slug, isNew: false });
    setFieldErrors({});
    setSaveError(null);
  };

  const handleAdd = () => {
    setFields({
      name: '',
      path: '',
      color: '#808080',
      icon: '',
      default_command: 'claude',
      initial_command: '',
    });
    setEditing({ slug: '', isNew: true });
    setFieldErrors({});
    setSaveError(null);
  };

  const handleImport = (sp: ScannedProject) => {
    setFields(scannedToFields(sp));
    const slug = dedupSlug(sp.slug, existingSlugs);
    setEditing({ slug, isNew: true });
    setFieldErrors({});
    setSaveError(null);
  };

  const handleImportAll = async () => {
    if (scannedProjects.length === 0) return;
    setSaving(true);
    setSaveError(null);

    const newProjects = { ...config.projects };
    const allSlugs = [...existingSlugs];

    for (const sp of scannedProjects) {
      const slug = dedupSlug(toSlug(sp.name), allSlugs);
      allSlugs.push(slug);
      newProjects[slug] = {
        name: sp.name,
        path: sp.path,
        color: sp.color || undefined,
        default_command: sp.default_command || undefined,
      };
    }

    const newConfig: ConfigData = { ...config, projects: newProjects };
    const result = await saveConfig(newConfig);
    if (result.ok) {
      clearScannedProjects();
      fetchAllGitInfo(newConfig.projects);
    } else {
      setSaveError(result.errors.map((e) => e.message).join('\n'));
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setEditing(null);
    setFieldErrors({});
    setSaveError(null);
  };

  const handleBrowse = async () => {
    const selected = await open({ directory: true, title: 'Choisir le dossier du projet' });
    if (selected) {
      setFields((f) => ({ ...f, path: selected as string }));
    }
  };

  const handleFieldChange = (key: keyof ProjectFields, value: string) => {
    const updated = { ...fields, [key]: value };
    setFields(updated);

    // Auto-generate slug for new projects
    if (editing?.isNew && key === 'name') {
      const slug = dedupSlug(toSlug(value), existingSlugs);
      setEditing((e) => (e ? { ...e, slug } : e));
    }

    // Live validation
    const slug = editing?.isNew
      ? (key === 'name' ? dedupSlug(toSlug(value), existingSlugs) : editing.slug)
      : (editing?.slug ?? '');
    setFieldErrors(validateProject(slug, updated, existingSlugs, editing?.isNew ? undefined : editing?.slug));
  };

  const handleSave = async () => {
    if (!editing) return;

    const slug = editing.slug;
    const errors = validateProject(slug, fields, existingSlugs, editing.isNew ? undefined : slug);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setSaveError(null);

    const newProjects = { ...config.projects };
    newProjects[slug] = fieldsToProject(fields);

    const newConfig: ConfigData = { ...config, projects: newProjects };
    const result = await saveConfig(newConfig);
    if (result.ok) {
      setEditing(null);
      fetchAllGitInfo(newConfig.projects);
    } else {
      setSaveError(result.errors.map((e) => e.message).join('\n'));
    }
    setSaving(false);
  };

  const handleDeleteClick = (slug: string) => {
    // Check if project is used by any preset
    const usedBy = Object.entries(config.presets)
      .filter(([, preset]) => preset.panels.some((p) => p.project === slug))
      .map(([, preset]) => preset.name);

    if (usedBy.length > 0) {
      setDeleteWarning(
        `Ce projet est utilise par : ${usedBy.join(', ')}. Les references deviendront {{auto}}.`,
      );
    } else {
      setDeleteWarning(null);
    }
    setConfirmDelete(slug);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setSaving(true);

    const slug = confirmDelete;
    const newProjects = { ...config.projects };
    delete newProjects[slug];

    // Replace references in presets with {{auto}}
    const newPresets = { ...config.presets };
    for (const [presetSlug, preset] of Object.entries(newPresets)) {
      const needsUpdate = preset.panels.some((p) => p.project === slug);
      if (needsUpdate) {
        newPresets[presetSlug] = {
          ...preset,
          panels: preset.panels.map((p) =>
            p.project === slug ? { ...p, project: '{{auto}}' } : p,
          ),
        };
      }
    }

    const newConfig: ConfigData = { ...config, projects: newProjects, presets: newPresets };
    const result = await saveConfig(newConfig);
    if (result.ok) {
      fetchAllGitInfo(newConfig.projects);
    } else {
      setSaveError(result.errors.map((e) => e.message).join('\n'));
    }
    setConfirmDelete(null);
    setDeleteWarning(null);
    setSaving(false);
  };

  const handleScan = () => {
    if (config && !scanning) {
      scanProjects(config);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasErrors = Object.keys(fieldErrors).length > 0;

  // --- Edit / Add form ---
  if (editing) {
    return (
      <div className="project-editor">
        <h3 className="project-editor-title">
          {editing.isNew ? 'Ajouter un projet' : `Modifier "${fields.name}"`}
        </h3>

        <div className="project-editor-form">
          {editing.isNew && (
            <div className="project-editor-field">
              <label>Slug</label>
              <input type="text" value={editing.slug} readOnly className="project-editor-input project-editor-input--readonly" />
              {fieldErrors.slug && <span className="project-editor-error">{fieldErrors.slug}</span>}
            </div>
          )}

          <div className="project-editor-field">
            <label>Nom</label>
            <input
              type="text"
              value={fields.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              className="project-editor-input"
              placeholder="Mon Projet"
            />
            {fieldErrors.name && <span className="project-editor-error">{fieldErrors.name}</span>}
          </div>

          <div className="project-editor-field">
            <label>Chemin</label>
            <div className="project-editor-path-row">
              <input
                type="text"
                value={fields.path}
                onChange={(e) => handleFieldChange('path', e.target.value)}
                className="project-editor-input"
                placeholder="C:\Users\..."
              />
              <button className="project-editor-browse" onClick={handleBrowse}>
                Parcourir
              </button>
            </div>
            {fieldErrors.path && <span className="project-editor-error">{fieldErrors.path}</span>}
          </div>

          <div className="project-editor-field">
            <label>Couleur</label>
            <div className="project-editor-color-row">
              <input
                type="color"
                value={fields.color}
                onChange={(e) => handleFieldChange('color', e.target.value)}
                className="project-editor-color-picker"
              />
              <input
                type="text"
                value={fields.color}
                onChange={(e) => handleFieldChange('color', e.target.value)}
                className="project-editor-input project-editor-input--color"
                placeholder="#808080"
              />
            </div>
            {fieldErrors.color && <span className="project-editor-error">{fieldErrors.color}</span>}
          </div>

          <div className="project-editor-field">
            <label>Commande par defaut</label>
            <input
              type="text"
              value={fields.default_command}
              onChange={(e) => handleFieldChange('default_command', e.target.value)}
              className="project-editor-input"
              placeholder="claude"
            />
          </div>

          <div className="project-editor-field">
            <label>Commande initiale (optionnel)</label>
            <input
              type="text"
              value={fields.initial_command}
              onChange={(e) => handleFieldChange('initial_command', e.target.value)}
              className="project-editor-input"
              placeholder="/specflow"
            />
          </div>
        </div>

        {saveError && <p className="project-editor-save-error">{saveError}</p>}

        <div className="project-editor-actions">
          <button
            className="project-editor-btn project-editor-btn--primary"
            disabled={hasErrors || saving}
            onClick={handleSave}
          >
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
          <button className="project-editor-btn" onClick={handleCancel}>
            Annuler
          </button>
        </div>
      </div>
    );
  }

  // --- List mode ---
  return (
    <div className="project-editor">
      <h3 className="project-editor-title">Projets configures</h3>

      {projects.length === 0 && (
        <p className="project-editor-empty">Aucun projet configure</p>
      )}

      <ul className="project-editor-list">
        {projects.map(([slug, project]) => (
          <li key={slug} className="project-editor-item">
            <span
              className="project-editor-item-color"
              style={{ backgroundColor: project.color || '#6c7086' }}
            />
            <span className="project-editor-item-name">{project.name}</span>
            <span className="project-editor-item-path">{project.path}</span>
            <button
              className="project-editor-item-btn"
              onClick={() => handleEdit(slug)}
            >
              Editer
            </button>
            <button
              className="project-editor-item-btn project-editor-item-btn--danger"
              onClick={() => handleDeleteClick(slug)}
            >
              &#x2715;
            </button>
          </li>
        ))}
      </ul>

      <div className="project-editor-toolbar">
        <button className="project-editor-btn project-editor-btn--primary" onClick={handleAdd}>
          + Ajouter un projet
        </button>
        <button
          className="project-editor-btn"
          onClick={handleScan}
          disabled={scanning}
        >
          {scanning ? 'Scan en cours...' : 'Scanner mes dossiers'}
        </button>
      </div>

      {scanMessage && <p className="project-editor-scan-msg">{scanMessage}</p>}

      {scannedProjects.length > 0 && (
        <div className="project-editor-scanned">
          <h4 className="project-editor-subtitle">Projets decouverts</h4>
          <ul className="project-editor-list">
            {scannedProjects.map((sp) => (
              <li key={sp.slug} className="project-editor-item project-editor-item--scanned">
                <span
                  className="project-editor-item-color"
                  style={{ backgroundColor: sp.color || '#6c7086' }}
                />
                <span className="project-editor-item-name">{sp.name}</span>
                <span className="project-editor-item-stack">{sp.stack_type}</span>
                <span className="project-editor-item-path">{sp.path}</span>
                <button
                  className="project-editor-item-btn project-editor-item-btn--import"
                  onClick={() => handleImport(sp)}
                >
                  Importer
                </button>
              </li>
            ))}
          </ul>
          <button
            className="project-editor-btn project-editor-btn--primary"
            onClick={handleImportAll}
            disabled={saving}
          >
            {saving ? 'Import...' : 'Tout importer'}
          </button>
        </div>
      )}

      {saveError && <p className="project-editor-save-error">{saveError}</p>}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="project-editor-confirm-overlay">
          <div className="project-editor-confirm">
            <p>Supprimer le projet "{config.projects[confirmDelete]?.name}" ?</p>
            {deleteWarning && (
              <p className="project-editor-confirm-warning">{deleteWarning}</p>
            )}
            <div className="project-editor-confirm-actions">
              <button
                className="project-editor-btn project-editor-btn--danger"
                onClick={handleDeleteConfirm}
                disabled={saving}
              >
                Supprimer
              </button>
              <button
                className="project-editor-btn"
                onClick={() => { setConfirmDelete(null); setDeleteWarning(null); }}
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
