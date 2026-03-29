import { useState, type ReactNode } from 'react';
import './SidebarSection.css';

interface SidebarSectionProps {
  title: string;
  icon: string;
  expanded: boolean;
  children?: ReactNode;
}

export function SidebarSection({
  title,
  icon,
  expanded,
  children,
}: SidebarSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((prev) => !prev);
  };

  return (
    <div className="sidebar-section">
      <button
        className="sidebar-section-header"
        onClick={toggleCollapsed}
        title={title}
        role="button"
        aria-expanded={!collapsed}
      >
        <span className="sidebar-section-icon">{icon}</span>
        {expanded && (
          <>
            <span className="sidebar-section-title">{title}</span>
            <span className={`sidebar-section-chevron ${collapsed ? 'sidebar-section-chevron--collapsed' : ''}`}>
              {'\u2039'}
            </span>
          </>
        )}
      </button>
      {expanded && children && (
        <div
          className={`sidebar-section-content ${collapsed ? 'sidebar-section-content--collapsed' : ''}`}
          aria-hidden={collapsed}
        >
          <div className="sidebar-section-content__inner">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
