# Regles communes — tous les skills du workflow /specflow

Ce fichier contient les regles partagees par tous les skills du workflow.
Chaque skill doit appliquer ces regles. Modifier ici = modifier pour tous.

## Configuration projet

Au demarrage, lire `.claude/project-config.md` pour connaitre les regles et contraintes du projet.
Si le fichier n'existe pas, le signaler a l'utilisateur ou lancer `/setup`.

## Pattern interaction

A chaque question ou decision :
- **Menu dynamique numerote** (1, 2, 3...)
- Toujours une option **reponse libre** ("N. Autre : precisez")
- Tag **[RECOMMENDED]** sur le choix le plus adapte, avec argumentation serieuse
- **Challenger l'utilisateur** : pousser a la reflexion, ne pas juste valider
- Ne jamais poser de questions ouvertes sans proposer de choix

## Frictions

Si tu rencontres un probleme lie au workflow (info manquante, format ambigu, override utilisateur,
contournement necessaire), tu DOIS l'ecrire dans `.claude/pipeline/{feature}/frictions.md`.

Format :
```markdown
## [{agent}] {date} — Etape {N}
- **Type** : friction | override | suggestion | metrique
- **Gravite** : bloquant | ralentissant | mineur
- **Description** : ...
- **Impact** : ...
- **Cible** : [quel skill/prompt/grille]
- **Proposition** : ...
```

## Regles absolues

- **Respecter la regle absolue** de `project-config.md`
- **Respecter le perimetre** : seul le code modifiable (selon project-config) peut etre touche
- Les fichiers IA (.claude/) ne doivent **JAMAIS** etre dans un commit
- Ne **JAMAIS** modifier sans validation explicite de l'utilisateur pour les actions irreversibles
