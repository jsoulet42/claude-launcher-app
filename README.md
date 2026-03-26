# Claude Launcher

Un launcher CLI pour Windows Terminal qui ouvre des workspaces multi-terminaux Claude Code en une commande.

```
./launcher.ps1 daily
```

3 panneaux s'ouvrent, chacun dans le bon projet, avec Claude Code pret.

## Concept

Chaque matin, au lieu d'ouvrir manuellement plusieurs terminaux, naviguer dans les bons dossiers et lancer Claude Code dans chacun — une seule commande fait tout.

Les **presets** definissent des configurations de workspace : quels projets, combien de panneaux, quelle disposition, quelle commande dans chaque panneau.

## Stack

- **PowerShell 7** — moteur principal
- **Windows Terminal** — rendu multi-panneaux
- **Terminal.Gui (.NET)** — TUI interactive (Phase 2+)
- **100% Windows natif** — zero WSL

## Architecture

```
claude-launcher/
├── launcher.ps1              # Point d'entree CLI
├── config.json               # Configuration utilisateur
├── config-schema.json        # Schema JSON (validation + intellisense)
└── lib/
    ├── Config/
    │   ├── ConfigLoader.ps1  # Chargement + validation config
    │   └── ConfigSchema.ps1  # Schema + defaults
    └── Terminal/
        └── WtBuilder.ps1     # Construction commandes wt.exe
```

## Configuration

Le fichier `config.json` declare vos projets, presets et layouts :

```json
{
  "projects": {
    "easysap": {
      "name": "EasySAP",
      "path": "C:\\dolibarr\\www\\easysap\\htdocs",
      "color": "#e74c3c",
      "default_command": "claude"
    }
  },
  "presets": {
    "daily": {
      "name": "Daily Dev",
      "layout": "horizontal-3",
      "panels": [
        { "project": "easysap" },
        { "project": "comptapro" },
        { "project": "event-bot-ai" }
      ]
    }
  }
}
```

## Avancement

### Phase 1 — Fondations (v0.1)
- [x] **config-schema** — Schema JSON + loader + validation
- [x] **wt-engine** — Moteur de construction des commandes wt.exe
- [ ] **launcher-cli** — Point d'entree CLI (en cours)

### Phase 2 — TUI Interactive (v0.2)
- [ ] tui-bootstrap, tui-project-list, tui-preset-selector, tui-launch-flow

### Phase 3+ — Intelligence, Persistance, Dashboard, Config Wizard, Raccourcis

Voir [ROADMAP.md](ROADMAP.md) pour le detail complet.

## Licence

MIT
