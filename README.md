# Claude Launcher

Une app desktop multi-plateforme (Windows, Linux, macOS) pour creer et gerer des workspaces de developpement multi-terminaux avec terminaux embarques, principalement pour Claude Code.

Inspire de **cmux**, **Hyper** et **VS Code** — terminaux integres dans l'app, pas dans une fenetre separee.

## Fonctionnalites

- **Terminaux embarques** — vrais terminaux natifs (portable-pty + xterm.js) dans l'app, pas de fenetre externe
- **Workspaces multi-panneaux** — layouts flexibles (horizontal, vertical, grid 2x2, main+sidebar)
- **Gestion de projets** — sidebar interactive avec infos git (branche, status, couleur)
- **Presets intelligents** — suggestions basees sur l'historique, l'heure et le contexte git
- **Sessions persistantes** — sauvegarde/restauration automatique des workspaces
- **Dashboard temps reel** — status des panneaux (process running/exited, uptime)
- **Scanner automatique** — decouverte de projets via scan recursif des dossiers
- **Theming** — dark/light/custom, couleurs par projet dans les headers terminaux
- **Raccourcis clavier** — navigation rapide entre workspaces et panneaux
- **Config wizard** — configuration des projets et presets depuis l'UI, zero JSON a la main
- **Onboarding** — premier lancement guide (scan projets, creation preset)
- **Notifications** — alertes OS quand un agent Claude a termine

## Installation

Telecharger la derniere version depuis [GitHub Releases](https://github.com/jsoulet42/claude-launcher-app/releases/latest) :

### Windows

- Telecharger `Claude Launcher_*_x64-setup.exe`
- Double-clic pour installer (per-user, pas besoin de droits admin)
- Si Windows SmartScreen s'affiche : "Informations complementaires" > "Executer quand meme"

L'app s'installe dans `%LOCALAPPDATA%\Programs\Claude Launcher\` et cree des raccourcis bureau + menu demarrer. Desinstallation propre via Parametres Windows.

### Linux

- **Debian/Ubuntu** : telecharger `claude-launcher_*_amd64.deb`, installer via `sudo dpkg -i <fichier>.deb`
- **AppImage (universel)** : telecharger `claude-launcher_*_amd64.AppImage`, `chmod +x` puis executer

Dependances runtime : `libwebkit2gtk-4.1-0`, `libgtk-3-0`

### macOS

- Telecharger `Claude Launcher_*_aarch64.dmg` (Apple Silicon) ou `*_x64.dmg` (Intel)
- Ouvrir le .dmg, glisser dans Applications
- Premier lancement : clic-droit > Ouvrir (Gatekeeper, app non signee)

## Stack

- **Tauri v2** — framework app desktop cross-platform (WebView2 Windows, WebKitGTK Linux, WebKit macOS)
- **Rust** — backend (config, git, scanner, sessions, PTY, historique)
- **React 18 + TypeScript** — frontend
- **xterm.js 6** — terminal embarque dans le webview
- **Vite 6** — bundler frontend
- **Zustand** — state management
- **portable-pty** — pseudo-terminals cross-platform (ConPTY Windows, PTY Unix)
- **git2** — integration git en Rust

## Architecture

```
claude-launcher/
├── src-tauri/                   # Backend Rust (Tauri v2)
│   └── src/
│       ├── main.rs              # Entry point Tauri
│       ├── lib.rs               # Module exports + Tauri commands
│       ├── config.rs            # Config loader + validation (serde)
│       ├── pty.rs               # PTY manager cross-platform (portable-pty)
│       ├── terminal.rs          # Gestion sessions terminaux
│       ├── git.rs               # Git info (git2 crate)
│       ├── scanner.rs           # Project scanner (walkdir crate)
│       ├── session.rs           # Session save/restore
│       ├── history.rs           # Historique + SmartPresets scoring
│       ├── commands.rs          # Template resolution (initial commands)
│       └── error.rs             # Error types
│
├── src/                         # Frontend React + TypeScript
│   ├── components/
│   │   ├── AppLayout.tsx        # Layout principal
│   │   ├── Titlebar.tsx         # Barre de titre custom
│   │   ├── Sidebar.tsx          # Sidebar navigation
│   │   ├── ProjectList.tsx      # Liste projets + git info
│   │   ├── ProjectDetail.tsx    # Detail projet
│   │   ├── ProjectEditor.tsx    # Edition projet
│   │   ├── PresetList.tsx       # Liste presets
│   │   ├── PresetDetail.tsx     # Detail preset + preview layout
│   │   ├── PresetEditor.tsx     # Edition preset
│   │   ├── Terminal.tsx         # xterm.js wrapper
│   │   ├── TerminalPane.tsx     # Pane terminal + header status
│   │   ├── SplitLayout.tsx      # Multi-pane split layout
│   │   ├── TabBar.tsx           # Onglets workspaces
│   │   ├── StatusBar.tsx        # Barre de status
│   │   ├── SettingsPanel.tsx    # Panneau preferences
│   │   ├── OnboardingWizard.tsx # Wizard premier lancement
│   │   └── LayoutPreview.tsx    # Preview ASCII des layouts
│   ├── hooks/
│   │   ├── useHotkeys.ts        # Raccourcis clavier
│   │   ├── useRelativeTime.ts   # Temps relatif (uptime)
│   │   └── useTauriEvent.ts     # Events Tauri
│   ├── stores/                  # Zustand stores
│   │   ├── config.ts            # Configuration IPC
│   │   ├── terminals.ts         # Sessions terminaux
│   │   ├── projects.ts          # Projets + git info
│   │   ├── launch.ts            # Flow de lancement
│   │   ├── history.ts           # Historique lancements
│   │   ├── theme.ts             # Theme actif
│   │   └── ui.ts                # Etat UI (sidebar, modales)
│   └── types/
│       └── ipc.ts               # Types IPC Tauri
│
├── config.json                  # Configuration utilisateur
├── config-schema.json           # Schema JSON (validation + intellisense)
├── sessions/                    # Sessions sauvegardees
└── logs/                        # Logs applicatifs
```

## Configuration

Le fichier `config.json` definit vos projets, presets et preferences :

```json
{
  "projects": {
    "mon-projet": {
      "name": "Mon Projet",
      "path": "C:\\chemin\\vers\\projet",
      "color": "#e74c3c",
      "default_command": "claude",
      "initial_command": "/specflow"
    }
  },
  "presets": {
    "focus": {
      "name": "Focus Mode",
      "layout": "vertical-2",
      "panels": [
        { "project": "{{auto}}", "command": "claude" },
        { "project": "{{auto}}", "command": "pwsh" }
      ]
    }
  }
}
```

### Variables template

| Variable | Description | Exemple |
|----------|-------------|---------|
| `{{auto}}` | Projet choisi au lancement | — |
| `{{project}}` | Nom du projet | Mon Projet |
| `{{branch}}` | Branche git courante | feature/login |
| `{{path}}` | Chemin du projet | C:\chemin\vers\projet |
| `{{preset}}` | Nom du preset | Focus Mode |

## Developpement

### Prerequis

- **Windows** : Windows 10/11, WebView2 (inclus Win11)
- **Linux** : libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev, patchelf
- **macOS** : Xcode Command Line Tools
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- [Tauri CLI](https://v2.tauri.app/start/create-project/) (`npm install -g @tauri-apps/cli`)

### Lancer en dev

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

Artefacts generes (selon OS) :
- **Windows** : `src-tauri/target/release/bundle/nsis/Claude Launcher_<version>_x64-setup.exe`
- **Linux** : `.deb`, `.AppImage` dans `src-tauri/target/release/bundle/`
- **macOS** : `.dmg`, `.app` dans `src-tauri/target/release/bundle/`

## Historique

Le projet a ete initie en PowerShell 7 + Terminal.Gui + Windows Terminal (Phases 1-4). Un pivot vers Tauri v2 a ete realise en mars 2026 pour embarquer les terminaux directement dans l'app. Le code legacy PowerShell est conserve dans `lib/` et `launcher.ps1` pour reference.

## Licence

MIT
