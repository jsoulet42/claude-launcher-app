import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal as XTerm } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useTauriEvent } from '../hooks/useTauriEvent';
import { terminalRefs } from '../terminalRefs';
import type { TerminalOutputEvent, TerminalExitEvent, TerminalErrorEvent } from '../types/ipc';
import './Terminal.css';

interface TerminalProps {
  terminalId: string;
  onResize?: (cols: number, rows: number) => void;
}

// --- xterm.js theme palettes (Catppuccin) ---

const XTERM_THEMES: Record<'dark' | 'light', ITheme> = {
  dark: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#585b70',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  light: {
    background: '#faf4ed',
    foreground: '#575279',
    cursor: '#9893a5',
    selectionBackground: '#dfdad4',
    black: '#6e6a86',
    red: '#b4637a',
    green: '#56949f',
    yellow: '#ea9d34',
    blue: '#286983',
    magenta: '#907aa9',
    cyan: '#56949f',
    white: '#d4cec6',
    brightBlack: '#9893a5',
    brightRed: '#b4637a',
    brightGreen: '#56949f',
    brightYellow: '#ea9d34',
    brightBlue: '#286983',
    brightMagenta: '#907aa9',
    brightCyan: '#56949f',
    brightWhite: '#e8e0d8',
  },
};

function getXtermTheme(): ITheme {
  const dataTheme = document.documentElement.getAttribute('data-theme') || 'dark';

  if (dataTheme === 'light') return XTERM_THEMES.light;
  if (dataTheme === 'custom') {
    const style = getComputedStyle(document.documentElement);
    return {
      ...XTERM_THEMES.dark,
      background: style.getPropertyValue('--bg-terminal').trim() || XTERM_THEMES.dark.background,
      foreground: style.getPropertyValue('--text-primary').trim() || XTERM_THEMES.dark.foreground,
      cursor: style.getPropertyValue('--accent').trim() || XTERM_THEMES.dark.cursor,
      selectionBackground: (style.getPropertyValue('--bg-selected').trim() || '#585b70') + '80',
    };
  }
  return XTERM_THEMES.dark;
}

const TERMINAL_OPTIONS = {
  fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: 'bar' as const,
  scrollback: 5000,
  theme: XTERM_THEMES.dark,
};

export function Terminal({ terminalId, onResize }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ipcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const lastColsRef = useRef(0);
  const lastRowsRef = useRef(0);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_FIT_RETRIES = 10;

  // Core fit logic — call when actually ready to reflow xterm
  const doFitImmediate = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current) return;
    const container = containerRef.current;
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) {
      if (retryCountRef.current >= MAX_FIT_RETRIES) return;
      retryCountRef.current++;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => doFitImmediate(), 100);
      return;
    }

    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    fitAddonRef.current.fit();
    const cols = termRef.current.cols;
    const rows = termRef.current.rows;

    if (cols !== lastColsRef.current || rows !== lastRowsRef.current) {
      lastColsRef.current = cols;
      lastRowsRef.current = rows;
      onResize?.(cols, rows);

      if (ipcTimerRef.current) clearTimeout(ipcTimerRef.current);
      ipcTimerRef.current = setTimeout(() => {
        invoke('resize_terminal', {
          params: { id: terminalId, cols, rows },
        }).catch(() => {});
      }, 100);
    }
  }, [terminalId, onResize]);

  // Debounced fit — used by ResizeObserver during continuous resizes
  // Waits 50ms of inactivity before fitting, prevents xterm canvas thrashing
  const doFit = useCallback(() => {
    if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      doFitImmediate();
    }, 50);
  }, [doFitImmediate]);

  // Mount: create xterm instance
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({ ...TERMINAL_OPTIONS, theme: getXtermTheme() });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // WebGL addon with context loss recovery
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.warn('WebGL context lost, attempting recovery...');
        webglAddon.dispose();
        try {
          const newWebgl = new WebglAddon();
          newWebgl.onContextLoss(() => {
            console.warn('WebGL context lost again, falling back to canvas permanently');
            newWebgl.dispose();
          });
          term.loadAddon(newWebgl);
        } catch {
          console.warn('WebGL reload failed, using canvas renderer');
        }
      });
      term.loadAddon(webglAddon);
    } catch {
      console.warn('WebGL not available, using canvas renderer');
    }

    // Web links: Ctrl+Click to open URLs
    term.loadAddon(new WebLinksAddon());

    term.open(el);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initial fit — delay 300ms to avoid ConPTY race condition where
    // ResizePseudoConsole is ignored if called too soon after CreateProcess
    // (microsoft/terminal#10400)
    setTimeout(() => {
      if (!fitAddonRef.current || !termRef.current) return;
      fitAddonRef.current.fit();
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      lastColsRef.current = cols;
      lastRowsRef.current = rows;
      invoke('resize_terminal', {
        params: { id: terminalId, cols, rows },
      }).catch(() => {});
      onResize?.(cols, rows);
    }, 300);

    // Input: user keystrokes → ConPTY
    const dataDisposable = term.onData((data) => {
      invoke('write_terminal', {
        params: { id: terminalId, data },
      }).catch(() => {});
    });

    // Register xterm instance for hotkey focus management
    terminalRefs.set(terminalId, term);

    // Clipboard: Ctrl+C (copy if selection, else send to ConPTY) + Ctrl+V (paste)
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;

      // Block hotkey combos from reaching ConPTY — let them bubble to useHotkeys
      if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
        return false;
      }
      if (e.ctrlKey && e.shiftKey && ['h', 'v', 'w', 'n', 'b', 'H', 'V', 'W', 'N', 'B'].includes(e.key)) {
        return false;
      }
      if (e.ctrlKey && e.key === 'Tab') {
        return false;
      }

      if (e.ctrlKey && e.key === 'c') {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
          term.clearSelection();
          return false;
        }
        return true;
      }

      if (e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            // Bracketed paste: shell receives text as a block, not line by line
            const bracketedText = '\x1b[200~' + text + '\x1b[201~';
            invoke('write_terminal', {
              params: { id: terminalId, data: bracketedText },
            }).catch(() => {});
          }
        });
        return false;
      }

      return true;
    });

    // ResizeObserver — fit immediately, debounce IPC only
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current && termRef.current) {
          doFit();
        }
      });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (ipcTimerRef.current) clearTimeout(ipcTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      dataDisposable.dispose();
      terminalRefs.delete(terminalId);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event: terminal output
  const handleOutput = useCallback(
    (payload: TerminalOutputEvent) => {
      if (payload.id === terminalId) {
        termRef.current?.write(payload.data);
      }
    },
    [terminalId]
  );
  useTauriEvent<TerminalOutputEvent>('terminal:output', handleOutput);

  // Event: terminal exit
  const handleExit = useCallback(
    (payload: TerminalExitEvent) => {
      if (payload.id === terminalId) {
        termRef.current?.write(
          `\r\n\x1b[31mProcess exited (code ${payload.code})\x1b[0m\r\n`
        );
      }
    },
    [terminalId]
  );
  useTauriEvent<TerminalExitEvent>('terminal:exit', handleExit);

  // Event: terminal error
  const handleError = useCallback(
    (payload: TerminalErrorEvent) => {
      if (payload.id === terminalId) {
        termRef.current?.write(
          `\r\n\x1b[33mError: ${payload.error}\x1b[0m\r\n`
        );
      }
    },
    [terminalId]
  );
  useTauriEvent<TerminalErrorEvent>('terminal:error', handleError);

  // Sync xterm theme on theme-changed event
  useEffect(() => {
    const updateXtermTheme = () => {
      if (!termRef.current) return;
      termRef.current.options.theme = getXtermTheme();
    };
    document.addEventListener('theme-changed', updateXtermTheme);
    return () => document.removeEventListener('theme-changed', updateXtermTheme);
  }, []);

  // Re-fit when the element becomes visible (tab switch)
  // Always force a resize IPC on visibility change to send SIGWINCH,
  // even if dimensions haven't changed — this forces CLI apps (like claude)
  // to re-render their layout.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        // Delay slightly to let the browser finish layout after display change
        requestAnimationFrame(() => {
          if (fitAddonRef.current && termRef.current) {
            const container = containerRef.current;
            if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
              fitAddonRef.current.fit();
              const cols = termRef.current.cols;
              const rows = termRef.current.rows;
              lastColsRef.current = cols;
              lastRowsRef.current = rows;
              // Always send resize IPC on visibility — forces SIGWINCH
              invoke('resize_terminal', {
                params: { id: terminalId, cols, rows },
              }).catch(() => {});
              onResize?.(cols, rows);
              // Force full re-render after visibility change
              termRef.current.refresh(0, termRef.current.rows - 1);
            }
          }
        });
      }
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, [terminalId, doFit, onResize]);

  return <div ref={containerRef} className="terminal-container" />;
}
