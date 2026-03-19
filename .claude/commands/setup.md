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

Cette config te convient ?
1. Oui, generer project-config.md [RECOMMENDED]
2. Je veux modifier certains champs
3. Tout refaire manuellement
4. Autre : precisez
```

Si l'utilisateur choisit 2, proposer chaque section en menu dynamique pour ajuster.

### Phase 3 — Champs non detectables

Certaines infos ne sont PAS detectables automatiquement. Les demander via menu :

#### Regle absolue
```
Quelle est LA regle #1 de ton projet ? (celle qu'on ne doit jamais enfreindre)

1. Ne pas modifier le core du framework ({framework detecte}) [RECOMMENDED pour les projets bases sur un framework]
2. Ne pas commit sur main sans PR
3. Ne pas deployer sans tests verts
4. Autre : precisez
```

#### Modules / composants
```
Quels sont les composants/modules principaux de ton projet ?
(Ce sont les "zones de travail" que /specflow proposera dans son menu)

Detectes automatiquement :
{liste des dossiers dans src/ ou equivalent}

1. Utiliser cette liste [RECOMMENDED]
2. Ajouter/supprimer des composants
3. Definir manuellement
4. Autre : precisez
```

#### Architecture mono-repo (si plusieurs dossiers racine detectes)

Si le scan detecte des indices de mono-repo (ex: `frontend/` + `backend/`, ou `packages/`,
ou plusieurs `package.json` / `go.mod`), poser la question :

```
Je detecte plusieurs sous-projets : {liste}

Ton projet est un mono-repo ?

1. Oui — les composants partagent le meme repo mais sont independants [RECOMMENDED si plusieurs package.json]
2. Non — c'est un seul projet avec des dossiers de responsabilite
3. Autre : precisez
```

Si mono-repo : creer une section "Sous-projets" dans project-config.md listant chaque sous-projet
avec sa stack, son runner tests, et son chemin. Les agents devront savoir dans quel sous-projet ils travaillent.

#### Infrastructure
```
Comment deploies-tu ?

1. SSH vers un serveur (je te demanderai les acces)
2. Docker / Kubernetes
3. Vercel / Netlify / autre PaaS
4. CI/CD automatique (GitHub Actions, GitLab CI)
5. Pas encore de deploiement (projet en dev)
6. Autre : precisez
```

#### Strategie de tests

D'abord evaluer la situation tests du projet.

**Si le scan Phase 1 a detecte un framework de tests** (jest.config, phpunit.xml, pytest.ini, etc.)
OU un repertoire de tests (__tests__/, tests/, spec/) :

```
J'ai detecte une infra de tests existante :
- Framework : {framework detecte}
- Repertoire : {repertoire detecte}
- Nb fichiers de test : {count}

Comment isoles-tu tes tests des dependances externes ?

1. Zero DB — logique pure, stubs/mocks manuels [RECOMMENDED pour les projets avec beaucoup de logique metier]
2. Base en memoire (SQLite, H2) + mocks API
3. Containers de test (testcontainers, docker-compose test)
4. Autre : precisez
```

→ Ecrire dans project-config.md : `Statut : actif`

**Si le scan n'a detecte AUCUNE infra de tests** :

```
Je n'ai detecte aucune infra de tests dans ton projet.

Les tests unitaires permettent de securiser le code et sont utilises
par le workflow /specflow (etapes TDD). Comment veux-tu proceder ?

1. Initialiser une infra de tests maintenant [RECOMMENDED — je cree le repertoire, le runner, et un premier test]
2. Pas de tests pour l'instant — utiliser /specflow sans les etapes TDD
3. J'ai des tests ailleurs, je configure manuellement
4. Autre : precisez
```

**Si choix 1** (initialiser) :
- Demander le framework souhaite (adapte a la stack detectee) :
  ```
  Quel framework de tests ?

  1. {framework recommande pour la stack} [RECOMMENDED]
  2. {alternative}
  3. Autre : precisez
  ```
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

```
━━━ /setup — Nouveau projet ━━━

Je n'ai detecte aucun fichier de projet. On demarre de zero !

Quelle stack veux-tu utiliser ?

1. Node.js / React
2. Node.js / Express (API)
3. Python / Django
4. Python / FastAPI
5. PHP / Laravel
6. PHP / Symfony
7. Go
8. Rust
9. Autre : precisez
```

Puis guider l'initialisation avec le scaffold adapte a la stack choisie.
Lire `.claude/commands/_scaffolds.md` pour la structure, le runner, et les actions d'initialisation.

```
Projet initialise ! Structure creee.

Voici ce qui a ete fait :
- Dossiers : {liste}
- Gestionnaire paquets : {init command}
- Framework tests : {framework} installe
- Premier test : {chemin} (1 test "hello world")
- .gitignore : cree avec .claude/ + {exclusions stack}

Prochaine etape ?

1. Lancer /specflow pour ta premiere feature [RECOMMENDED]
2. Explorer le projet d'abord
3. Configurer autre chose
4. Autre : precisez
```

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
