import { useConfigStore } from '../stores/config';
import './StatusBar.css';

export function StatusBar() {
  const version = useConfigStore((s) => s.version);

  return (
    <div className="statusbar">
      <div className="statusbar-segment">
        <span className="statusbar-dot statusbar-dot--inactive" />
        0 terminals
      </div>
      <div className="statusbar-segment">
        &#x25C6; aucun preset
      </div>
      <div className="statusbar-segment statusbar-segment--right">
        {version ? `v${version}` : ''}
      </div>
    </div>
  );
}
