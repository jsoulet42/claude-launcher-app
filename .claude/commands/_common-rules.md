# Regles communes — tous les skills du workflow /specflow

Ce fichier contient les regles partagees par tous les skills du workflow.
Chaque skill doit appliquer ces regles. Modifier ici = modifier pour tous.

## Configuration projet

Au demarrage, lire `.claude/project-config.md` pour connaitre les regles et contraintes du projet.
Si le fichier n'existe pas, le signaler a l'utilisateur ou lancer `/setup`.

## Pattern interaction — REGLE #1 DU WORKFLOW

**CHAQUE question, CHAQUE decision, CHAQUE transition entre etapes DOIT utiliser l'outil `AskUserQuestion`.**
Il n'existe AUCUNE exception. C'est la clef de l'experience utilisateur.

### Pourquoi AskUserQuestion ?

L'outil `AskUserQuestion` genere un **vrai menu interactif** avec selection par fleches directionnelles.
L'utilisateur navigue avec ↑↓ et valide avec Entree. C'est infiniment plus agreable qu'un menu texte brut
ou l'utilisateur doit taper un numero.

**JAMAIS de menu en texte brut.** Toujours `AskUserQuestion`.

### Regles de l'outil

1. **2 a 4 options** : l'outil accepte entre 2 et 4 options. Si tu as plus de 4 choix, regroupe-les ou fais 2 questions
2. **[RECOMMENDED] = premiere option** : l'option recommandee doit etre la PREMIERE de la liste, avec `(Recommended)` a la fin du label
3. **Label court** (1-5 mots) + **description** qui explique et justifie
4. **"Autre" est automatique** : l'outil ajoute toujours une option "Other" — ne PAS l'inclure dans tes options
5. **Header court** (max 12 chars) : un tag qui resume le contexte (ex: "Specs", "Recette", "Tests")
6. **Challenger** : proposer des alternatives que l'utilisateur n'a peut-etre pas envisagees

### Criteres du choix Recommended

Le choix recommande doit etre :
- Le plus adapte au **contexte actuel** du projet (pas generique)
- Justifie dans la **description** par une raison **concrete** (pas "c'est mieux")
- Coherent avec `project-config.md` et les decisions precedentes du pipeline
- Dynamique : le meme menu peut avoir un recommended different selon la feature

### Exemple concret

```json
{
  "questions": [{
    "question": "Comment on recette cette feature ?",
    "header": "Recette",
    "options": [
      {
        "label": "Dry-run sur prod (Recommended)",
        "description": "Un script de rattrapage existe, il faut le valider avant application reelle"
      },
      {
        "label": "Deployer sur test d'abord",
        "description": "Serveur test disponible mais donnees limitees — risque de ne pas tout voir"
      },
      {
        "label": "Direct sur prod",
        "description": "Plus rapide mais pas de filet de securite"
      },
      {
        "label": "Test manuel interface",
        "description": "Verifier visuellement dans le navigateur sans script"
      }
    ],
    "multiSelect": false
  }]
}
```

### Ce qui est INTERDIT

- Afficher un menu en texte brut (1. ... 2. ... 3. ...)
- Poser une question ouverte sans proposer de choix
- Mettre plus de 4 options (regrouper ou faire 2 questions)
- Oublier le tag (Recommended) sur la premiere option
- Mettre une option "Autre" dans la liste (c'est automatique)

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
