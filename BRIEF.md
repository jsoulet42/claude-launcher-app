# Claude Launcher — Brief Projet

## Vision

Un launcher TUI (Terminal User Interface) pour Windows qui pilote Windows Terminal afin de creer et gerer des workspaces de developpement multi-terminaux, principalement pour Claude Code.

Inspire de **cmux** (macOS) mais adapte a l'ecosysteme Windows natif (pas de WSL).

## Probleme a resoudre

- Lancer plusieurs instances Claude Code sur differents projets est fastidieux (ouvrir des onglets manuellement, naviguer dans les dossiers, etc.)
- Le script actuel (`ClaudeCode3x.ps1`) est rigide : 3 terminaux fixes, projets en dur, aucune personnalisation
- Warp (alternative testee) est trop opinionated, son IA interfere avec Claude Code, et des commandes cassent quand Claude est ouvert
- cmux n'existe que sur macOS

## Solution

Un systeme modulaire compose de :

1. **Un fichier de configuration JSON** (`config.json`) — declare les projets, presets, preferences
2. **Un launcher PowerShell interactif** (`launcher.ps1`) — menu TUI riche qui pilote Windows Terminal
3. **Des profils Windows Terminal generes** — couleurs/icones par projet
4. **Des scripts utilitaires** — titres dynamiques (branche git), dashboard status
5. **Des raccourcis clavier globaux** (AutoHotKey, optionnel) — switch rapide entre workspaces

## Stack technique

- **PowerShell 7** (pwsh.exe) — langage principal
- **Windows Terminal** (wt.exe) — emulateur de terminal cible
- **JSON** — format de configuration
- **AutoHotKey v2** (optionnel) — raccourcis globaux

## Features cles

### Must-have (v1)

- [ ] Configuration externalisee (projets + presets dans un JSON)
- [ ] Menu TUI interactif avec navigation clavier
- [ ] Nombre de panneaux dynamique (1 a 6)
- [ ] Layouts flexibles (splits horizontaux/verticaux configures par preset)
- [ ] Commande personnalisable par panneau (`claude`, `claude --fast`, `npm run dev`, shell vide...)
- [ ] Presets nommes avec lancement direct (`launcher.ps1 daily`, `launcher.ps1 debug`)
- [ ] Titres d'onglets dynamiques affichant le nom du projet + branche git
- [ ] Couleurs/themes distincts par projet dans Windows Terminal
- [ ] Lancement en une commande ou via raccourci bureau

### Nice-to-have (v2)

- [ ] Scan automatique de dossiers pour decouvrir les projets
- [ ] Historique des lancements + "relancer le dernier"
- [ ] Panneau "dashboard" optionnel montrant l'etat de chaque terminal
- [ ] Detection de Windows Terminal deja ouvert (ajouter onglets vs nouvelle fenetre)
- [ ] Raccourcis globaux AutoHotKey (`Win+1` = workspace 1, etc.)
- [ ] Prompt initial injectable dans Claude Code au demarrage
- [ ] Mode "watch" — notification quand Claude attend une reponse dans un panneau

### Stretch goals (v3)

- [ ] Migration vers Tauri pour une vraie sidebar a la cmux
- [ ] Notifications desktop quand un agent Claude a besoin d'attention
- [ ] Synchronisation de contexte entre panneaux

## Structure du projet

```
claude-launcher/
├── config.json              <- projets, presets, preferences utilisateur
├── launcher.ps1             <- script principal (TUI + logique WT)
├── lib/
│   ├── menu.ps1             <- composants TUI (menus, selection, couleurs)
│   ├── wt-builder.ps1       <- construction des commandes Windows Terminal
│   ├── git-info.ps1         <- recuperation branche git, status
│   └── config-loader.ps1    <- lecture/validation du config.json
├── profiles/
│   └── (profils WT generes dynamiquement)
├── scripts/
│   ├── panel-title.ps1      <- mise a jour dynamique des titres
│   └── status.ps1           <- mini dashboard
├── hotkeys.ahk              <- raccourcis globaux (optionnel, AHK v2)
├── config.json              <- configuration utilisateur
├── BRIEF.md                 <- ce fichier
└── README.md                <- documentation utilisateur
```

## Contraintes

- **Windows natif uniquement** — pas de WSL, pas de dépendance Linux
- Claude Code doit pouvoir naviguer dans les chemins Windows (`C:\...`) normalement
- Compatible PowerShell 7+ et Windows Terminal 1.18+
- Le launcher ne doit pas rester en arriere-plan ou consommer des ressources apres le lancement
- Doit fonctionner sans droits administrateur

## Utilisateur cible

Developpeur solo travaillant sur plusieurs projets simultanement avec Claude Code comme assistant IA principal. Projets actuels :
- **EasySAP** — module Dolibarr (PHP, `C:\dolibarr\www\easysap\htdocs`)
- **ComptaPro** — module Dolibarr (PHP, `C:\dolibarr\www\easycomptapro\htdocs`)
- **Event Bot AI** — bot Discord (Node.js, `C:\Users\jsoulet\Desktop\les-projets-persso\event-bot-ai`)

## Inspirations

- **cmux** (macOS) — sidebar workspaces, notifications, contexte git
- **tmux** — sessions nommees, splits, persistence
- **lazygit** — TUI riche en terminal, navigation clavier fluide
