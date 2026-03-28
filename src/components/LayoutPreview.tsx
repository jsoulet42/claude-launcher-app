import type { Layout } from '../types/ipc';
import './LayoutPreview.css';

export interface ResolvedPanel {
  index: number;
  projectName: string | null;
  projectColor: string | null;
  command: string;
}

interface LayoutPreviewProps {
  layout: Layout;
  panels: ResolvedPanel[];
  className?: string;
}

interface GridConfig {
  gridTemplate: string;
  areas: string[][];
}

function parseRatio(splitDef: string): number {
  const match = splitDef.match(/\((\d+)%\)/);
  return match ? parseInt(match[1], 10) : 50;
}

function computeGrid(splits: string[], panelCount: number): GridConfig {
  if (panelCount <= 0) {
    return { gridTemplate: '1fr / 1fr', areas: [['p0']] };
  }

  if (splits.length === 0 || panelCount === 1) {
    return { gridTemplate: '1fr / 1fr', areas: [['p0']] };
  }

  // Filter out focus-* directives for simple layout detection
  const realSplits = splits.filter((s) => !s.startsWith('focus'));

  // Simple horizontal splits (H, H, H...)
  if (realSplits.every((s) => s === 'H')) {
    const cols = `repeat(${panelCount}, 1fr)`;
    const areas = [Array.from({ length: panelCount }, (_, i) => `p${i}`)];
    return { gridTemplate: `1fr / ${cols}`, areas };
  }

  // Simple vertical splits (V only)
  if (realSplits.length === 1 && realSplits[0] === 'V') {
    return {
      gridTemplate: '1fr 1fr / 1fr',
      areas: [['p0'], ['p1']],
    };
  }

  // V with ratio — 2 columns
  if (realSplits.length === 1 && realSplits[0].startsWith('V')) {
    const ratio = parseRatio(realSplits[0]);
    return {
      gridTemplate: `1fr / ${ratio}fr ${100 - ratio}fr`,
      areas: [['p0', 'p1']],
    };
  }

  // main-plus-stack: V(60%), H → main left spanning 2 rows, right split top/bottom
  if (
    realSplits.length === 2 &&
    realSplits[0].startsWith('V') &&
    realSplits[1] === 'H'
  ) {
    const ratio = parseRatio(realSplits[0]);
    return {
      gridTemplate: `1fr 1fr / ${ratio}fr ${100 - ratio}fr`,
      areas: [
        ['p0', 'p1'],
        ['p0', 'p2'],
      ],
    };
  }

  // grid-2x2: 4 panels in 2x2 grid
  if (panelCount === 4) {
    return {
      gridTemplate: '1fr 1fr / 1fr 1fr',
      areas: [
        ['p0', 'p1'],
        ['p2', 'p3'],
      ],
    };
  }

  // Fallback: stack vertically
  const rows = `repeat(${panelCount}, 1fr)`;
  const areas = Array.from({ length: panelCount }, (_, i) => [`p${i}`]);
  return { gridTemplate: `${rows} / 1fr`, areas };
}

export function LayoutPreview({ layout, panels, className }: LayoutPreviewProps) {
  const { gridTemplate, areas } = computeGrid(layout.splits, panels.length);

  const gridTemplateAreas = areas.map((row) => `"${row.join(' ')}"`).join(' ');

  return (
    <div
      className={`layout-preview ${className ?? ''}`}
      style={{
        gridTemplate,
        gridTemplateAreas,
      }}
    >
      {panels.map((panel) => (
        <div
          key={panel.index}
          className={`layout-preview-cell ${
            panel.projectName
              ? 'layout-preview-cell--resolved'
              : 'layout-preview-cell--auto'
          }`}
          style={{
            gridArea: `p${panel.index}`,
            borderLeftColor: panel.projectColor ?? undefined,
          }}
        >
          <span className="layout-preview-cell-project">
            {panel.projectName ?? '?'}
          </span>
          <span className="layout-preview-cell-command">{panel.command}</span>
        </div>
      ))}
    </div>
  );
}
