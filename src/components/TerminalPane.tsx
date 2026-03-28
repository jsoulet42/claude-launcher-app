import { useState } from 'react';
import { useTerminalsStore } from '../stores/terminals';
import { Terminal } from './Terminal';
import './TerminalPane.css';

interface TerminalPaneProps {
  paneId: string;
  terminalId: string;
  onClose: () => void;
  onSplit: (direction: 'horizontal' | 'vertical') => void;
}

export function TerminalPane(props: TerminalPaneProps) {
  const { terminalId, onClose, onSplit } = props;
  const terminal = useTerminalsStore((s) => s.terminals[terminalId]);
  const [showSplitMenu, setShowSplitMenu] = useState(false);

  const status = terminal?.status ?? 'running';
  const shell = terminal?.shell
    ? terminal.shell.replace(/\.exe$/i, '')
    : 'shell';
  const cwd = terminal?.cwd
    ? terminal.cwd.split(/[/\\]/).pop() || terminal.cwd
    : '';

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-header">
        <span className="terminal-pane-shell">{shell}</span>
        <span className={`terminal-pane-status terminal-pane-status--${status}`} />
        <span className="terminal-pane-cwd" title={terminal?.cwd ?? ''}>
          {cwd}
        </span>
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
