import { getCurrentWindow } from '@tauri-apps/api/window';
import './Titlebar.css';

export function Titlebar() {
  const appWindow = getCurrentWindow();

  const handleDrag = (e: React.MouseEvent) => {
    // Only drag if clicking directly on the titlebar area, not on buttons
    if ((e.target as HTMLElement).closest('.titlebar-controls')) return;
    appWindow.startDragging();
  };

  return (
    <div className="titlebar" onMouseDown={handleDrag}>
      <div className="titlebar-title">
        <span className="titlebar-dot" />
        Claude Launcher
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn--minimize"
          onClick={() => appWindow.minimize()}
          aria-label="Minimiser"
        >
          &#x2500;
        </button>
        <button
          className="titlebar-btn titlebar-btn--maximize"
          onClick={() => appWindow.toggleMaximize()}
          aria-label="Maximiser"
        >
          &#x25A1;
        </button>
        <button
          className="titlebar-btn titlebar-btn--close"
          onClick={() => appWindow.close()}
          aria-label="Fermer"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}
