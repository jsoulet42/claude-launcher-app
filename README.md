# /specflow — Workflow de dev structure pour Claude Code

Un systeme de workflow complet pour Claude Code qui structure le developpement de features avec specs, TDD, audits intelligents, et amelioration continue.

## Concept

```
SPECS → AUDIT → TDD → AUDIT → BUILD → AUDIT → RECETTE → AUDIT → DEPLOY
```

Chaque etape produit un artefact. Chaque audit detecte les traits de la feature et propose les verifications adaptees.
Les frictions sont collectees automatiquement pour ameliorer le workflow en continu.

## Installation

Cloner ce repo puis copier le dossier `.claude/` a la racine de votre projet :

```bash
git clone https://github.com/votre-user/claude-launcher.git
cp -r claude-launcher/.claude/ /chemin/vers/votre-projet/.claude/
```

Ou directement depuis le repo :

```bash
cp -r .claude/ /chemin/vers/votre-projet/.claude/
```

Puis lancer `/setup` ou `/specflow` dans Claude Code — la configuration se fait automatiquement.
`/setup` analyse votre projet (package.json, composer.json, go.mod, etc.),
detecte la stack, les tests, la structure, et propose un `project-config.md` pre-rempli.
Vous validez via menu dynamique, et c'est pret.

## Skills disponibles

| Commande | Role |
|----------|------|
| `/setup` | Bootstrap — analyse le projet, genere project-config.md automatiquement |
| `/specflow` | Orchestrateur — guide etape par etape avec menus dynamiques |
| `/audit` | Orchestrateur audits intelligent — detecte les traits, propose les audits adaptes |
| `/audit-conformite` | Grille structurelle (C1-C8 + S/T/B/R) |
| `/audit-completude` | Lacunes + faisabilite (CMP1-CMP8) |
| `/audit-securite` | Securite OWASP (SEC1-SEC7) |
| `/agent-testeur` | TDD phase RED — ecrit les tests avant le code |
| `/agent-builder` | TDD phase GREEN — implemente pour faire passer les tests |
| `/retro` | Amelioration continue — analyse frictions, detecte patterns, propose corrections |
| `/push` | Git push en fin de session |

## Systeme d'audits intelligent (V2)

### 3 audits specialises

| Audit | Grille | Ce qu'il verifie |
|-------|--------|-----------------|
| **Conformite** | C1-C8 + S/T/B/R | Structure, coherence, passation entre agents |
| **Completude** | CMP1-CMP8 | Lacunes, edge cases, faisabilite TDD/BUILD |
| **Securite** | SEC1-SEC7 | OWASP, auth, injection, droits, rate limiting |

### Detection automatique des traits

L'orchestrateur `/audit` analyse la spec technique et detecte les traits de la feature :

| Trait detecte | Audits actives |
|---------------|---------------|
| Endpoints publics (webhook, API) | Securite obligatoire |
| Inputs utilisateur (formulaires, messages) | Securite obligatoire |
| Acces base de donnees (SQL, ORM) | Completude recommande |
| Gestion droits/permissions | Securite recommande |
| Multi-tenant / multi-entity | Securite + Completude |
| Cron / jobs planifies | Completude recommande |
| Integration externe (API tierce) | Securite + Completude |
| Grande feature (> 5 classes) | Completude obligatoire |
| Petite feature (≤ 3 classes) | Conformite seul suffit |

Les audits sont lances en parallele et une **validation croisee** elimine les faux positifs.

### Dashboard 3 niveaux

```
━━━ AUDIT specs — user-notifications ━━━

Niveau 1 : Verdict
| Audit       | Score   | Verdict |
|-------------|---------|---------|
| Conformite  | 93/100  | GO      |
| Completude  | 87/100  | GO      |
| Securite    | 91/100  | GO      |
| GLOBAL      | 87/100  | GO      |

Traits : endpoints publics, inputs, DB | Audits : 3 | Faux positifs elimines : 2

Niveau 2 : Points a traiter (si NO-GO)
1. [SEC5] Secret webhook non specifie → ajouter constante securisee
2. [CMP3] Format JSON non exemplifie → ajouter exemple

Niveau 3 : Details
→ .claude/pipeline/{feature}/rapport-audit-specs.md
```

## Architecture des fichiers

```
.claude/
├── commands/                          # Skills (portables, generiques)
│   ├── setup.md                       # Bootstrap automatique projet
│   ├── specflow.md                    # Orchestrateur workflow
│   ├── audit.md                       # Orchestrateur audits intelligent
│   ├── audit-conformite.md            # Grille conformite (C1-C8 + S/T/B/R)
│   ├── audit-completude.md            # Grille completude (CMP1-CMP8)
│   ├── audit-securite.md              # Grille securite (SEC1-SEC7)
│   ├── agent-testeur.md               # TDD phase RED
│   ├── agent-builder.md               # TDD phase GREEN
│   ├── retro.md                       # Amelioration continue
│   ├── push.md                        # Git push
│   ├── project-config.template.md     # Template de config projet
│   ├── _common-rules.md              # Regles partagees (menus, frictions, config)
│   ├── _scaffolds.md                 # Structures de dossiers par stack
│   ├── README.md                     # Guide rapide des skills
│   └── CHANGELOG-GRILLES.md          # Historique versions des grilles d'audit
│
├── project-config.md                  # Config projet (le SEUL fichier a adapter)
│
├── specs/                             # Specs perennes (reference figee)
│   └── {feature}.md
│
├── pipeline/                          # Pipeline actif par feature
│   ├── {feature}/
│   │   ├── state.md                   # Etat courant + historique
│   │   ├── spec-patron.md             # Spec metier (version vivante)
│   │   ├── spec-technique.md          # Spec technique (version vivante)
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
☐ Oui, generer project-config.md  ← (Recommended)
☐ Je veux modifier certains champs

Vous : ☑ Oui

✓ project-config.md genere !

━━━ /specflow — Nouveau pipeline ━━━

Module/composant cible ?
☐ routes
☐ controllers
☐ services

Feature ? > user-notifications

━━━ /specflow — user-notifications (services) ━━━
[██░░░░░░░░░░░░░░░░] Etape 1/9 — SPECS
Gates : (aucune encore)

On commence le brainstorm pour la spec...
```

A partir de la, le workflow vous guide etape par etape :
- **Specs** → vous ecrivez ensemble, puis `/audit specs` detecte les traits et lance les audits adaptes
- **TDD** → les tests sont ecrits avant le code, puis `/audit tests` verifie
- **Build** → le code est implemente, puis `/audit code` verifie
- **Recette** → test en conditions reelles, puis `/audit recette` verifie
- **Deploy** → commit, push, PR

Chaque decision = menu interactif (AskUserQuestion). Vous ne pouvez pas vous perdre.

## Comment ca marche (en detail)

### 1. Menus interactifs partout

C'est la **regle #1** du workflow. Chaque question = menu interactif (AskUserQuestion) avec :
- Un tag `(Recommended)` justifie sur le meilleur choix
- Une option "Autre" automatique pour garder la liberte
- Des arguments pour challenger vos choix

Vous ne verrez jamais de question ouverte sans propositions.

### 2. Audits intelligents et adaptes

L'orchestrateur `/audit` :
1. **Detecte les traits** de la feature (endpoints, inputs, DB, droits, taille...)
2. **Propose les audits pertinents** — pas de securite pour un fix CSS
3. **Lance en parallele** — ~3 min au lieu de 8
4. **Validation croisee** — elimine les faux positifs (info documentee ailleurs, detail BUILD)
5. **Dashboard** — verdict en 10 secondes, details si besoin

### 3. Chaque etape produit un artefact

Les specs, tests, code et rapports sont sauvegardes dans le pipeline.
Chaque agent lit les artefacts de ses predecesseurs — rien ne se perd.

### 4. Les audits sont des gates

Un seul FAIL = NO-GO. On ne passe pas a l'etape suivante sans GO.
L'audit verifie la coherence de **toute la chaine**, pas juste le dernier livrable.

### 5. Tests optionnels

Pas de tests sur votre projet ? Pas de probleme. `/setup` le detecte et propose :
- **Initialiser une infra de tests** → il cree le repertoire, le framework, un premier test
- **Continuer sans tests** → les etapes TDD (3-4) sont automatiquement sautees (SKIP)

La numerotation reste stable : BUILD = toujours etape 5, avec ou sans tests.

```
[████░░░░░░░░░░░░░░] Etape 5/9 — BUILD
Gates : SPECS ✓ (87) | TDD ⊘ | TESTS ⊘ | CODE → en cours
```

### 6. Les frictions alimentent l'amelioration

Chaque agent note ce qui ne marche pas bien (immediatement, pas en fin de rapport).
`/retro analyse` detecte les patterns recurrents et propose des corrections au workflow.

### 7. Reprise entre sessions

Le fichier `state.md` persiste l'etat. Si vous fermez Claude Code et revenez demain,
`/specflow` detecte le pipeline actif et propose de reprendre.

### 8. Anti-biais dans les audits

Chaque grille d'audit inclut des regles anti-biais :
- **BLOQUANT** = le prochain agent crashe. Pas "c'est pas ideal".
- Ne pas signaler ce qui est documente dans une autre section
- Ne pas penaliser les details de BUILD (ou stocker un secret, format module tiers)
- Exemples calibres par note (9/10, 7/10, 5/10)

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
- **Audits intelligents** : detection des traits → audits adaptes → validation croisee → dashboard
- **Pipeline d'artefacts** : chaque agent ecrit un rapport, le suivant le lit
- **Audit de chaine** : verifie la coherence bout en bout, pas juste un livrable isole
- **Anti-biais** : regles explicites pour eviter les faux positifs dans les audits
- **Amelioration continue** : les frictions sont collectees et analysees automatiquement
- **Menus interactifs** : chaque decision = AskUserQuestion + (Recommended) + option libre

## Licence

MIT
