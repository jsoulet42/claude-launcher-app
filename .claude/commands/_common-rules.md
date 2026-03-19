# Regles communes — tous les skills du workflow /specflow

Ce fichier contient les regles partagees par tous les skills du workflow.
Chaque skill doit appliquer ces regles. Modifier ici = modifier pour tous.

## Configuration projet

Au demarrage, lire `.claude/project-config.md` pour connaitre les regles et contraintes du projet.
Si le fichier n'existe pas, le signaler a l'utilisateur ou lancer `/setup`.

## Pattern interaction — REGLE #1 DU WORKFLOW

**CHAQUE question, CHAQUE decision, CHAQUE transition entre etapes DOIT utiliser un menu dynamique.**
Il n'existe AUCUNE exception. C'est la clef de l'experience utilisateur.

### Format obligatoire

```
{Question claire et courte}

1. {Option A} [RECOMMENDED — {justification en 1 ligne}]
2. {Option B}
3. {Option C}
4. Autre : precisez
```

### Regles du menu

1. **Numerote** : chaque option a un numero (1, 2, 3...)
2. **[RECOMMENDED]** : TOUJOURS present sur exactement 1 option, avec une justification serieuse et argumentee. Le tag doit etre sur la MEME ligne que l'option.
3. **Option libre** : la DERNIERE option est TOUJOURS "Autre : precisez"
4. **Challenger** : ne pas juste valider ce que l'utilisateur dit — pousser a la reflexion, proposer des alternatives qu'il n'a peut-etre pas envisagees
5. **Jamais de question ouverte** : si tu as envie d'ecrire "Que veux-tu faire ?", transforme-le en menu avec des choix concrets

### Criteres du tag [RECOMMENDED]

Le choix [RECOMMENDED] doit etre :
- Le plus adapte au **contexte actuel** du projet (pas generique)
- Justifie par une raison **concrete** (pas "c'est mieux")
- Coherent avec `project-config.md` et les decisions precedentes du pipeline
- Change selon le contexte : le meme menu peut avoir un [RECOMMENDED] different selon la feature

### Exemples

**BON** :
```
Comment on recette cette feature ?

1. Dry-run du script de rattrapage sur prod [RECOMMENDED — un script de rattrapage existe, il faut le valider avant application]
2. Deploiement sur serveur test d'abord
3. Deploiement direct sur prod
4. Test manuel dans l'interface
5. Autre : precisez
```

**MAUVAIS** (question ouverte) :
```
Comment tu veux proceder pour la recette ?
```

**MAUVAIS** (pas de [RECOMMENDED]) :
```
1. Dry-run sur prod
2. Deploiement sur test
3. Direct sur prod
```

**MAUVAIS** ([RECOMMENDED] sans justification) :
```
1. Dry-run sur prod [RECOMMENDED]
2. Deploiement sur test
```

**MAUVAIS** (pas d'option libre) :
```
1. Dry-run sur prod [RECOMMENDED — script existe]
2. Deploiement sur test
```

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
