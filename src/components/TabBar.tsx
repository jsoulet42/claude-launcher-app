import { useState, useRef, useEffect } from 'react';
import { useTerminalsStore } from '../stores/terminals';
import { useUiStore } from '../stores/ui';
import './TabBar.css';

export function TabBar() {
  const workspaces = useTerminalsStore((s) => s.workspaces);
  const activeWorkspaceId = useTerminalsStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useTerminalsStore((s) => s.setActiveWorkspace);
  const closeWorkspace = useTerminalsStore((s) => s.closeWorkspace);
  const createWorkspace = useTerminalsStore((s) => s.createWorkspace);
  const renameWorkspace = useTerminalsStore((s) => s.renameWorkspace);
  const hideDetail = useUiStore((s) => s.hideDetail);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      renameWorkspace(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleCloseTab = async (
    e: React.MouseEvent,
    workspaceId: string
  ) => {
    e.stopPropagation();
    await closeWorkspace(workspaceId);
  };

  return (
    <div className="tabbar">
      <div className="tabbar-tabs">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            className={`tabbar-tab${ws.id === activeWorkspaceId ? ' tabbar-tab--active' : ''}`}
            onClick={() => { setActiveWorkspace(ws.id); hideDetail(); }}
            onDoubleClick={() => startRename(ws.id, ws.name)}
          >
            <span
              className="tabbar-tab-color"
              style={{
                backgroundColor: ws.color || 'var(--accent)',
              }}
            />
            {editingId === ws.id ? (
              <input
                ref={editRef}
                className="tabbar-tab-edit"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tabbar-tab-name">{ws.name}</span>
            )}
            <button
              className="tabbar-tab-close"
              onClick={(e) => handleCloseTab(e, ws.id)}
              title="Close tab"
            >
              &#x2715;
            </button>
          </button>
        ))}
      </div>
      <button
        className="tabbar-add"
        onClick={() => createWorkspace()}
        title="New tab"
      >
        +
      </button>
    </div>
  );
}
