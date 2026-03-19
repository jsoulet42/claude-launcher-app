# Scaffolds par stack — reference pour /setup

Ce fichier est lu par `/setup` Phase 5 quand un projet vierge est detecte.
Il definit la structure de dossiers, le runner tests, et le gestionnaire de paquets par stack.

## Scaffolds

| Stack | Structure creee | Runner tests | Gestionnaire paquets |
|-------|----------------|-------------|---------------------|
| Node.js / React | `src/components/`, `src/pages/`, `src/hooks/`, `src/utils/`, `__tests__/`, `public/` | `npm test` (Jest/Vitest) | `npm init -y` |
| Node.js / Express | `src/routes/`, `src/controllers/`, `src/services/`, `src/middleware/`, `__tests__/`, `migrations/` | `npm test` (Jest) | `npm init -y` |
| Python / Django | `apps/`, `templates/`, `static/`, `tests/`, `migrations/` | `pytest` | `pip install` / `poetry init` |
| Python / FastAPI | `app/routers/`, `app/models/`, `app/services/`, `app/schemas/`, `tests/`, `alembic/` | `pytest` | `pip install` / `poetry init` |
| PHP / Laravel | `app/Http/Controllers/`, `app/Models/`, `app/Services/`, `tests/Feature/`, `tests/Unit/`, `database/migrations/` | `php artisan test` (PHPUnit) | `composer init` |
| PHP / Symfony | `src/Controller/`, `src/Entity/`, `src/Service/`, `tests/`, `migrations/` | `php bin/phpunit` | `composer init` |
| Go | `cmd/`, `internal/`, `pkg/`, `internal/handler/`, `internal/service/`, `internal/model/` | `go test ./...` | `go mod init` |
| Rust | `src/`, `src/handlers/`, `src/models/`, `src/services/`, `tests/` | `cargo test` | `cargo init` |

## Actions d'initialisation

1. Creer les dossiers du scaffold
2. Initialiser le gestionnaire de paquets
3. Installer le framework de tests (`npm install --save-dev jest`, `pip install pytest`, etc.)
4. Creer un premier fichier de test "hello world" qui passe
5. Creer un `.gitignore` adapte a la stack
6. Generer `project-config.md`
7. Proposer de lancer `/specflow`
