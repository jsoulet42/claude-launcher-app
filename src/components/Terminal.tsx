import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTauriEvent } from '../hooks/useTauriEvent';
import type { TerminalOutputEvent, TerminalExitEvent, TerminalErrorEvent } from '../types/ipc';
import './Terminal.css';

interface TerminalProps {
  terminalId: string;
  onResize?: (cols: number, rows: number) => void;
}

const TERMINAL_OPTIONS = {
  fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: 'bar' as const,
  scrollback: 5000,
  theme: {
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
};

export function Terminal({ terminalId, onResize }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ipcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastColsRef = useRef(0);
  const lastRowsRef = useRef(0);

  // Fit xterm immediately, debounce only the IPC resize call
  const doFit = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current) return;
    const container = containerRef.current;
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) return;

    fitAddonRef.current.fit();
    const cols = termRef.current.cols;
    const rows = termRef.current.rows;

    // Only send IPC if dimensions actually changed
    if (cols !== lastColsRef.current || rows !== lastRowsRef.current) {
      lastColsRef.current = cols;
      lastRowsRef.current = rows;
      onResize?.(cols, rows);

      // Debounce IPC call to ConPTY (100ms)
      if (ipcTimerRef.current) clearTimeout(ipcTimerRef.current);
      ipcTimerRef.current = setTimeout(() => {
        invoke('resize_terminal', {
          params: { id: terminalId, cols, rows },
        }).catch(() => {});
      }, 100);
    }
  }, [terminalId, onResize]);

  // Mount: create xterm instance
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // WebGL addon with fallback
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // Canvas fallback — silent
    }

    term.open(el);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initial fit
    fitAddon.fit();
    const cols = term.cols;
    const rows = term.rows;
    lastColsRef.current = cols;
    lastRowsRef.current = rows;
    invoke('resize_terminal', {
      params: { id: terminalId, cols, rows },
    }).catch(() => {});
    onResize?.(cols, rows);

    // Input: user keystrokes → ConPTY
    const dataDisposable = term.onData((data) => {
      invoke('write_terminal', {
        params: { id: terminalId, data },
      }).catch(() => {});
    });

    // Clipboard: Ctrl+C (copy if selection, else send to ConPTY) + Ctrl+V (paste)
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;

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
            invoke('write_terminal', {
              params: { id: terminalId, data: text },
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
      dataDisposable.dispose();
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

  // Re-fit when the element becomes visible (tab switch)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        doFit();
      }
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, [terminalId, doFit]);

  return <div ref={containerRef} className="terminal-container" />;
}
