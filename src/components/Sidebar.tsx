import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiStore } from '../stores/ui';
import { SidebarSection } from './SidebarSection';
import { ProjectList } from './ProjectList';
import { PresetList } from './PresetList';
import { SettingsSidebarMenu } from './SettingsPanel';
import './Sidebar.css';

export function Sidebar() {
  const { sidebarExpanded, sidebarWidth, toggleSidebar, setSidebarWidth } = useUiStore();
  const isDragging = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const rafId = useRef<number>(0);
  const [animating, setAnimating] = useState(false);

  const handleToggle = useCallback(() => {
    setAnimating(true);
    toggleSidebar();
    // Remove animating class after transition completes
    setTimeout(() => setAnimating(false), 250);
  }, [toggleSidebar]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!sidebarExpanded) return;
      e.preventDefault();
      isDragging.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [sidebarExpanded],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      // Use rAF to throttle updates to display refresh rate
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        // Update DOM directly for smooth resize, sync store at reduced rate
        if (sidebarRef.current) {
          const clamped = Math.max(180, Math.min(400, e.clientX));
          sidebarRef.current.style.width = `${clamped}px`;
        }
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      cancelAnimationFrame(rafId.current);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // Sync final width to store (triggers one re-render + persist)
      setSidebarWidth(e.clientX);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      cancelAnimationFrame(rafId.current);
    };
  }, [setSidebarWidth]);

  const sidebarStyle = sidebarExpanded
    ? { width: `${sidebarWidth}px` }
    : undefined;

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar ${sidebarExpanded ? 'sidebar--expanded' : 'sidebar--collapsed'} ${animating ? 'sidebar--animating' : ''}`}
      style={sidebarStyle}
    >
      <button
        className="sidebar-toggle"
        onClick={handleToggle}
        title={sidebarExpanded ? 'Reduire la sidebar' : 'Ouvrir la sidebar'}
        aria-label={sidebarExpanded ? 'Reduire la sidebar' : 'Ouvrir la sidebar'}
      >
        <span className={`sidebar-toggle-chevron ${sidebarExpanded ? '' : 'sidebar-toggle-chevron--collapsed'}`}>
          {'\u2039'}
        </span>
      </button>

      <nav className="sidebar-nav">
        <SidebarSection
          title="Projets"
          icon="&#x1F4C2;"
          expanded={sidebarExpanded}
        >
          <ProjectList expanded={sidebarExpanded} />
        </SidebarSection>

        <SidebarSection
          title="Presets"
          icon="&#x1F3AF;"
          expanded={sidebarExpanded}
        >
          <PresetList expanded={sidebarExpanded} />
        </SidebarSection>

        <SidebarSection
          title="Parametres"
          icon="&#x2699;&#xFE0F;"
          expanded={sidebarExpanded}
        >
          <SettingsSidebarMenu expanded={sidebarExpanded} />
        </SidebarSection>
      </nav>

      {sidebarExpanded && (
        <div
          className="sidebar-resize-handle"
          onMouseDown={handleMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner la sidebar"
        />
      )}
    </aside>
  );
}
