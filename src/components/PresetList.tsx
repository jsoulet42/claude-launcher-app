import { useConfigStore } from '../stores/config';
import { useUiStore } from '../stores/ui';
import './PresetList.css';

interface PresetListProps {
  expanded: boolean;
}

function getLayoutIcon(splits: string[]): string {
  const real = splits.filter((s) => !s.startsWith('focus'));
  if (real.length === 0) return '\u25A1'; // □ single

  const allH = real.every((s) => s === 'H');
  const allV = real.every((s) => s === 'V' || s.match(/^V\(\d+%\)$/));

  if (allH && real.length === 1) return '\u2550\u2566\u2550'; // ═╦═
  if (allH && real.length >= 2) return '\u2550\u256C\u2550'; // ═╬═
  if (allV && real.length === 1 && !real[0].includes('(')) return '\u2560\u2550\u2563'; // ╠═╣

  // V with ratio
  if (real.length === 1 && real[0].startsWith('V')) return '\u2590\u2588\u2591'; // ▐█░
  // V + H (main-plus-stack)
  if (real.length === 2 && real[0].startsWith('V') && real[1] === 'H') return '\u2590\u2588\u2564'; // ▐█╤
  // Grid
  if (real.length >= 3) return '\u256C'; // ╬

  return '\u25A1'; // fallback □
}

export function PresetList({ expanded }: PresetListProps) {
  const config = useConfigStore((s) => s.config);
  const { selectedPreset, setSelectedPreset, showPresetDetailPanel } = useUiStore();

  const presets = config ? Object.entries(config.presets) : [];
  const layouts = config?.layouts ?? {};
  const defaultPreset = config?.preferences?.default_preset;

  const handlePresetClick = (slug: string) => {
    setSelectedPreset(slug);
    showPresetDetailPanel();
  };

  if (presets.length === 0) {
    return (
      <div className={`preset-list ${expanded ? '' : 'preset-list--collapsed'}`}>
        <p className="preset-list-empty">Aucun preset configure</p>
      </div>
    );
  }

  return (
    <div className={`preset-list ${expanded ? '' : 'preset-list--collapsed'}`}>
      <ul className="preset-list-items">
        {presets.map(([slug, preset]) => {
          const isSelected = selectedPreset === slug;
          const isDefault = defaultPreset === slug;
          const layout = layouts[preset.layout];
          const icon = layout ? getLayoutIcon(layout.splits) : '?';

          return (
            <li
              key={slug}
              className={`preset-item ${isSelected ? 'preset-item--selected' : ''}`}
              onClick={() => handlePresetClick(slug)}
              title={expanded ? undefined : preset.name}
            >
              <span className="preset-item-icon">{icon}</span>
              <div className="preset-item-info">
                <div className="preset-item-name-row">
                  <span className="preset-item-name">{preset.name}</span>
                  {isDefault && <span className="preset-item-default" title="Preset par defaut">&#x2605;</span>}
                </div>
                {preset.description && (
                  <span className="preset-item-desc">{preset.description}</span>
                )}
                <span className="preset-item-panels">
                  {preset.panels.length} panneau{preset.panels.length > 1 ? 'x' : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
