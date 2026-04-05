import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore } from './stores/config';
import { useTerminalsStore, buildSessionSnapshot } from './stores/terminals';
import { useProjectsStore } from './stores/projects';
import { useUiStore } from './stores/ui';
import { useThemeStore } from './stores/theme';
import { useDiagnosticsStore } from './stores/diagnostics';
import type { ThemeName } from './stores/theme';
import { useTauriEvent } from './hooks/useTauriEvent';
import { useHotkeys } from './hooks/useHotkeys';
import { AppLayout } from './components/AppLayout';
import { OnboardingWizard } from './components/OnboardingWizard';
import { TabBar } from './components/TabBar';
import { SplitLayout } from './components/SplitLayout';
import { ProjectDetail } from './components/ProjectDetail';
import { PresetDetail } from './components/PresetDetail';
import { SettingsPanel } from './components/SettingsPanel';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { TerminalExitEvent, TerminalErrorEvent, TerminalOutputEvent, ClaudeDoneEvent, SavedSession } from './types/ipc';
import './App.css';

function WelcomeScreen() {
  const createWorkspace = useTerminalsStore((s) => s.createWorkspace);

  return (
    <div className="welcome">
      <div className="welcome-content">
        <p className="welcome-message">Aucun terminal ouvert</p>
        <p className="welcome-hint">
          Sélectionnez un projet dans la sidebar ou lancez un terminal directement
        </p>
        <button
          className="welcome-action"
          onClick={() => createWorkspace()}
        >
          Lancer un terminal
        </button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="state-screen">
      <p className="state-message">Chargement de la configuration...</p>
      <div className="state-dots">
        <span className="state-dot" />
        <span className="state-dot" />
        <span className="state-dot" />
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="state-screen">
      <span className="state-icon state-icon--error">&#x26A0;</span>
      <h2 className="state-title">Erreur de configuration</h2>
      <p className="state-detail">{message}</p>
      <p className="state-hint">
        Placez un fichier <code>config.json</code> dans le repertoire de lancement
        ou a cote de l'executable.
      </p>
    </div>
  );
}

function TerminalArea() {
  const workspaces = useTerminalsStore((s) => s.workspaces);
  const activeWorkspaceId = useTerminalsStore((s) => s.activeWorkspaceId);
  const updateTerminalStatus = useTerminalsStore(
    (s) => s.updateTerminalStatus
  );
  const updateLastActivity = useTerminalsStore(
    (s) => s.updateLastActivity
  );
  const addAlert = useTerminalsStore((s) => s.addAlert);
  const updateClaudeTitle = useTerminalsStore((s) => s.updateClaudeTitle);
  const selectedProject = useProjectsStore((s) => s.selectedProject);
  const showProjectDetail = useUiStore((s) => s.showProjectDetail);
  const showPresetDetail = useUiStore((s) => s.showPresetDetail);
  const showSettings = useUiStore((s) => s.showSettings);
  const selectedPreset = useUiStore((s) => s.selectedPreset);

  // Request notification permission on mount
  useEffect(() => {
    (async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const perm = await requestPermission();
          granted = perm === 'granted';
        }
        if (!granted) {
          console.error('Notification permission denied');
        }
      } catch (err) {
        console.error('Failed to check notification permission:', err);
      }
    })();
  }, []);

  // Global listener: claude:done — alert + notification + taskbar flash
  const lastDoneRef = useRef<Record<string, number>>({});
  const handleClaudeDone = useCallback(
    (payload: ClaudeDoneEvent) => {
      const now = Date.now();
      const lastTs = lastDoneRef.current[payload.id] ?? 0;
      // Debounce: ignore if last done was less than 3s ago
      if (now - lastTs < 3000) return;
      lastDoneRef.current[payload.id] = now;

      addAlert(payload.id);
      updateClaudeTitle(payload.id, payload.title);

      // Send OS notification
      (async () => {
        try {
          const granted = await isPermissionGranted();
          if (granted) {
            sendNotification({
              title: 'Claude a termin\u00e9',
              body: `${payload.title}${payload.last_message ? '\n' + payload.last_message : ''}`,
            });
          }
        } catch (err) {
          console.error('Failed to send notification:', err);
        }
      })();

      // Flash taskbar
      (async () => {
        try {
          await getCurrentWindow().requestUserAttention(2);
        } catch (err) {
          console.error('Failed to request user attention:', err);
        }
      })();
    },
    [addAlert, updateClaudeTitle]
  );
  useTauriEvent<ClaudeDoneEvent>('claude:done', handleClaudeDone);

  // Global listener: update terminal status on exit (with exitCode)
  const handleExit = useCallback(
    (payload: TerminalExitEvent) => {
      updateTerminalStatus(payload.id, 'exited', payload.code);
    },
    [updateTerminalStatus]
  );
  useTauriEvent<TerminalExitEvent>('terminal:exit', handleExit);

  // Global listener: track last activity on output (throttled to 1s)
  const lastActivityTimestamps = useRef<Record<string, number>>({});
  const handleOutput = useCallback(
    (payload: TerminalOutputEvent) => {
      const now = Date.now();
      const last = lastActivityTimestamps.current[payload.id] ?? 0;
      if (now - last >= 1000) {
        lastActivityTimestamps.current[payload.id] = now;
        updateLastActivity(payload.id);
      }
    },
    [updateLastActivity]
  );
  useTauriEvent<TerminalOutputEvent>('terminal:output', handleOutput);

  // Global listener: update terminal status on error
  const handleError = useCallback(
    (payload: TerminalErrorEvent) => {
      updateTerminalStatus(payload.id, 'error');
    },
    [updateTerminalStatus]
  );
  useTauriEvent<TerminalErrorEvent>('terminal:error', handleError);

  // Priority: Settings > PresetDetail > ProjectDetail > Terminals > Welcome
  // Settings overlay
  if (showSettings) {
    if (workspaces.length === 0) {
      return <SettingsPanel />;
    }
    return (
      <>
        <TabBar />
        <SettingsPanel />
      </>
    );
  }

  // Preset detail overlay
  if (showPresetDetail && selectedPreset) {
    if (workspaces.length === 0) {
      return <PresetDetail key={selectedPreset} presetSlug={selectedPreset} />;
    }
    return (
      <>
        <TabBar />
        <PresetDetail key={selectedPreset} presetSlug={selectedPreset} />
      </>
    );
  }

  // Show project detail when no workspaces and a project is selected
  if (workspaces.length === 0 && selectedProject) {
    return <ProjectDetail key={selectedProject} projectSlug={selectedProject} />;
  }

  if (workspaces.length === 0) {
    return <WelcomeScreen />;
  }

  // Show project detail overlay when user clicks a project while workspaces exist
  if (showProjectDetail && selectedProject) {
    return (
      <>
        <TabBar />
        <ProjectDetail key={selectedProject} projectSlug={selectedProject} />
      </>
    );
  }

  return (
    <>
      <TabBar />
      <div className="terminal-area">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className={`workspace-container ${ws.id === activeWorkspaceId ? 'workspace-active' : 'workspace-hidden'}`}
          >
            <SplitLayout node={ws.layout} workspaceId={ws.id} />
          </div>
        ))}
      </div>
    </>
  );
}

function App() {
  useHotkeys();
  const { loading, error, config, loadConfig } = useConfigStore();
  const startPolling = useProjectsStore((s) => s.startPolling);
  const stopPolling = useProjectsStore((s) => s.stopPolling);

  const sessionRestoredRef = useRef(false);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // P34 diagnostic — sync ANSI cursor debug flag from frontend store to Rust backend.
  // Runs on boot (picks up persisted localStorage value) and on every toggle.
  const ansiDebug = useDiagnosticsStore((s) => s.ansiDebug);
  useEffect(() => {
    invoke('set_ansi_cursor_debug_cmd', { params: { enabled: ansiDebug } }).catch((err) => {
      console.error('[diagnostics] failed to sync ANSI debug flag:', err);
    });
  }, [ansiDebug]);

  // Apply theme from config on load
  useEffect(() => {
    if (!config) return;
    const themeName = (config.preferences?.theme || 'dark') as ThemeName;
    const customColors = config.preferences?.custom_theme ?? null;
    useThemeStore.getState().applyTheme(themeName, customColors);
    useThemeStore.getState().commitTheme();
  }, [config]);

  // Start git polling once config is loaded
  useEffect(() => {
    if (config && Object.keys(config.projects).length > 0) {
      startPolling(config.projects);
      return () => stopPolling();
    }
  }, [config, startPolling, stopPolling]);

  // Session restore: load saved session on startup (once)
  useEffect(() => {
    if (!config || loading || sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;

    (async () => {
      try {
        const session = await invoke<SavedSession | null>('load_session');
        if (session && session.workspaces.length > 0) {
          await useTerminalsStore.getState().restoreSession(session);
          await invoke('clear_session');
        }
      } catch (e) {
        console.error('Failed to restore session:', e);
      }
    })();
  }, [config, loading]);

  // Session save: on window close
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      const snapshot = buildSessionSnapshot();
      if (snapshot) {
        await invoke('save_session', { session: snapshot }).catch(
          (e: unknown) => console.error('Session save on close failed:', e)
        );
      } else {
        // No live workspaces — clear any stale session file left by periodic save
        await invoke('clear_session').catch(
          (e: unknown) => console.error('Session clear on close failed:', e)
        );
      }
      // Let the window close after saving
      await getCurrentWindow().destroy();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Session save: periodic (every 30s, crash safety net)
  useEffect(() => {
    const interval = setInterval(async () => {
      const snapshot = buildSessionSnapshot();
      if (snapshot) {
        await invoke('save_session', { session: snapshot }).catch(
          (e: unknown) =>
            console.error('Session periodic save failed:', e)
        );
      } else {
        // No live workspaces — clear stale session file so closed tabs don't come back
        await invoke('clear_session').catch(() => {});
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <LoadingScreen />
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-loading">
        <ErrorScreen message={error} />
      </div>
    );
  }

  const hasProjects = config && Object.keys(config.projects).length > 0;
  const onboardingDone = config?.preferences?.onboarding_completed;

  if (config && !hasProjects && !onboardingDone) {
    return (
      <OnboardingWizard
        onComplete={() => loadConfig()}
        onSkip={() => loadConfig()}
      />
    );
  }

  return (
    <AppLayout>
      <TerminalArea />
    </AppLayout>
  );
}

export default App;
