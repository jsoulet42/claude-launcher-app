import { useState, useRef, useEffect, useCallback } from 'react';
import { useTerminalsStore } from '../stores/terminals';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { Terminal } from './Terminal';
import './TerminalPane.css';

interface TerminalPaneProps {
  paneId: string;
  terminalId: string;
  onClose: () => void;
  onSplit: (direction: 'horizontal' | 'vertical') => void;
}

const STATUS_TITLES: Record<string, string> = {
  running: 'Running',
  exited: 'Exited',
  error: 'Error',
};

export function TerminalPane(props: TerminalPaneProps) {
  const { terminalId, onClose, onSplit } = props;
  const terminal = useTerminalsStore((s) => s.terminals[terminalId]);
  const lastActivityTs = useTerminalsStore(
    (s) => s.lastActivity[terminalId] ?? 0
  );
  const [showSplitMenu, setShowSplitMenu] = useState(false);

  const status = terminal?.status ?? 'running';
  const shell = terminal?.shell
    ? terminal.shell.replace(/\.exe$/i, '')
    : 'shell';
  const cwd = terminal?.cwd
    ? terminal.cwd.split(/[/\\]/).pop() || terminal.cwd
    : '';

  // Uptime: freeze after exit by using a fixed "exitedAt" timestamp
  const exitedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (status === 'exited' && exitedAtRef.current === null) {
      exitedAtRef.current = Date.now();
    }
  }, [status]);

  const createdAt = terminal?.created_at ?? 0;
  // For uptime, when exited we compute a frozen delta
  const uptimeTimestamp =
    status === 'exited' && exitedAtRef.current !== null
      ? Date.now() - (exitedAtRef.current - createdAt)
      : createdAt;
  const uptime = useRelativeTime(uptimeTimestamp || null);

  // Last activity
  const activity = useRelativeTime(
    status !== 'exited' ? lastActivityTs || null : null
  );

  // Pulse animation via ref + setTimeout (no re-render)
  const dotRef = useRef<HTMLSpanElement>(null);
  const prevActivityRef = useRef(lastActivityTs);

  const triggerPulse = useCallback(() => {
    const el = dotRef.current;
    if (!el) return;
    el.classList.remove('terminal-pane-status--pulse');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('terminal-pane-status--pulse');
  }, []);

  useEffect(() => {
    if (lastActivityTs !== prevActivityRef.current && status === 'running') {
      prevActivityRef.current = lastActivityTs;
      triggerPulse();
      const timer = setTimeout(() => {
        dotRef.current?.classList.remove('terminal-pane-status--pulse');
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [lastActivityTs, status, triggerPulse]);

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-header">
        <span className="terminal-pane-shell">{shell}</span>
        <span
          ref={dotRef}
          className={`terminal-pane-status terminal-pane-status--${status}`}
          title={STATUS_TITLES[status] || status}
        />
        <span className="terminal-pane-cwd" title={terminal?.cwd ?? ''}>
          {cwd}
        </span>
        {uptime && (
          <span className="terminal-pane-uptime" title="Uptime">
            &#x23F1; {uptime}
          </span>
        )}
        {status === 'exited' && terminal?.exit_code != null ? (
          <span
            className={`terminal-pane-exit ${terminal.exit_code === 0 ? 'terminal-pane-exit--ok' : 'terminal-pane-exit--fail'}`}
          >
            exit: {terminal.exit_code}
          </span>
        ) : (
          activity && (
            <span className="terminal-pane-activity">last: {activity}</span>
          )
        )}
        <div className="terminal-pane-split-wrapper">
          <button
            className="terminal-pane-split"
            title="Split"
            onClick={() => setShowSplitMenu(!showSplitMenu)}
          >
            &#x229E;
          </button>
          {showSplitMenu && (
            <div className="terminal-pane-split-menu">
              <button
                onClick={() => {
                  onSplit('horizontal');
                  setShowSplitMenu(false);
                }}
              >
                &#x2194; Horizontal
              </button>
              <button
                onClick={() => {
                  onSplit('vertical');
                  setShowSplitMenu(false);
                }}
              >
                &#x2195; Vertical
              </button>
            </div>
          )}
        </div>
        <button
          className="terminal-pane-close"
          title="Close"
          onClick={onClose}
        >
          &#x2715;
        </button>
      </div>
      <div className="terminal-pane-body">
        <Terminal terminalId={terminalId} />
      </div>
    </div>
  );
}
