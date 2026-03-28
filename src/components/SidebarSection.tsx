import type { ReactNode } from 'react';
import './SidebarSection.css';

interface SidebarSectionProps {
  title: string;
  icon: string;
  expanded: boolean;
  active: boolean;
  onActivate: () => void;
  children?: ReactNode;
}

export function SidebarSection({
  title,
  icon,
  expanded,
  active,
  onActivate,
  children,
}: SidebarSectionProps) {
  return (
    <div className={`sidebar-section ${active ? 'sidebar-section--active' : ''}`}>
      <button
        className="sidebar-section-header"
        onClick={onActivate}
        title={title}
      >
        <span className="sidebar-section-icon">{icon}</span>
        {expanded && <span className="sidebar-section-title">{title}</span>}
      </button>
      {active && expanded && children && (
        <div className="sidebar-section-content">
          {children}
        </div>
      )}
    </div>
  );
}
