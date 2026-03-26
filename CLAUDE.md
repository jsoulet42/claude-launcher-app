# /specflow — Workflow de dev structure pour Claude Code

Un systeme de workflow complet pour Claude Code qui structure le developpement de features avec specs, TDD, audits de qualite, et amelioration continue.

## Concept

```
SPECS → AUDIT → TDD → AUDIT → BUILD → AUDIT → RECETTE → AUDIT → DEPLOY
```

Chaque etape produit un artefact. Chaque audit verifie la coherence de toute la chaine.
Les frictions sont collectees automatiquement pour ameliorer le workflow en continu.

## Installation

1. Copier le dossier `.claude/` a la racine de votre projet
2. Lancer `/setup` ou `/specflow` dans Claude Code — la configuration se fait automatiquement

```bash
cp -r .claude/ /chemin/vers/votre-projet/.claude/
```

C'est tout. Au premier lancement, `/setup` analyse votre projet (package.json, composer.json, go.mod, etc.),
detecte la stack, les tests, la structure, et propose un `project-config.md` pre-rempli.
Vous validez via menu dynamique, et c'est pret.

## Skills disponibles

| Commande | Role |
|----------|------|
| `/setup` | Bootstrap — analyse le projet, genere project-config.md automatiquement |
| `/specflow` | Orchestrateur — guide etape par etape avec menus dynamiques |
| `/audit specs\|tests\|code\|recette` | Auditeur strict — grille de criteres, score /100, verdict GO/NO-GO |
| `/agent-testeur` | TDD phase RED — ecrit les tests avant le code |
| `/agent-builder` | TDD phase GREEN — implemente pour faire passer les tests |
| `/retro analyse\|apply\|status` | Amelioration continue — analyse frictions, detecte patterns, propose corrections |
| `/push` | Git push en fin de session |

## Architecture des fichiers

```
.claude/
├── commands/                          # Skills (portables, generiques)
│   ├── setup.md                       # Bootstrap automatique projet
│   ├── specflow.md                    # Orchestrateur workflow
│   ├── audit.md                       # Auditeur strict
│   ├── agent-testeur.md               # TDD phase RED
│   ├── agent-builder.md               # TDD phase GREEN
│   ├── retro.md                       # Amelioration continue
│   ├── push.md                        # Git push
│   ├── project-config.template.md     # Template de config projet
│   ├── _common-rules.md              # Regles partagees (menus, frictions, config)
│   └── _scaffolds.md                 # Structures de dossiers par stack
│
├── project-config.md                  # Config projet (le SEUL fichier a adapter)
│
├── specs/                             # Specs perennes (reference)
│   └── {feature}.md
│
├── pipeline/                          # Pipeline actif par feature
│   ├── {feature}/
│   │   ├── state.md                   # Etat courant + historique
│   │   ├── spec-patron.md             # Spec metier
│   │   ├── spec-technique.md          # Spec technique
│   │   ├── frictions.md               # Log frictions
│   │   ├── rapport-testeur.md         # Rapport agent testeur
│   │   ├── rapport-builder.md         # Rapport agent builder
│   │   ├── rapport-recette.md         # Rapport recette
│   │   └── rapport-audit-{etape}.md   # Rapports audit (specs/tests/code/recette)
│   └── retrospective/
│       ├── metrics.md                 # Metriques agregees
│       ├── patterns.md                # Patterns detectes
│       └── changelog.md               # Historique ameliorations
│
└── README.md                          # Ce fichier
```

## Quick Start — Votre premiere feature en 5 minutes

Voici exactement ce qui se passe quand vous lancez le workflow pour la premiere fois :

```
Vous : /specflow

Claude : "Pas de configuration projet. Lancement de /setup..."

━━━ /setup — Analyse du projet ━━━

Projet detecte :
- Stack : Node.js 20 / Express 4 / Jest
- Structure : src/, __tests__/, migrations/
- CI : GitHub Actions

Config proposee : [affichage complet]

Cette config te convient ?
1. Oui, generer project-config.md  ← [RECOMMENDED]
2. Je veux modifier certains champs
3. Autre

Vous : 1

✓ project-config.md genere !

━━━ /specflow — Nouveau pipeline ━━━

Module/composant cible ?
1. routes
2. controllers
3. services
4. Autre

Vous : 3

Feature ? > user-notifications

Spec existante ?
1. Non, on la cree ensemble  ← [RECOMMENDED]
2. Autre

Vous : 1

━━━ /specflow — user-notifications (services) ━━━
[██░░░░░░░░░░░░░░░░] Etape 1/9 — SPECS
Gates : (aucune encore)

On commence le brainstorm pour la spec...
```

A partir de la, le workflow vous guide etape par etape :
- **Specs** → vous ecrivez ensemble, puis `/audit specs` verifie
- **TDD** → les tests sont ecrits avant le code, puis `/audit tests` verifie
- **Build** → le code est implemente, puis `/audit code` verifie
- **Recette** → test en conditions reelles, puis `/audit recette` verifie
- **Deploy** → commit, push, PR

Chaque decision = menu numerote. Vous ne pouvez pas vous perdre.

## Comment ca marche (en detail)

### 1. Menus dynamiques partout

C'est la **regle #1** du workflow. Chaque question = menu numerote avec :
- Un tag `[RECOMMENDED]` justifie sur le meilleur choix
- Une option "Autre : precisez" pour garder la liberte
- Des arguments pour challenger vos choix

Vous ne verrez jamais de question ouverte sans propositions.

### 2. Chaque etape produit un artefact

Les specs, tests, code et rapports sont sauvegardes dans le pipeline.
Chaque agent lit les artefacts de ses predecesseurs — rien ne se perd.

### 3. Les audits sont des gates

Un seul FAIL = NO-GO. On ne passe pas a l'etape suivante sans GO.
L'audit verifie la coherence de **toute la chaine**, pas juste le dernier livrable.

### 4. Tests optionnels

Pas de tests sur votre projet ? Pas de probleme. `/setup` le detecte et propose :
- **Initialiser une infra de tests** → il cree le repertoire, le framework, un premier test
- **Continuer sans tests** → les etapes TDD (3-4) sont automatiquement sautees (SKIP)

La numerotation reste stable : BUILD = toujours etape 5, avec ou sans tests.

```
[████░░░░░░░░░░░░░░] Etape 5/9 — BUILD
Gates : SPECS ✓ (87) | TDD ⊘ | TESTS ⊘ | CODE → en cours
```

### 5. Les frictions alimentent l'amelioration

Chaque agent note ce qui ne marche pas bien. `/retro analyse` detecte les patterns
recurrents et propose des corrections au workflow.

### 6. Reprise entre sessions

Le fichier `state.md` persiste l'etat. Si vous fermez Claude Code et revenez demain,
`/specflow` detecte le pipeline actif et propose de reprendre.

## Exemples de project-config.md

### PHP / Dolibarr

```markdown
## Projet
- **Stack** : PHP 8.2 / Dolibarr 22 / MySQL

## Architecture
- **Code modifiable** : htdocs/custom/{module}/
- **Code en lecture seule** : tout le core Dolibarr

## Regle absolue
> Ne JAMAIS modifier le core Dolibarr.

## Tests
- **Statut** : actif
- **Framework** : PHPUnit
- **Runner** : bash test.sh (alias estest)
- **Principe d'isolation** : zero DB, logique pure, stubs
```

### Node.js / React

```markdown
## Projet
- **Stack** : Node.js 20 / React 18 / Express / PostgreSQL

## Architecture
- **Code modifiable** : src/, api/
- **Code en lecture seule** : node_modules/, dist/

## Regle absolue
> Ne JAMAIS modifier les packages dans node_modules.

## Tests
- **Statut** : actif
- **Framework** : Jest + React Testing Library
- **Runner** : npm test
- **Principe d'isolation** : mocks pour les API externes, base SQLite en memoire
```

### Python / Django

```markdown
## Projet
- **Stack** : Python 3.12 / Django 5 / PostgreSQL / Redis

## Architecture
- **Code modifiable** : apps/, templates/, static/
- **Code en lecture seule** : venv/, django core

## Regle absolue
> Ne JAMAIS monkey-patcher le framework Django.

## Tests
- **Statut** : actif
- **Framework** : pytest + pytest-django
- **Runner** : pytest
- **Principe d'isolation** : fixtures, factory_boy, mock des services externes
```

### Go

```markdown
## Projet
- **Stack** : Go 1.22 / Gin / PostgreSQL

## Architecture
- **Code modifiable** : internal/, cmd/
- **Code en lecture seule** : vendor/

## Regle absolue
> Ne JAMAIS modifier le code dans vendor/.

## Tests
- **Statut** : actif
- **Framework** : testing (standard library)
- **Runner** : go test ./...
- **Principe d'isolation** : interfaces + mocks, testcontainers pour integration
```

## Principes de design

- **Portable** : aucune reference a un framework ou langage dans les skills
- **project-config.md** : le seul fichier a adapter par projet
- **Pipeline d'artefacts** : chaque agent ecrit un rapport, le suivant le lit
- **Audit de chaine** : verifie la coherence bout en bout, pas juste un livrable isole
- **Amelioration continue** : les frictions sont collectees et analysees automatiquement
- **Menus dynamiques** : chaque decision = choix numerotes + [RECOMMENDED] + option libre

## Licence

MIT
