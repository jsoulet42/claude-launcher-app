import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface Project {
  name: string;
  path: string;
  color?: string;
  icon?: string;
  default_command?: string;
  initial_command?: string | null;
}

interface ConfigData {
  version?: string;
  projects: Record<string, Project>;
  presets: Record<string, unknown>;
  layouts: Record<string, unknown>;
}

function App() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [version, setVersion] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ConfigData>("get_config")
      .then(setConfig)
      .catch((e) => {
        console.error("Failed to load config:", e);
        setError(String(e));
      });

    invoke<string>("get_app_version")
      .then(setVersion)
      .catch(console.error);
  }, []);

  if (error) {
    return (
      <div className="app">
        <header className="header">
          <h1>Claude Launcher</h1>
        </header>
        <main className="main">
          <div className="error-panel">
            <span className="error-icon">!</span>
            <h2>Configuration introuvable</h2>
            <p className="error-message">{error}</p>
            <p className="error-hint">
              Placez un fichier <code>config.json</code> dans le repertoire de
              lancement ou a cote de l'executable.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="app">
        <header className="header">
          <h1>Claude Launcher</h1>
        </header>
        <main className="main">
          <p className="loading">Chargement...</p>
        </main>
      </div>
    );
  }

  const projects = Object.entries(config.projects);
  const presetCount = Object.keys(config.presets).length;
  const layoutCount = Object.keys(config.layouts).length;

  return (
    <div className="app">
      <header className="header">
        <h1>Claude Launcher</h1>
        {version && <span className="version">v{version}</span>}
      </header>

      <main className="main">
        <section className="section">
          <h2>Projets</h2>
          {projects.length === 0 ? (
            <p className="empty">Aucun projet configure</p>
          ) : (
            <ul className="project-list">
              {projects.map(([slug, project]) => (
                <li key={slug} className="project-item">
                  <span
                    className="project-color"
                    style={{ backgroundColor: project.color || "#6c7086" }}
                  />
                  <div className="project-info">
                    <span className="project-name">{project.name}</span>
                    <span className="project-path">{project.path}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section stats">
          <div className="stat">
            <span className="stat-value">{projects.length}</span>
            <span className="stat-label">Projets</span>
          </div>
          <div className="stat">
            <span className="stat-value">{presetCount}</span>
            <span className="stat-label">Presets</span>
          </div>
          <div className="stat">
            <span className="stat-value">{layoutCount}</span>
            <span className="stat-label">Layouts</span>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Claude Launcher {version ? `v${version}` : ""}</span>
        <span className="footer-hint">Tauri v2 + React + Rust</span>
      </footer>
    </div>
  );
}

export default App;
