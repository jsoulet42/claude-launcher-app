import { useEffect, useCallback } from 'react';
import { useConfigStore } from './stores/config';
import { useTerminalsStore } from './stores/terminals';
import { useTauriEvent } from './hooks/useTauriEvent';
import { AppLayout } from './components/AppLayout';
import { TabBar } from './components/TabBar';
import { SplitLayout } from './components/SplitLayout';
import type { TerminalExitEvent, TerminalErrorEvent } from './types/ipc';
import './App.css';

function WelcomeScreen() {
  const createWorkspace = useTerminalsStore((s) => s.createWorkspace);

  return (
    <div className="welcome">
      <div className="welcome-content">
        <p className="welcome-message">Aucun terminal ouvert</p>
        <p className="welcome-hint">
          Cliquez sur [+] ou le bouton ci-dessous pour lancer un terminal
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

  if (workspaces.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <>
      <TabBar />
      <div className="terminal-area">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className="workspace-container"
            style={{
              display: ws.id === activeWorkspaceId ? 'flex' : 'none',
            }}
          >
            <SplitLayout node={ws.layout} workspaceId={ws.id} />
          </div>
        ))}
      </div>
    </>
  );
}

function App() {
  const { loading, error, loadConfig } = useConfigStore();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

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
