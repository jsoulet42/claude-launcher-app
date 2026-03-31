# Claude Launcher

Une app desktop Windows pour creer et gerer des workspaces de developpement multi-terminaux avec terminaux embarques, principalement pour Claude Code.

Inspire de **cmux** (macOS), **Hyper** et **VS Code** — terminaux integres dans l'app, pas dans une fenetre separee.

## Fonctionnalites

- **Terminaux embarques** — vrais terminaux ConPTY + xterm.js dans l'app, pas de fenetre externe
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

## Stack

- **Tauri v2** — framework app desktop (WebView2 natif Windows 11)
- **Rust** — backend (config, git, scanner, sessions, ConPTY, historique)
- **React 18 + TypeScript** — frontend
- **xterm.js 6** — terminal embarque dans le webview
- **Vite 6** — bundler frontend
- **Zustand** — state management
- **ConPTY** (Windows API) — pseudo-terminals natifs
- **git2** — integration git en Rust

## Architecture

```
claude-launcher/
├── src-tauri/                   # Backend Rust (Tauri v2)
│   └── src/
│       ├── main.rs              # Entry point Tauri
│       ├── lib.rs               # Module exports + Tauri commands
│       ├── config.rs            # Config loader + validation (serde)
│       ├── conpty.rs            # ConPTY manager (create/destroy/resize)
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
│   │   ├── terminals.ts         # Sessions ConPTY
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

- Windows 11
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

## Historique

Le projet a ete initie en PowerShell 7 + Terminal.Gui + Windows Terminal (Phases 1-4). Un pivot vers Tauri v2 a ete realise en mars 2026 pour embarquer les terminaux directement dans l'app. Le code legacy PowerShell est conserve dans `lib/` et `launcher.ps1` pour reference.

## Licence

MIT
