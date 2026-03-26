# Skills /specflow — Guide rapide

## Flux du workflow

```
/specflow → SPECS → /audit specs → TDD → /audit tests → BUILD → /audit code → RECETTE → /audit recette → DEPLOY
```

## Skills principaux

| Commande | Role | Quand l'utiliser |
|----------|------|-----------------|
| `/specflow` | Orchestrateur pipeline complet | Demarrer ou reprendre une feature |
| `/audit` | Orchestrateur audits intelligent | Automatiquement appele par /specflow aux gates |
| `/setup` | Initialiser le projet | Premier lancement sur un nouveau projet |
| `/retro` | Amelioration continue | Apres un pipeline termine |
| `/push` | Git push | Fin de session |

## Audits disponibles

| Audit | Grille | Description |
|-------|--------|-------------|
| `/audit-conformite` | C1-C8 + S/T/B/R | Structure, coherence, passation |
| `/audit-completude` | CMP1-CMP8 | Lacunes, faisabilite, edge cases |
| `/audit-securite` | SEC1-SEC7 | OWASP, auth, injection, droits |

L'orchestrateur `/audit` detecte automatiquement les traits de la feature et propose les audits pertinents.

## Glossaire

- **Pipeline** : dossier `.claude/pipeline/{feature}/` contenant tous les artefacts
- **Gate** : point de controle entre 2 etapes (audit obligatoire, GO/NO-GO)
- **Trait** : caracteristique de la feature (endpoints, inputs, DB...) qui active des audits
- **Validation croisee** : elimination des faux positifs entre audits
- **Friction** : probleme rencontre pendant le workflow, logue dans `frictions.md`

## Premiers pas

1. `project-config.md` doit exister (sinon `/setup` le cree)
2. Lancer `/specflow` → choisir module + feature
3. Suivre les menus (AskUserQuestion)
4. A chaque gate, `/audit` propose les audits adaptes
5. Corriger si NO-GO, continuer si GO
6. A la fin : commit + PR via `/push`

## Configuration

Tout ce qui est specifique au projet est dans `project-config.md`.
Les skills sont generiques et s'adaptent a n'importe quel projet/tech.
