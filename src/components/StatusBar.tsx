import { useConfigStore } from '../stores/config';
import { useTerminalsStore } from '../stores/terminals';
import './StatusBar.css';

export function StatusBar() {
  const version = useConfigStore((s) => s.version);
  const terminals = useTerminalsStore((s) => s.terminals);
  const workspaces = useTerminalsStore((s) => s.workspaces);
  const activeWorkspaceId = useTerminalsStore((s) => s.activeWorkspaceId);

  const count = Object.values(terminals).filter((t) => t.status === 'running').length;
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <div className="statusbar">
      <div className="statusbar-segment">
        <span
          className={`statusbar-dot ${count > 0 ? 'statusbar-dot--active' : 'statusbar-dot--inactive'}`}
        />
        {count} terminal{count !== 1 ? 's' : ''}
      </div>
      <div className="statusbar-segment">
        &#x25C6; {workspace ? workspace.name : 'aucun preset'}
      </div>
      <div className="statusbar-segment statusbar-segment--right">
        {version ? `v${version}` : ''}
      </div>
    </div>
  );
}
