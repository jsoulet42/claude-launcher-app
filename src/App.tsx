import { useEffect, useCallback } from 'react';
import { useConfigStore } from './stores/config';
import { useTerminalsStore } from './stores/terminals';
import { useProjectsStore } from './stores/projects';
import { useUiStore } from './stores/ui';
import { useTauriEvent } from './hooks/useTauriEvent';
import { AppLayout } from './components/AppLayout';
import { TabBar } from './components/TabBar';
import { SplitLayout } from './components/SplitLayout';
import { ProjectDetail } from './components/ProjectDetail';
import { PresetDetail } from './components/PresetDetail';
import type { TerminalExitEvent, TerminalErrorEvent } from './types/ipc';
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
  const selectedProject = useProjectsStore((s) => s.selectedProject);
  const showProjectDetail = useUiStore((s) => s.showProjectDetail);
  const showPresetDetail = useUiStore((s) => s.showPresetDetail);
  const selectedPreset = useUiStore((s) => s.selectedPreset);

  // Global listener: update terminal status on exit
  const handleExit = useCallback(
    (payload: TerminalExitEvent) => {
      updateTerminalStatus(payload.id, 'exited');
    },
    [updateTerminalStatus]
  );
  useTauriEvent<TerminalExitEvent>('terminal:exit', handleExit);

  // Global listener: update terminal status on error
  const handleError = useCallback(
    (payload: TerminalErrorEvent) => {
      updateTerminalStatus(payload.id, 'error');
    },
    [updateTerminalStatus]
  );
  useTauriEvent<TerminalErrorEvent>('terminal:error', handleError);

  // Priority: PresetDetail > ProjectDetail > Terminals > Welcome
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
  const { loading, error, config, loadConfig } = useConfigStore();
  const startPolling = useProjectsStore((s) => s.startPolling);
  const stopPolling = useProjectsStore((s) => s.stopPolling);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Start git polling once config is loaded
  useEffect(() => {
    if (config && Object.keys(config.projects).length > 0) {
      startPolling(config.projects);
      return () => stopPolling();
    }
  }, [config, startPolling, stopPolling]);

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

  return (
    <AppLayout>
      <TerminalArea />
    </AppLayout>
  );
}

export default App;
