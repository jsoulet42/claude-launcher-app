import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal as XTerm } from '@xterm/xterm';
import type { ITheme, ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { terminalRefs } from '../terminalRefs';
import { registerTerminalHandlers } from '../terminalBus';
import { useDiagnosticsStore } from '../stores/diagnostics';
import type { TerminalOutputEvent, TerminalBufferResult } from '../types/ipc';
import './Terminal.css';

interface TerminalProps {
  terminalId: string;
  /** Workspace actif — pilote le cycle de vie WebGL et le refit. */
  visible: boolean;
  /** Pane focalisé dans le store — pilote le focus DOM réel. */
  focused: boolean;
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

const IS_WINDOWS = navigator.userAgent.includes('Windows');

const TERMINAL_OPTIONS: ITerminalOptions = {
  // Requis par UnicodeGraphemesAddon (term.unicode est une API "proposed"
  // dans xterm v6) — sans ce flag, loadAddon JETTE au montage et fait
  // tomber tout l'arbre React (écran vide).
  allowProposedApi: true,
  // Windows fonts first (Cascadia ships with Win11), then common Linux
  // monospace fonts — Fedora/Ubuntu ship none of the Windows ones, and the
  // generic `monospace` fallback has unreliable glyph coverage/metrics
  // (sidebar-style boxes for powerline/nerd glyphs in zsh themes).
  fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', 'DejaVu Sans Mono', 'Noto Sans Mono', 'Liberation Mono', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: 'bar',
  // P34 — `outline` made inactive terminals paint a visible cursor that
  // followed every CUP emitted by Claude Code's UI (spinners, border redraws),
  // producing phantom cursors jumping around the UI zone. `none` hides the
  // cursor entirely when the terminal loses focus. Combined with centralized
  // focus management (a single terminal holds DOM focus at any time), only
  // the focused terminal ever paints a cursor.
  cursorInactiveStyle: 'none',
  scrollback: 5000,
  // ConPTY rewrites the screen on resize; this hint enables xterm's
  // Windows-specific reflow workarounds (broken/duplicated wrapped lines).
  ...(IS_WINDOWS ? { windowsPty: { backend: 'conpty' as const } } : {}),
  theme: XTERM_THEMES.dark,
};

export function Terminal({ terminalId, visible, focused, onResize }: TerminalProps) {
  const renderer = useDiagnosticsStore((s) => s.renderer);
  const containerRef = useRef<HTMLDivElement>(null);
  // Miroir de la prop visible pour les callbacks/timers du mount effect.
  // CRUCIAL : les renderers WebGL et DOM ne mesurent pas la même taille de
  // cellule (ex. 8.00px vs 8.21px). Un fit exécuté pendant que le terminal
  // est caché (WebGL libéré → renderer DOM) calcule une AUTRE grille, resize
  // le PTY, et fait reflower l'app interne (Claude Code) à chaque changement
  // de tab. Règle : on ne fitte JAMAIS un terminal caché — sa grille reste
  // celle du dernier état visible; le refit a lieu au retour visible, après
  // rechargement du WebGL.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const ipcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const lastColsRef = useRef(0);
  const lastRowsRef = useRef(0);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_FIT_RETRIES = 10;

  // Core fit logic — call when actually ready to reflow xterm.
  // No-op while hidden (see visibleRef comment).
  const doFitImmediate = useCallback(() => {
    if (!visibleRef.current) return;
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

  // Mount: create xterm instance. Deps = [terminalId] only — the renderer
  // toggle no longer remounts xterm (WebGL has its own lifecycle effect),
  // so the local buffer survives diagnostics toggling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({ ...TERMINAL_OPTIONS, theme: getXtermTheme() });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Grapheme-aware unicode handling — Claude Code output is dense in
    // braille spinners, emoji and box drawing; default width tables
    // misalign them (display artifacts on wrapped/redrawn frames).
    term.loadAddon(new UnicodeGraphemesAddon());
    term.unicode.activeVersion = '15-graphemes';

    // Web links: Ctrl+Click to open URLs in system browser
    term.loadAddon(new WebLinksAddon((_event, url) => {
      shellOpen(url).catch(() => {});
    }));

    term.open(el);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initial fit — delay 300ms to avoid ConPTY race condition where
    // ResizePseudoConsole is ignored if called too soon after CreateProcess
    // (microsoft/terminal#10400). The race window is timing-dependent: when
    // the first resize IS swallowed, ConPTY keeps the creation size (120x30)
    // forever while xterm displays fewer rows — bottom-anchored TUIs (Claude
    // Code) then draw their top rows above the viewport. The confirmation
    // re-sends at 900/2100ms are no-ops when the first resize was applied
    // (same-size resize is dropped by ConPTY) and repair the desync when it
    // was swallowed.
    const initialFitTimers = [300, 900, 2100].map((delay) =>
      setTimeout(() => {
        // Monté caché (restore de session) : pas de fit — la grille sera
        // établie au premier passage visible avec les métriques WebGL.
        if (!visibleRef.current) return;
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
      }, delay)
    );

    // Input: user keystrokes + xterm-handled Ctrl+V (clipboard text) → ConPTY.
    // When the inner app enables bracketed paste mode (\x1b[?2004h, e.g. pwsh),
    // xterm traps Ctrl+V itself and fires onData with the clipboard text.
    // When the inner app does NOT enable bracketed paste (e.g. Claude Code),
    // xterm forwards the raw Ctrl+V byte (\x16 SYN) — we intercept here and
    // substitute the clipboard content.
    const dataDisposable = term.onData((data) => {
      if (data === '\x16') {
        const pasteId = crypto.randomUUID().slice(0, 8);
        navigator.clipboard.readText().then((text) => {
          if (!text) return;
          console.log(`[paste ${pasteId}] len=${text.length}`);
          // Wrap in bracketed paste so multi-line text isn't executed line-by-line
          // by the shell. Apps that support bracketed paste (pwsh, Claude Code)
          // will treat it as a single paste block.
          const bracketedText = '\x1b[200~' + text + '\x1b[201~';
          invoke('write_terminal', {
            params: { id: terminalId, data: bracketedText },
          }).catch((err) => {
            console.error(`[paste ${pasteId}] write failed:`, err);
          });
        });
        return;
      }
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

      // Ctrl+V is handled natively by xterm.js: its internal Ctrl+V handler
      // reads the clipboard and fires onData with the text, which is written
      // to ConPTY by our onData listener. Intercepting Ctrl+V here caused
      // double-paste (xterm's internal handler runs in parallel to ours).

      return true;
    });

    // --- Output wiring with scrollback replay ---
    // Phase 'replay': queue incoming events while fetching the backend
    // snapshot. Phase 'live': write events directly. The per-terminal seq
    // stamped by the backend dedupes events already contained in the
    // snapshot — no lost first-prompt, no doubled chunks.
    let mode: 'replay' | 'live' = 'replay';
    const queue: TerminalOutputEvent[] = [];

    const unregister = registerTerminalHandlers(terminalId, {
      onOutput: (e) => {
        if (mode === 'replay') {
          queue.push(e);
        } else {
          term.write(e.data);
        }
      },
      onExit: (e) => {
        term.write(`\r\n\x1b[31mProcess exited (code ${e.code})\x1b[0m\r\n`);
      },
      onError: (e) => {
        term.write(`\r\n\x1b[33mError: ${e.error}\x1b[0m\r\n`);
      },
    });

    invoke<TerminalBufferResult>('get_terminal_buffer', {
      params: { id: terminalId },
    })
      .then((snapshot) => {
        if (termRef.current !== term) return; // unmounted meanwhile
        if (snapshot.data) term.write(snapshot.data);
        for (const e of queue) {
          if (e.seq > snapshot.seq) term.write(e.data);
        }
        queue.length = 0;
        mode = 'live';
      })
      .catch(() => {
        // Terminal inconnu côté backend (déjà fermé) — flush et passe en live.
        for (const e of queue) term.write(e.data);
        queue.length = 0;
        mode = 'live';
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
      initialFitTimers.forEach(clearTimeout);
      if (ipcTimerRef.current) clearTimeout(ipcTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      dataDisposable.dispose();
      unregister();
      terminalRefs.delete(terminalId);
      if (webglRef.current) {
        webglRef.current.dispose();
        webglRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebGL lifecycle — a WebGL context is held ONLY while the terminal is in
  // the active workspace. WebView2 caps live WebGL contexts (~16); with many
  // tabs × panes, permanent contexts get evicted by the browser → black or
  // frozen terminals on tab return. Hidden terminals fall back to the DOM
  // renderer (their buffer keeps updating; cheap while invisible).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (visible && renderer === 'webgl' && !webglRef.current) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          // Context evicted by the browser — release it; the next
          // visibility transition will retry a fresh context.
          console.warn(`[terminal ${terminalId}] WebGL context lost, releasing`);
          webgl.dispose();
          if (webglRef.current === webgl) webglRef.current = null;
        });
        term.loadAddon(webgl);
        webglRef.current = webgl;
      } catch {
        console.warn(`[terminal ${terminalId}] WebGL unavailable, DOM renderer`);
      }
    } else if ((!visible || renderer !== 'webgl') && webglRef.current) {
      webglRef.current.dispose();
      webglRef.current = null;
    }
  }, [visible, renderer, terminalId]);

  // Visibility — when the workspace becomes active, refit (the WebGL effect
  // above has already re-loaded the addon, so the measurement basis is the
  // WebGL one) and repaint the viewport. Fits are frozen while hidden, so in
  // the common case the grid is UNCHANGED here → the resize IPC is a ConPTY
  // no-op and the inner app does not reflow. If the window was resized while
  // this tab was hidden, this is where the single catch-up resize happens.
  // No force/nudge here: grids are stable now, and nudging redrew Claude
  // Code twice per tab switch (visible artifacts).
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!fitAddonRef.current || !termRef.current || !container) return;
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
      fitAddonRef.current.fit();
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      lastColsRef.current = cols;
      lastRowsRef.current = rows;
      invoke('resize_terminal', {
        params: { id: terminalId, cols, rows },
      }).catch(() => {});
      onResize?.(cols, rows);
      termRef.current.refresh(0, termRef.current.rows - 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, terminalId, onResize]);

  // Focus — keep real DOM focus in sync with the store's focused pane.
  // Without this, switching tabs or clicking a pane header moved the logical
  // focus while keystrokes kept going to the previously focused terminal.
  useEffect(() => {
    if (focused && visible) {
      termRef.current?.focus();
    }
  }, [focused, visible]);

  // Sync xterm theme on theme-changed event
  useEffect(() => {
    const updateXtermTheme = () => {
      if (!termRef.current) return;
      termRef.current.options.theme = getXtermTheme();
    };
    document.addEventListener('theme-changed', updateXtermTheme);
    return () => document.removeEventListener('theme-changed', updateXtermTheme);
  }, []);

  return <div ref={containerRef} className="terminal-container" />;
}
