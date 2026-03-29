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
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);

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

  // Use single column when sidebar is narrow
  const useNarrowGrid = sidebarWidth < 220;

  return (
    <div className={`preset-list ${expanded ? '' : 'preset-list--collapsed'}`}>
      {expanded ? (
        <div className={`preset-grid ${useNarrowGrid ? 'preset-grid--narrow' : ''}`}>
          {presets.map(([slug, preset]) => {
            const isSelected = selectedPreset === slug;
            const isDefault = defaultPreset === slug;
            const layout = layouts[preset.layout];
            const icon = layout ? getLayoutIcon(layout.splits) : '?';

            return (
              <div
                key={slug}
                className={`preset-card ${isSelected ? 'preset-card--selected' : ''} ${isDefault ? 'preset-card--default' : ''}`}
                onClick={() => handlePresetClick(slug)}
              >
                <span className="preset-card__icon">{icon}</span>
                <span className="preset-card__name">{preset.name}</span>
                {isDefault && <span className="preset-card__star" title="Preset par defaut">&#x2605;</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="preset-list-items">
          {presets.map(([slug, preset]) => {
            const isSelected = selectedPreset === slug;
            const layout = layouts[preset.layout];
            const icon = layout ? getLayoutIcon(layout.splits) : '?';

            return (
              <li
                key={slug}
                className={`preset-item ${isSelected ? 'preset-item--selected' : ''}`}
                onClick={() => handlePresetClick(slug)}
                title={preset.name}
              >
                <span className="preset-item-icon">{icon}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
