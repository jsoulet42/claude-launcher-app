import { useEffect } from 'react';
import { useConfigStore } from './stores/config';
import { AppLayout } from './components/AppLayout';
import './App.css';

function WelcomeScreen() {
  const config = useConfigStore((s) => s.config);
  const presets = config ? Object.entries(config.presets) : [];
  const defaultPreset = presets.length > 0 ? presets[0] : null;

  return (
    <div className="welcome">
      <div className="welcome-content">
        <p className="welcome-message">Aucun terminal ouvert</p>
        <p className="welcome-hint">
          Choisissez un projet et un preset dans la barre laterale pour commencer
        </p>
        {defaultPreset && (
          <button className="welcome-action" disabled>
            Lancer {defaultPreset[1].name}
          </button>
        )}
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
      <WelcomeScreen />
    </AppLayout>
  );
}

export default App;
