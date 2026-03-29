import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useConfigStore } from '../stores/config';
import type { ScannedProject, ConfigData, Project } from '../types/ipc';
import './OnboardingWizard.css';

type OnboardingStep = 'welcome' | 'projects' | 'preset';

const STEP_LABELS = ['Ajouter', 'Projets', 'Preset'] as const;
const STEP_KEYS: OnboardingStep[] = ['welcome', 'projects', 'preset'];

// Palette of colors for manually added projects
const COLOR_PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
];

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

function scannedToProject(sp: ScannedProject): Project {
  return {
    name: sp.name,
    path: sp.path,
    color: sp.color,
    icon: sp.icon,
    default_command: sp.default_command,
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function truncatePath(p: string, maxLen = 50): string {
  if (p.length <= maxLen) return p;
  const parts = p.split('\\');
  if (parts.length <= 3) return p;
  return parts[0] + '\\...\\' + parts.slice(-2).join('\\');
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  // Projects list — unified: from scan or manual add
  const [projects, setProjects] = useState<ScannedProject[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  // Scan state
  const [scanDirs, setScanDirs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // Save state
  const [saving, setSaving] = useState(false);

  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);

  const stepIndex = STEP_KEYS.indexOf(step);

  // --- Add project manually (pick a folder = 1 project) ---
  const handleAddProject = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (!dir) return;
    const path = dir as string;

    // Check if already in list
    if (projects.some((p) => p.path === path)) return;

    // Detect stack
    let stackType = 'unknown';
    try {
      stackType = await invoke<string>('detect_project_stack', { path });
    } catch {
      // Silent — stack detection is non-critical
    }

    // Detect git branch
    let gitBranch = '';
    try {
      gitBranch = await invoke<string>('get_git_branch', { path });
    } catch {
      // Not a git repo or error — OK
    }

    // Build project entry
    const folderName = path.split('\\').pop() || 'project';
    const slug = slugify(folderName);
    // Avoid slug collision
    let finalSlug = slug;
    let counter = 2;
    while (projects.some((p) => p.slug === finalSlug)) {
      finalSlug = `${slug}-${counter++}`;
    }

    const colorIndex = projects.length % COLOR_PALETTE.length;

    const newProject: ScannedProject = {
      slug: finalSlug,
      name: folderName,
      path,
      color: COLOR_PALETTE[colorIndex],
      default_command: 'claude',
      source: 'manual',
      stack_type: stackType as ScannedProject['stack_type'],
      git_branch: gitBranch,
      icon: '',
    };

    setProjects((prev) => [...prev, newProject]);
    setSelectedSlugs((prev) => new Set([...prev, finalSlug]));
  };

  // --- Scan a parent directory for projects ---
  const handleBrowseForScan = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && !scanDirs.includes(dir as string)) {
      setScanDirs((prev) => [...prev, dir as string]);
      setScanError(null);
    }
  };

  const handleRemoveScanDir = (dir: string) => {
    setScanDirs((prev) => prev.filter((d) => d !== dir));
  };

  const handleScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const existingPaths = projects.map((p) => p.path);
      const results = await invoke<ScannedProject[]>('scan_projects', {
        options: { directories: scanDirs, max_depth: 4, existing_paths: existingPaths },
      });
      if (results.length === 0) {
        setScanError('Aucun nouveau projet trouve dans ces dossiers');
      } else {
        // Merge with existing projects (no duplicates)
        setProjects((prev) => {
          const existingSlugs = new Set(prev.map((p) => p.slug));
          const newOnes = results.filter((r) => !existingSlugs.has(r.slug));
          return [...prev, ...newOnes];
        });
        setScanError(null);
      }
    } catch (e) {
      console.error('Scan failed:', e);
      setScanError(`Erreur de scan : ${String(e)}`);
    } finally {
      setScanning(false);
    }
  };

  const handleRemoveProject = (slug: string) => {
    setProjects((prev) => prev.filter((p) => p.slug !== slug));
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });
  };

  // --- Selection (step 2) ---
  const handleToggleProject = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedSlugs(new Set(projects.map((p) => p.slug)));
  };

  const handleSelectNone = () => {
    setSelectedSlugs(new Set());
  };

  // --- Skip ---
  const handleSkip = async () => {
    if (!config) return;
    const newConfig: ConfigData = {
      ...config,
      preferences: {
        ...config.preferences,
        onboarding_completed: true,
      },
    };
    await saveConfig(newConfig);
    onSkip();
  };

  // --- Launch (step 3) ---
  const handleLaunch = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const selected = projects.filter((p) => selectedSlugs.has(p.slug));
      const count = selected.length;
      const layout =
        count <= 1
          ? 'single'
          : count === 2
            ? 'horizontal-2'
            : count === 3
              ? 'horizontal-3'
              : count === 4
                ? 'grid-2x2'
                : 'horizontal-3';
      const maxPanels = count === 4 ? 4 : Math.min(count, 3);
      const panels = selected.slice(0, maxPanels).map((p) => ({
        project: p.slug,
        command: p.default_command || 'claude',
      }));

      const configProjects: Record<string, Project> = {};
      for (const sp of selected) {
        configProjects[sp.slug] = scannedToProject(sp);
      }

      const newConfig: ConfigData = {
        ...config,
        projects: configProjects,
        presets: {
          ...config.presets,
          daily: {
            name: 'Daily Dev',
            description: `${count} projets cote a cote`,
            layout,
            panels,
          },
        },
        preferences: {
          ...config.preferences,
          scan_directories: scanDirs.length > 0 ? scanDirs : config.preferences?.scan_directories,
          default_preset: 'daily',
          onboarding_completed: true,
        },
      };

      const result = await saveConfig(newConfig);
      if (result.ok) {
        onComplete();
      } else {
        console.error('Config save failed:', result.errors);
        setSaving(false);
      }
    } catch (e) {
      console.error('Launch failed:', e);
      setSaving(false);
    }
  };

  const goToStep = (target: OnboardingStep) => {
    const targetIndex = STEP_KEYS.indexOf(target);
    if (targetIndex <= stepIndex) {
      setStep(target);
    }
  };

  // --- Computed for preset preview ---
  const selected = projects.filter((p) => selectedSlugs.has(p.slug));
  const presetCount = selected.length;
  const presetLayout =
    presetCount <= 1
      ? 'single'
      : presetCount === 2
        ? 'horizontal-2'
        : presetCount === 3
          ? 'horizontal-3'
          : presetCount === 4
            ? 'grid-2x2'
            : 'horizontal-3';
  const maxPanels = presetCount === 4 ? 4 : Math.min(presetCount, 3);
  const presetPanels = selected.slice(0, maxPanels);
  const extraCount = presetCount > maxPanels ? presetCount - maxPanels : 0;

  return (
    <div className="onboarding">
      {/* Stepper */}
      <div className="onboarding-stepper">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="onboarding-step-item">
            {i > 0 && (
              <div
                className={`onboarding-step-line ${i <= stepIndex ? 'onboarding-step-line--active' : ''}`}
              />
            )}
            <button
              className={`onboarding-step-circle ${i === stepIndex ? 'onboarding-step-circle--current' : ''} ${i < stepIndex ? 'onboarding-step-circle--done' : ''}`}
              onClick={() => goToStep(STEP_KEYS[i])}
              disabled={i > stepIndex}
            >
              {i < stepIndex ? '\u2713' : i + 1}
            </button>
            <span
              className={`onboarding-step-label ${i <= stepIndex ? 'onboarding-step-label--active' : ''}`}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="onboarding-content">
        {step === 'welcome' && (
          <>
            <h1 className="onboarding-title">Bienvenue dans Claude Launcher</h1>
            <p className="onboarding-subtitle">
              Ajoutez vos projets — manuellement ou par scan
            </p>

            {/* Manual add */}
            <div className="onboarding-card">
              <div className="onboarding-card-header">
                <p className="onboarding-card-label">Ajouter un projet</p>
                <button className="onboarding-browse" onClick={handleAddProject}>
                  Choisir un dossier...
                </button>
              </div>

              {projects.length > 0 && (
                <ul className="onboarding-dir-list">
                  {projects.map((p) => (
                    <li key={p.slug} className="onboarding-dir-item">
                      <span
                        className="onboarding-project-color"
                        style={{ background: p.color }}
                      />
                      <span className="onboarding-dir-info">
                        <span className="onboarding-dir-name">{p.name}</span>
                        <span className="onboarding-dir-path">{truncatePath(p.path, 40)}</span>
                      </span>
                      <span className="onboarding-badge">{p.stack_type}</span>
                      <button
                        className="onboarding-dir-remove"
                        onClick={() => handleRemoveProject(p.slug)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Scan section */}
            <div className="onboarding-card onboarding-card--secondary">
              <div className="onboarding-card-header">
                <p className="onboarding-card-label">Ou scanner un dossier parent</p>
                <button className="onboarding-browse" onClick={handleBrowseForScan}>
                  Parcourir...
                </button>
              </div>

              {scanDirs.length > 0 && (
                <>
                  <ul className="onboarding-dir-list">
                    {scanDirs.map((dir) => (
                      <li key={dir} className="onboarding-dir-item">
                        <span className="onboarding-dir-path">{truncatePath(dir)}</span>
                        <button
                          className="onboarding-dir-remove"
                          onClick={() => handleRemoveScanDir(dir)}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    className="onboarding-browse onboarding-scan-btn"
                    disabled={scanning}
                    onClick={handleScan}
                  >
                    {scanning ? 'Scan en cours...' : 'Scanner'}
                  </button>
                </>
              )}

              {scanError && <p className="onboarding-error">{scanError}</p>}
            </div>

            {/* Next button */}
            <button
              className="welcome-action"
              disabled={projects.length === 0}
              onClick={() => setStep('projects')}
            >
              Suivant
            </button>
          </>
        )}

        {step === 'projects' && (
          <>
            <h1 className="onboarding-title">
              {projects.length} projet{projects.length > 1 ? 's' : ''}
            </h1>
            <p className="onboarding-subtitle">
              Selectionnez ceux a inclure dans votre workspace
            </p>

            <div className="onboarding-select-actions">
              <button className="onboarding-link-btn" onClick={handleSelectAll}>
                Tout cocher
              </button>
              <button className="onboarding-link-btn" onClick={handleSelectNone}>
                Tout decocher
              </button>
            </div>

            <div className="onboarding-project-list">
              {projects.map((p) => (
                <label
                  key={p.slug}
                  className={`onboarding-project-item ${selectedSlugs.has(p.slug) ? 'onboarding-project-item--selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSlugs.has(p.slug)}
                    onChange={() => handleToggleProject(p.slug)}
                  />
                  <span
                    className="onboarding-project-color"
                    style={{ background: p.color }}
                  />
                  <span className="onboarding-project-info">
                    <span className="onboarding-project-name">{p.name}</span>
                    <span className="onboarding-project-meta">
                      <span className="onboarding-badge">{p.stack_type}</span>
                      {p.git_branch && (
                        <span className="onboarding-branch">{p.git_branch}</span>
                      )}
                    </span>
                  </span>
                  <span className="onboarding-project-path">
                    {truncatePath(p.path, 40)}
                  </span>
                </label>
              ))}
            </div>

            <div className="onboarding-nav">
              <button
                className="onboarding-back-btn"
                onClick={() => setStep('welcome')}
              >
                Retour
              </button>
              <button
                className="welcome-action"
                disabled={selectedSlugs.size === 0}
                onClick={() => setStep('preset')}
              >
                Suivant
              </button>
            </div>
          </>
        )}

        {step === 'preset' && (
          <>
            <h1 className="onboarding-title">Votre premier workspace</h1>
            <p className="onboarding-subtitle">
              Preset &laquo; Daily Dev &raquo; — {presetCount} projet
              {presetCount > 1 ? 's' : ''}, layout {presetLayout}
            </p>

            <div className={`onboarding-preview onboarding-preview--${presetLayout}`}>
              {presetPanels.map((p) => (
                <div
                  key={p.slug}
                  className="onboarding-preview-pane"
                  style={{ borderLeftColor: p.color }}
                >
                  <span className="onboarding-preview-name">{p.name}</span>
                  <span className="onboarding-preview-cmd">
                    {p.default_command || 'claude'}
                  </span>
                </div>
              ))}
            </div>

            {extraCount > 0 && (
              <p className="onboarding-extra">
                +{extraCount} projet{extraCount > 1 ? 's' : ''} disponible
                {extraCount > 1 ? 's' : ''} dans la sidebar
              </p>
            )}

            <div className="onboarding-nav">
              <button
                className="onboarding-back-btn"
                onClick={() => setStep('projects')}
              >
                Retour
              </button>
              <button
                className="welcome-action"
                disabled={saving}
                onClick={handleLaunch}
              >
                {saving ? 'Sauvegarde...' : 'Lancer'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Skip link */}
      <button className="onboarding-skip" onClick={handleSkip}>
        Passer la configuration
      </button>
    </div>
  );
}
