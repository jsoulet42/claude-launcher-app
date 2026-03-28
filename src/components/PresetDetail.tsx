import { useState } from 'react';
import { useConfigStore } from '../stores/config';
import { useProjectsStore } from '../stores/projects';
import { useTerminalsStore } from '../stores/terminals';
import { useUiStore } from '../stores/ui';
import { LayoutPreview } from './LayoutPreview';
import type { ResolvedPanel } from './LayoutPreview';
import './PresetDetail.css';

interface PresetDetailProps {
  presetSlug: string;
}

export function PresetDetail({ presetSlug }: PresetDetailProps) {
  const config = useConfigStore((s) => s.config);
  const scannedProjects = useProjectsStore((s) => s.scannedProjects);
  const createWorkspace = useTerminalsStore((s) => s.createWorkspace);
  const createTerminalInWorkspace = useTerminalsStore((s) => s.createTerminalInWorkspace);
  const setActiveWorkspace = useTerminalsStore((s) => s.setActiveWorkspace);
  const hidePresetDetail = useUiStore((s) => s.hidePresetDetail);

  const [focusProject, setFocusProject] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  if (!config) {
    return (
      <div className="preset-detail">
        <p className="preset-detail-error">Configuration introuvable</p>
      </div>
    );
  }

  const preset = config.presets[presetSlug];
  if (!preset) {
    return (
      <div className="preset-detail">
        <p className="preset-detail-error">Preset introuvable</p>
      </div>
    );
  }

  const layout = config.layouts[preset.layout];
  const hasAuto = preset.panels.some(
    (p) => !p.project || p.project === '{{auto}}'
  );

  // Build project options for dropdown
  const configProjects = Object.entries(config.projects);
  const extraProjects = scannedProjects.filter(
    (sp) => !config.projects[sp.slug]
  );

  // Resolve panels for preview
  const resolvedPanels: ResolvedPanel[] = preset.panels.map((panel, i) => {
    const isAuto = !panel.project || panel.project === '{{auto}}';
    const resolvedSlug = isAuto ? focusProject : panel.project;
    const project = resolvedSlug ? config.projects[resolvedSlug] : null;
    const scanned = resolvedSlug
      ? scannedProjects.find((sp) => sp.slug === resolvedSlug)
      : null;
    const projectName = project?.name ?? scanned?.name ?? null;
    const projectColor = project?.color ?? scanned?.color ?? null;
    const command = panel.command
      ?? project?.default_command
      ?? scanned?.default_command
      ?? 'pwsh';

    return { index: i, projectName, projectColor, command };
  });

  const canLaunch = !hasAuto || focusProject !== null;

  const handleLaunch = async () => {
    if (!canLaunch || launching) return;

    setLaunching(true);
    try {
      const panels = preset.panels.map((panel) => {
        const isAuto = !panel.project || panel.project === '{{auto}}';
        const resolvedSlug = isAuto ? focusProject : panel.project;
        const project = resolvedSlug ? config.projects[resolvedSlug] : null;
        const scanned = resolvedSlug
          ? scannedProjects.find((sp) => sp.slug === resolvedSlug)
          : null;
        const cwd = project?.path ?? scanned?.path;
        const shell = panel.command
          ?? project?.default_command
          ?? scanned?.default_command
          ?? 'pwsh';

        return { cwd, shell };
      });

      const splits = layout?.splits ?? [];
      const firstPanel = panels[0];
      const wsName = focusProject
        ? (config.projects[focusProject]?.name ?? preset.name)
        : preset.name;
      const wsColor = focusProject
        ? config.projects[focusProject]?.color
        : undefined;

      const wsId = await createWorkspace(
        wsName,
        wsColor,
        { shell: firstPanel?.shell, cwd: firstPanel?.cwd }
      );

      for (let i = 1; i < panels.length; i++) {
        const p = panels[i];
        const splitDef = splits[i - 1] ?? 'H';
        const direction = splitDef.startsWith('V')
          ? ('vertical' as const)
          : ('horizontal' as const);
        await createTerminalInWorkspace(wsId, {
          cwd: p.cwd,
          shell: p.shell,
          direction,
        });
      }

      setActiveWorkspace(wsId);
      hidePresetDetail();
    } catch (e) {
      console.error('Failed to launch preset workspace:', e);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="preset-detail">
      <button
        className="preset-detail-close"
        onClick={hidePresetDetail}
        title="Fermer"
      >
        &#x2715;
      </button>

      {/* Header */}
      <div className="preset-detail-header">
        <h2 className="preset-detail-name">{preset.name}</h2>
        {preset.description && (
          <p className="preset-detail-desc">{preset.description}</p>
        )}
        <span className="preset-detail-layout-badge">
          {preset.layout}
        </span>
      </div>

      {/* Layout preview */}
      {layout ? (
        <LayoutPreview
          layout={layout}
          panels={resolvedPanels}
          className="preset-detail-preview"
        />
      ) : (
        <p className="preset-detail-layout-error">
          Layout &laquo;{preset.layout}&raquo; non trouve
        </p>
      )}

      {/* Panels table */}
      <div className="preset-detail-panels">
        <h3 className="preset-detail-section-title">
          Panneaux ({preset.panels.length})
        </h3>
        <table className="preset-detail-panels-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Projet</th>
              <th>Commande</th>
            </tr>
          </thead>
          <tbody>
            {resolvedPanels.map((rp) => (
              <tr key={rp.index}>
                <td>{rp.index + 1}</td>
                <td>
                  {rp.projectName ? (
                    <span className="preset-detail-panel-project">
                      <span
                        className="preset-detail-panel-color"
                        style={{ backgroundColor: rp.projectColor ?? '#6c7086' }}
                      />
                      {rp.projectName}
                    </span>
                  ) : (
                    <span className="preset-detail-panel-auto">A choisir</span>
                  )}
                </td>
                <td>
                  <code className="preset-detail-panel-cmd">{rp.command}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Project selector */}
      {hasAuto && (
        <div className="preset-detail-focus">
          <label className="preset-detail-focus-label" htmlFor="focus-project">
            Projet cible
          </label>
          <select
            id="focus-project"
            className="preset-detail-focus-select"
            value={focusProject ?? ''}
            onChange={(e) => setFocusProject(e.target.value || null)}
          >
            <option value="">Choisir un projet...</option>
            {configProjects.map(([slug, project]) => (
              <option key={slug} value={slug}>
                {project.name}
              </option>
            ))}
            {extraProjects.length > 0 && (
              <optgroup label="Decouverts">
                {extraProjects.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      {/* Launch button */}
      <button
        className="preset-detail-launch"
        disabled={!canLaunch || launching}
        onClick={handleLaunch}
      >
        {launching ? 'Lancement...' : 'Lancer workspace'}
      </button>
    </div>
  );
}
