# Changelog workflow /specflow

## v1.3 — 2026-03-19
### Tests optionnels — workflow adaptatif
- [setup.md] Detection infra tests + menu 3 choix (actif, initialiser, desactiver)
- [setup.md] Initialisation complete infra tests (framework, runner, test hello world)
- [specflow.md] Mode complet (9 etapes) ou sans tests (7 etapes) selon project-config
- [specflow.md] Rappel a chaque lancement si tests desactives (proposition d'activer)
- [audit.md] Critere B1 adapte : revue manuelle si pas de tests
- [project-config.template.md] Champ `Tests > Statut` avec 3 valeurs

## v1.2 — 2026-03-19
### Corrections audit scenarios
- [setup.md] Scaffolds detailles par stack (8 stacks avec dossiers, runner, gestionnaire paquets)
  - **Cause** : V2 — projet vierge sans structure = agent improvise
- [setup.md] Detection mono-repo avec question dediee
  - **Cause** : E6 — mono-repo non detecte, project-config ambigu
- [agent-testeur.md] Fallback projet vierge (aucun test existant)
  - **Cause** : V3 — agent-testeur perdu sans code de reference
- [README.md] Quick Start narratif avec simulation complete premier lancement
  - **Cause** : V7 — debutant perdu entre /setup, /specflow, /audit

## v1.1 — 2026-03-19
### Portabilite + bootstrap automatique
- Tous les skills refactorises pour etre 100% generiques (zero ref projet-specifique)
- `project-config.md` : seul fichier a adapter par projet
- `project-config.template.md` : template vierge pour nouveaux projets
- `setup.md` : agent de bootstrap — analyse automatique du projet (package.json, composer.json, go.mod, etc.)
- `/specflow` lance `/setup` automatiquement si project-config.md n'existe pas
- `agent-testeur.md` : catalogue de tests optionnel (projets sans catalogue formel)
- `README.md` : documentation complete avec 4 exemples multi-stack

## v1.0 — 2026-03-19
### Creation initiale
- `specflow.md` — orchestrateur workflow 9 etapes avec pipeline d'artefacts
- `audit.md` — auditeur strict avec criteres de chaine (C1-C8) + criteres specifiques par etape
- `agent-testeur.md` — TDD generique, phase RED, rapport structure
- `agent-builder.md` — implementation generique, phase GREEN, rapport structure
- `retro.md` — agent d'amelioration continue, frictions + metriques + patterns
- Architecture pipeline : `.claude/pipeline/{feature}/` avec state.md, specs, rapports
- Architecture retrospective : `.claude/pipeline/retrospective/` avec metrics, patterns, changelog
