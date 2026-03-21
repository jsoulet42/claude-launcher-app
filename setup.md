# /setup — Initialisation automatique du projet

Tu es un agent d'initialisation qui configure le workflow /specflow pour un nouveau projet.
Tu analyses le projet existant ou guides la creation d'un projet vierge.

## Quand est-ce lance ?

- Manuellement par l'utilisateur : `/setup`
- Automatiquement par `/specflow` si `project-config.md` n'existe pas

## Processus

### Phase 1 — Detection automatique

Scanner la racine du projet pour detecter la stack, les outils, et la structure.

**Fichiers a chercher (dans l'ordre) :**

| Fichier | Ce qu'on en deduit |
|---------|-------------------|
| `package.json` | Node.js, version, scripts (test, build, start), dependances (react, express, jest, vitest, mocha, typescript) |
| `composer.json` | PHP, version, autoload, require (phpunit, laravel, symfony), scripts |
| `pyproject.toml` | Python, version, outils (pytest, django, flask, poetry) |
| `requirements.txt` | Python, dependances |
| `go.mod` | Go, version, module name |
| `Cargo.toml` | Rust, version, dependances |
| `Gemfile` | Ruby, dependances (rails, rspec, minitest) |
| `pom.xml` / `build.gradle` | Java/Kotlin, Maven/Gradle, JUnit |
| `Makefile` | Commandes build/test disponibles |
| `Dockerfile` / `docker-compose.yml` | Infra containerisee, services |
| `.github/workflows/*.yml` | CI/CD, actions, triggers |
| `.gitlab-ci.yml` | CI/CD GitLab |
| `CLAUDE.md` | Regles projet existantes, contraintes, architecture |
| `.gitignore` | Ce qui est exclu (node_modules, vendor, venv, etc.) |
| `.env` / `.env.example` | Variables d'environnement, services externes |
| `tsconfig.json` | TypeScript, paths, aliases |
| `jest.config.*` / `vitest.config.*` / `phpunit.xml` / `pytest.ini` | Config tests specifique |

**Structure de dossiers a analyser :**

| Pattern | Ce qu'on en deduit |
|---------|-------------------|
| `src/` | Code source principal |
| `tests/` ou `__tests__/` ou `spec/` | Repertoire de tests |
| `app/` | Application (Laravel, Rails, Next.js) |
| `api/` ou `server/` | Backend/API |
| `components/` ou `pages/` | Frontend |
| `custom/` ou `plugins/` ou `modules/` | Extensions/modules (CMS, framework extensible) |
| `lib/` ou `pkg/` ou `internal/` | Librairies internes |
| `scripts/` | Scripts utilitaires |
| `docs/` | Documentation |
| `migrations/` | Migrations BDD |

**Git a analyser :**

```bash
git remote -v          # → URL du repo, organisation
git branch -a          # → conventions de branches
git log --oneline -20  # → conventions de commit (conventional commits ?)
```

### Phase 2 — Synthese et proposition

Apres la detection, presenter les resultats :

```
━━━ /setup — Analyse du projet ━━━

Projet detecte :
- Stack : Node.js 20 / React 18 / Express 4 / PostgreSQL
- Tests : Jest (jest.config.ts trouve)
- Repo : github.com/user/monprojet (2 branches actives)
- Structure : src/ (frontend), api/ (backend), __tests__/

Config proposee :

## Projet
- **Nom** : monprojet
- **Stack** : Node.js 20 / React 18 / Express 4 / PostgreSQL

## Architecture
- **Code modifiable** : src/, api/
- **Code en lecture seule** : node_modules/, dist/

## Tests
- **Framework** : Jest
- **Runner** : npm test
- **Repertoire** : __tests__/

...

Proposer via **AskUserQuestion** (header: "Config") :
- Option 1 : "Generer project-config.md (Recommended)" — description: "La config detectee est correcte"
- Option 2 : "Modifier certains champs" — description: "Ajuster la config avant generation"
- Option 3 : "Tout refaire manuellement" — description: "Ignorer la detection"

Si l'utilisateur choisit 2, proposer chaque section en menu dynamique pour ajuster.

### Phase 3 — Champs non detectables

Certaines infos ne sont PAS detectables automatiquement. Les demander via menu :

#### Regle absolue
Proposer via **AskUserQuestion** (header: "Regle #1") :
- Option 1 : "Ne pas modifier le core du framework (Recommended)" — description: "Proteger {framework detecte}"
- Option 2 : "Ne pas commit sur main sans PR" — description: "Workflow de review obligatoire"
- Option 3 : "Ne pas deployer sans tests verts" — description: "Securiser les deploiements"

#### Modules / composants
Afficher la liste detectee puis proposer via **AskUserQuestion** (header: "Modules") :
- Option 1 : "Utiliser cette liste (Recommended)" — description: "Les modules detectes correspondent au projet"
- Option 2 : "Ajouter/supprimer" — description: "Ajuster la liste detectee"
- Option 3 : "Definir manuellement" — description: "Ignorer la detection"

#### Architecture mono-repo (si plusieurs dossiers racine detectes)

Si le scan detecte des indices de mono-repo (ex: `frontend/` + `backend/`, ou `packages/`,
ou plusieurs `package.json` / `go.mod`), poser la question :

Afficher la liste des sous-projets detectes puis proposer via **AskUserQuestion** (header: "Mono-repo") :
- Option 1 : "Oui, mono-repo (Recommended)" — description: "Composants independants dans le meme repo"
- Option 2 : "Non, projet unique" — description: "Dossiers de responsabilite, pas de sous-projets"

Si mono-repo : creer une section "Sous-projets" dans project-config.md listant chaque sous-projet
avec sa stack, son runner tests, et son chemin. Les agents devront savoir dans quel sous-projet ils travaillent.

#### Infrastructure
Proposer via **AskUserQuestion** (header: "Deploy") :
- Option 1 : "PaaS (Vercel/Netlify) (Recommended)" — description: "Deploiement automatique via plateforme"
- Option 2 : "Docker / Kubernetes" — description: "Infra containerisee"
- Option 3 : "CI/CD (GitHub Actions)" — description: "Pipeline automatise"
- Option 4 : "Pas encore de deploiement" — description: "Projet en cours de dev"

#### Strategie de tests

D'abord evaluer la situation tests du projet.

**Si le scan Phase 1 a detecte un framework de tests** (jest.config, phpunit.xml, pytest.ini, etc.)
OU un repertoire de tests (__tests__/, tests/, spec/) :

Afficher les infos detectees puis proposer via **AskUserQuestion** (header: "Isolation") :
- Option 1 : "Zero DB / mocks (Recommended)" — description: "Logique pure, stubs/mocks manuels"
- Option 2 : "Base en memoire" — description: "SQLite/H2 + mocks API"
- Option 3 : "Containers de test" — description: "testcontainers / docker-compose test"

→ Ecrire dans project-config.md : `Statut : actif`

**Si le scan n'a detecte AUCUNE infra de tests** :

Afficher le constat (aucune infra detectee) puis proposer via **AskUserQuestion** (header: "Tests") :
- Option 1 : "Initialiser maintenant (Recommended)" — description: "Creer repertoire, runner et premier test"
- Option 2 : "Pas de tests" — description: "Utiliser /specflow sans etapes TDD"
- Option 3 : "Config manuelle" — description: "J'ai des tests ailleurs, je configure"

**Si choix 1** (initialiser) :
- Demander le framework souhaite via **AskUserQuestion** (header: "Framework") :
  - Option 1 : "{framework recommande} (Recommended)" — description: "Le plus adapte a {stack}"
  - Option 2 : "{alternative}" — description: "Alternative populaire"
- Demander le principe d'isolation (menu ci-dessus)
- Creer le repertoire de tests
- Installer le framework (npm install --save-dev jest, pip install pytest, etc.)
- Creer un premier fichier de test "hello world" qui passe
- Configurer le runner (package.json scripts.test, pytest.ini, etc.)
- Ecrire dans project-config.md : `Statut : actif`

**Si choix 2** (pas de tests) :
- Ecrire dans project-config.md : `Statut : desactive`
- /specflow sautera les etapes 3-4 (TDD + audit tests)
- L'audit code verifiera le code sans tests (critere B1 adapte)

**Si choix 3** (config manuelle) :
- Demander framework, runner, repertoire, conventions via menus
- Ecrire dans project-config.md : `Statut : actif`

### Phase 4 — Generation

1. Generer `.claude/project-config.md` a partir des reponses
2. Creer la structure pipeline si elle n'existe pas :
   ```
   mkdir -p .claude/pipeline/retrospective
   ```
3. Initialiser les fichiers retrospective (metrics.md, patterns.md, changelog.md)
4. Verifier que `.claude/` est dans `.gitignore`

### Phase 5 — Projet vierge (si rien n'est detecte)

Si le scan ne detecte aucun fichier de projet :

Afficher "Aucun fichier de projet detecte. On demarre de zero !" puis proposer la stack en 2 questions **AskUserQuestion** :

**Question 1** (header: "Langage") :
- Option 1 : "Node.js (Recommended)" — description: "React, Express, Next.js..."
- Option 2 : "Python" — description: "Django, FastAPI, Flask..."
- Option 3 : "PHP" — description: "Laravel, Symfony..."
- Option 4 : "Go / Rust" — description: "Backend performant"

**Question 2** (header: "Framework") : adapter les options au langage choisi

Puis guider l'initialisation avec le scaffold adapte a la stack choisie.
Lire `.claude/commands/_scaffolds.md` pour la structure, le runner, et les actions d'initialisation.

Afficher le recapitulatif de ce qui a ete fait puis proposer via **AskUserQuestion** (header: "Suite") :
- Option 1 : "Lancer /specflow (Recommended)" — description: "Demarrer ta premiere feature"
- Option 2 : "Explorer le projet" — description: "Verifier la structure avant de commencer"
- Option 3 : "Configurer autre chose" — description: "Ajuster des parametres"

## Integration avec /specflow

Dans specflow.md, au demarrage :
```
Si project-config.md n'existe pas :
  → Afficher : "Pas de configuration projet. Lancement de /setup..."
  → Lancer /setup automatiquement
  → Une fois setup termine, reprendre /specflow
```

## Regles

- Toujours scanner AVANT de demander — ne pas poser de questions dont la reponse est dans les fichiers
- Toujours proposer le resultat de la detection pour validation — ne pas generer silencieusement
- Menu dynamique + [RECOMMENDED] + option libre a chaque question
- Challenger l'utilisateur sur la regle absolue — c'est le fondement du projet
- Si CLAUDE.md existe, l'integrer dans project-config (ne pas le contredire)
- Ne pas creer de fichiers de code (src/, tests/) sans validation explicite
- Verifier que .claude/ est dans .gitignore (ajouter si absent, avec confirmation)
