# Claude Launcher

Un launcher TUI interactif pour Windows Terminal qui cree et gere des workspaces multi-terminaux Claude Code.

```
./launcher.ps1 tui
```

Un TUI riche s'ouvre : selectionnez un projet, choisissez un preset, et lancez votre workspace en une touche.

```
./launcher.ps1 workspace -Project easysap
```

Ou lancez directement depuis la CLI — 3 panneaux s'ouvrent, chacun dans le bon projet.

## Fonctionnalites

- **TUI interactive** (style lazygit) — navigation clavier, preview ASCII des layouts, selection de presets
- **Presets intelligents** — suggestions basees sur l'historique, l'heure et le contexte git
- **Decouverte automatique** — scan de dossiers pour trouver vos projets (F2 dans le TUI)
- **Commandes initiales** — injection de commandes au lancement avec variables template (`{{project}}`, `{{branch}}`)
- **Layouts flexibles** — horizontal, vertical, grid 2x2, main+sidebar, main+stack
- **Projets dynamiques** — `{{auto}}` dans les presets pour choisir le projet au lancement
- **Dry-run** — `./launcher.ps1 preset -WhatIf` pour voir la commande sans lancer

## Stack

- **PowerShell 7** — moteur principal
- **Terminal.Gui (.NET)** — TUI interactive avec widgets natifs
- **Windows Terminal** — rendu multi-panneaux via `wt.exe`
- **100% Windows natif** — zero WSL, zero dependance externe

## Architecture

```
claude-launcher/
├── launcher.ps1                  # Point d'entree (CLI + TUI)
├── config.json                   # Configuration utilisateur
├── config-schema.json            # Schema JSON (validation + intellisense)
├── logs/                         # Logs de l'application
└── lib/
    ├── Config/
    │   ├── ConfigLoader.ps1      # Chargement + validation config
    │   └── ConfigSchema.ps1      # Schema + defaults
    ├── Terminal/
    │   └── WtBuilder.ps1         # Construction commandes wt.exe
    ├── TUI/
    │   ├── App.ps1               # Fenetre principale Terminal.Gui
    │   ├── ProjectList.ps1       # Widget liste projets (sidebar)
    │   ├── PresetSelector.ps1    # Widget selection preset (sidebar)
    │   ├── LaunchFlow.ps1        # Flow de lancement (modales)
    │   ├── Theme.ps1             # Theming TUI
    │   ├── Logger.ps1            # Systeme de logs
    │   └── DepsManager.ps1       # Gestion deps Terminal.Gui
    ├── Core/
    │   ├── SmartPresets.ps1       # Suggestions contextuelles
    │   └── InitialCommands.ps1   # Resolution variables template
    └── Scanner/
        └── ProjectScanner.ps1    # Decouverte automatique projets
```

## Configuration

Le fichier `config.json` definit vos projets, presets et layouts :

```json
{
  "projects": {
    "easysap": {
      "name": "EasySAP",
      "path": "C:\\dolibarr\\www\\easysap\\htdocs",
      "color": "#e74c3c",
      "default_command": "claude",
      "initial_command": "/specflow"
    }
  },
  "presets": {
    "workspace": {
      "name": "Workspace",
      "layout": "main-plus-stack",
      "panels": [
        { "project": "{{auto}}", "command": "claude", "initial_command": "/specflow" },
        { "project": "{{auto}}", "command": "claude" },
        { "project": "{{auto}}", "command": "pwsh", "initial_command": "echo {{project}} sur {{branch}}" }
      ]
    }
  }
}
```

### Variables template

Les commandes initiales supportent des variables resolues au lancement :

| Variable | Description | Exemple |
|----------|-------------|---------|
| `{{project}}` | Nom du projet | EasySAP |
| `{{branch}}` | Branche git courante | feature/smart-presets |
| `{{path}}` | Chemin du projet | C:\dolibarr\www\easysap |
| `{{preset}}` | Nom du preset | Workspace |

## Utilisation

```powershell
# TUI interactive
./launcher.ps1 tui

# Lancer un preset directement
./launcher.ps1 workspace -Project easysap

# Dry-run (voir la commande sans lancer)
./launcher.ps1 workspace -Project easysap -WhatIf

# Creer un config.json par defaut
./launcher.ps1 -Init
```

### Raccourcis TUI

| Touche | Action |
|--------|--------|
| Tab | Basculer entre Projets et Presets |
| Enter | Lancer le preset selectionne |
| F2 | Scanner et decouvrir des projets |
| ? | Aide |
| Q | Quitter |

## Avancement

### Phase 1 — Fondations (v0.1) ✓
- [x] **P1: config-schema** — Schema JSON + loader + validation
- [x] **P2: wt-engine** — Moteur de construction des commandes wt.exe
- [x] **P3: launcher-cli** — Point d'entree CLI

### Phase 2 — TUI Interactive (v0.2) ✓
- [x] **P4: tui-bootstrap** — Setup Terminal.Gui, fenetre principale, theming
- [x] **P5: tui-project-list** — Widget liste projets avec infos git
- [x] **P6: tui-preset-selector** — Widget selection preset avec preview ASCII
- [x] **P7: tui-launch-flow** — Flow complet : projet -> preset -> preview -> lancer

### Phase 3 — Intelligence (v0.3) - en cours
- [x] **P8: project-scanner** — Decouverte automatique de projets
- [x] **P9: smart-presets** — Suggestions intelligentes basees sur l'historique
- [x] **P10: initial-commands** — Variables template dans les commandes initiales
- [ ] **P11: git-integration** — Branche, status, detection mono-repo


### Phase 4-7 — a venir
Session persistence, dashboard live, config wizard, raccourcis globaux.

## Prerequis

- Windows 10/11
- [PowerShell 7+](https://github.com/PowerShell/PowerShell)
- [Windows Terminal](https://github.com/microsoft/terminal)

## Licence

MIT
