# Claude Launcher — Roadmap Maitre

> Generee le 2026-03-26 — Issue du brainstorm /specflow
> TUI = produit final | Terminal.Gui (.NET) | PowerShell 7 | Process daemon

---

## Vision revisee (post-brainstorm)

Un launcher TUI riche (style lazygit) pour Windows Terminal qui :
- Cree et gere des workspaces multi-terminaux pour Claude Code
- Detecte le contexte (projets, git, historique) pour proposer des presets intelligents
- Persiste les sessions et peut restaurer un workspace complet
- Se configure entierement depuis le TUI (wizard integre)
- Injecte des commandes initiales dans chaque panneau au lancement

---

## Phases et Pipelines

### Phase 1 — Fondations (v0.1)

> Objectif : un launcher fonctionnel qui ouvre des panneaux Windows Terminal.
> Aucune TUI riche ici — juste le moteur qui pilote WT.

| # | Pipeline | Module | Description | Dependances |
|---|----------|--------|-------------|-------------|
| 1 | `config-schema` | lib/ | Schema JSON du config.json + loader + validation. Projets, presets, preferences, layouts. | aucune |
| 2 | `wt-engine` | lib/ | Moteur de construction des commandes `wt.exe` : splits, profils, titres, commandes par panneau. | config-schema |
| 3 | `launcher-cli` | racine | Point d'entree CLI : `launcher.ps1 [preset]` — parse les args, charge le config, appelle wt-engine. | config-schema, wt-engine |

**Livrable** : `launcher.ps1 daily` ouvre un workspace multi-panneaux configure.

---

### Phase 2 — TUI Interactive (v0.2)

> Objectif : remplacer le CLI brut par un TUI riche avec Terminal.Gui.
> L'utilisateur voit ses projets, presets, et lance en naviguant.

| # | Pipeline | Module | Description | Dependances |
|---|----------|--------|-------------|-------------|
| 4 | `tui-bootstrap` | lib/ | Setup Terminal.Gui en PowerShell : fenetre principale, layout, boucle d'events, theming. | aucune |
| 5 | `tui-project-list` | lib/ | Widget liste des projets avec infos git (branche, status), couleurs par projet. | tui-bootstrap, config-schema |
| 6 | `tui-preset-selector` | lib/ | Widget selection de preset : preview du layout, nombre de panneaux, commandes prevues. | tui-bootstrap, config-schema |
| 7 | `tui-launch-flow` | racine | Flow complet : selectionner projet(s) → choisir/creer preset → preview → lancer. | tui-project-list, tui-preset-selector, wt-engine |

**Livrable** : un TUI interactif avec navigation clavier pour configurer et lancer un workspace.

---

### Phase 3 — Intelligence (v0.3)

> Objectif : le launcher comprend le contexte et propose le meilleur setup.
> Les presets deviennent dynamiques.

| # | Pipeline | Module | Description | Dependances |
|---|----------|--------|-------------|-------------|
| 8 | `project-scanner` | lib/ | Scan automatique de dossiers pour decouvrir les projets (git repos, package.json, etc.). | config-schema |
| 9 | `smart-presets` | lib/ | Moteur de suggestion : analyse historique lancements + heure + branches actives → propose le preset optimal. | config-schema, project-scanner |
| 10 | `initial-commands` | lib/ | Systeme d'injection de commandes initiales par panneau. Support des variables ({{project}}, {{branch}}). | config-schema, wt-engine |
| 11 | `git-integration` | lib/ | Recuperation branche, status, derniers commits. Titres dynamiques. Detection mono-repo. | aucune |

**Livrable** : le launcher propose "Tu bosses sur EasySAP branche fix/invoice ? Voici ton workspace habituel."

---

### Phase 4 — Persistance (v0.4)

> Objectif : sessions sauvegardees et restaurables.
> Le launcher ne perd jamais l'etat.

| # | Pipeline | Module | Description | Dependances |
|---|----------|--------|-------------|-------------|
| 12 | `session-manager` | lib/ | Sauvegarde/restauration de sessions : workspace actif → fichier JSON. `launcher.ps1 restore` recrée tout. | config-schema, wt-engine |
| 13 | `history-tracker` | lib/ | Historique des lancements avec timestamps, projets, presets utilises. "Relancer le dernier". | config-schema, session-manager |
| 14 | `daemon-core` | lib/ | Process leger en fond : surveille les panneaux WT, detecte les fermetures, maintient l'etat session. | session-manager |

**Livrable** : fermer WT par accident → `launcher.ps1 restore` → tout revient.

---

### Phase 5 — Dashboard & Monitoring (v0.5)

> Objectif : voir l'etat de tous les panneaux en temps reel.
> Savoir quand Claude attend une reponse.

| # | Pipeline | Module | Description | Dependances |
|---|----------|--------|-------------|-------------|
| 15 | `dashboard-view` | lib/ | Vue TUI du status de chaque panneau : projet, branche, commande en cours, duree. | tui-bootstrap, daemon-core |
| 16 | `watch-mode` | lib/ | Detection quand Claude Code attend une reponse (analyse du titre WT ou du process). Notification visuelle dans le TUI. | daemon-core |
| 17 | `wt-detection` | lib/ | Detection de Windows Terminal deja ouvert. Choix : ajouter un onglet vs nouvelle fenetre. | wt-engine |

**Livrable** : un dashboard live qui montre "Panel 2 : Claude attend ta reponse depuis 3min".

---

### Phase 6 — Config Wizard & Customisation (v0.6)

> Objectif : tout configurer sans jamais toucher le JSON a la main.
> Onboarding zero-friction.

| # | Pipeline | Module | Description | Dependances |
|---|----------|--------|-------------|-------------|
| 18 | `config-wizard` | lib/ | TUI interactif pour ajouter un projet, creer un preset, changer les couleurs, configurer les layouts. | tui-bootstrap, config-schema |
| 19 | `wt-profile-gen` | profiles/ | Generation automatique de profils Windows Terminal : couleurs, icones, polices par projet. | config-schema |
| 20 | `theme-engine` | lib/ | Systeme de themes pour le TUI lui-meme : dark, light, custom. Couleurs coherentes WT ↔ TUI. | tui-bootstrap, config-schema |

**Livrable** : `launcher.ps1 config` → wizard interactif pour tout configurer.

---

### Phase 7 — Raccourcis & Polish (v0.7 → v1.0)

> Objectif : les finitions qui font la difference au quotidien.

| # | Pipeline | Module | Description | Dependances |
|---|----------|--------|-------------|-------------|
| 21 | `hotkeys-ahk` | racine | Script AutoHotKey v2 : Win+1/2/3 = switch workspace, Win+L = ouvrir launcher. Genere depuis le config. | config-schema, session-manager |
| 22 | `onboarding` | racine | Premier lancement : detecte les projets, propose un preset, genere le config. Zero config manuelle. | project-scanner, config-wizard |
| 23 | `cli-shortcuts` | racine | Raccourcis desktop/Start Menu. `launcher.ps1 install` cree les raccourcis. | launcher-cli |
| 24 | `error-resilience` | lib/ | Gestion erreurs robuste : WT pas installe, PowerShell 5 au lieu de 7, chemin invalide. Messages clairs. | tous |

**Livrable** : v1.0 — produit fini, installe en 1 commande, onboarding automatique, zero friction.

---

## Ordre de dev recommande

```
Phase 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  P1: config-schema ──→ P2: wt-engine ──→ P3: launcher-cli
                                                    │
Phase 2 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│━━━━━━━━━━━━
  P4: tui-bootstrap ──→ P5: tui-project-list ───┐   │
                    └──→ P6: tui-preset-selector─┤   │
                                                 └→ P7: tui-launch-flow
                                                         │
Phase 3 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│━━━━━━━
  P8: project-scanner ──→ P9: smart-presets              │
  P10: initial-commands ─────────────────────────────────→│
  P11: git-integration ─────────────────────────────────→│
                                                         │
Phase 4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│━━━━━━━
  P12: session-manager ──→ P13: history-tracker          │
                      └──→ P14: daemon-core ─────────────│
                                                         │
Phase 5 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│━━━━━━━
  P15: dashboard-view                                    │
  P16: watch-mode                                        │
  P17: wt-detection                                      │
                                                         │
Phase 6 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│━━━━━━━
  P18: config-wizard                                     │
  P19: wt-profile-gen                                    │
  P20: theme-engine                                      │
                                                         │
Phase 7 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│━━━━━━━
  P21: hotkeys-ahk                                       │
  P22: onboarding                                        │
  P23: cli-shortcuts                                     │
  P24: error-resilience ─────────────────────────→ v1.0 ━┛
```

---

## Decisions architecturales (brainstorm 2026-03-26)

| Decision | Choix | Raison |
|----------|-------|--------|
| Architecture runtime | Process daemon leger en fond | Requis pour dashboard, watch, session persistence |
| Moteur TUI | Terminal.Gui (.NET) | Rendu riche comme lazygit, widgets natifs, scrolling, resize |
| Presets | Intelligents (contexte git, historique, heure) | UX proactive — le launcher propose au lieu de demander |
| Vision long terme | TUI = produit final | Pas de migration Tauri prevue, on investit a fond dans le TUI |
| Configuration | Wizard TUI integre | Zero friction, decouverte des options, pas besoin d'editer du JSON |
| Commandes initiales | V1 basique (initial_command par panneau) | Peu de code, tres utile — chaque panneau peut lancer un /specflow ou npm run dev |
| Sessions | Persistantes avec restore | Game changer — jamais perdre son workspace |

---

## Schema config.json (vision)

```jsonc
{
  "$schema": "./config-schema.json",
  "version": "1.0",

  "preferences": {
    "theme": "dark",
    "default_preset": "daily",
    "auto_discover_projects": true,
    "scan_directories": ["C:\\Users\\jsoulet\\Desktop\\les-projets-persso"],
    "daemon": {
      "enabled": true,
      "watch_interval_ms": 5000
    }
  },

  "projects": {
    "easysap": {
      "name": "EasySAP",
      "path": "C:\\dolibarr\\www\\easysap\\htdocs",
      "color": "#e74c3c",
      "icon": "🔴",
      "default_command": "claude",
      "initial_command": "/specflow"
    },
    "comptapro": {
      "name": "ComptaPro",
      "path": "C:\\dolibarr\\www\\easycomptapro\\htdocs",
      "color": "#3498db",
      "icon": "🔵",
      "default_command": "claude"
    },
    "event-bot-ai": {
      "name": "Event Bot AI",
      "path": "C:\\Users\\jsoulet\\Desktop\\les-projets-persso\\event-bot-ai",
      "color": "#2ecc71",
      "icon": "🟢",
      "default_command": "claude --fast"
    }
  },

  "presets": {
    "daily": {
      "name": "Daily Dev",
      "description": "3 projets cote a cote",
      "layout": "horizontal-3",
      "panels": [
        { "project": "easysap" },
        { "project": "comptapro" },
        { "project": "event-bot-ai" }
      ]
    },
    "focus": {
      "name": "Focus Mode",
      "description": "Un seul projet, 2 panneaux (claude + shell)",
      "layout": "vertical-2",
      "panels": [
        { "project": "{{auto}}", "command": "claude" },
        { "project": "{{auto}}", "command": "pwsh" }
      ]
    },
    "debug": {
      "name": "Debug",
      "description": "Claude + logs + shell",
      "layout": "grid-2x2",
      "panels": [
        { "project": "{{auto}}", "command": "claude" },
        { "project": "{{auto}}", "command": "npm run dev" },
        { "project": "{{auto}}", "command": "pwsh" },
        { "project": "{{auto}}", "command": "Get-Content -Wait logs/app.log" }
      ]
    }
  },

  "layouts": {
    "horizontal-2": { "splits": ["H"] },
    "horizontal-3": { "splits": ["H", "H"] },
    "vertical-2": { "splits": ["V"] },
    "grid-2x2": { "splits": ["H", "V", "focus-1", "V"] },
    "main-plus-sidebar": { "splits": ["H(70%)", "V"] }
  }
}
```

---

## Structure du projet (revisee)

```
claude-launcher/
├── launcher.ps1                 <- point d'entree principal
├── config.json                  <- configuration utilisateur
├── config-schema.json           <- schema JSON pour validation + intellisense
├── lib/
│   ├── Config/
│   │   ├── ConfigLoader.ps1     <- lecture/validation config.json
│   │   ├── ConfigSchema.ps1     <- schema + defaults
│   │   └── ConfigWizard.ps1     <- wizard TUI pour editer le config
│   ├── Terminal/
│   │   ├── WtBuilder.ps1        <- construction commandes wt.exe
│   │   ├── WtDetection.ps1      <- detection WT ouvert
│   │   └── WtProfiles.ps1       <- generation profils WT
│   ├── TUI/
│   │   ├── App.ps1              <- fenetre principale Terminal.Gui
│   │   ├── ProjectList.ps1      <- widget liste projets
│   │   ├── PresetSelector.ps1   <- widget selection preset
│   │   ├── Dashboard.ps1        <- vue status panneaux
│   │   └── Theme.ps1            <- theming TUI
│   ├── Core/
│   │   ├── SessionManager.ps1   <- sauvegarde/restore sessions
│   │   ├── Daemon.ps1           <- process de surveillance
│   │   ├── HistoryTracker.ps1   <- historique lancements
│   │   └── SmartPresets.ps1     <- suggestions contextuelles
│   ├── Git/
│   │   └── GitInfo.ps1          <- branche, status, detection repos
│   └── Scanner/
│       └── ProjectScanner.ps1   <- decouverte automatique projets
├── sessions/                    <- sessions sauvegardees
├── profiles/                    <- profils WT generes
├── hotkeys.ahk                  <- raccourcis globaux (optionnel)
├── BRIEF.md
├── ROADMAP.md                   <- ce fichier
└── README.md
```
