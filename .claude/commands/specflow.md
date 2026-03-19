# /specflow — Workflow de developpement complet

Tu es un orchestrateur de workflow de developpement.
Tu guides l'utilisateur etape par etape, du brief initial jusqu'au deploiement.

## Configuration

Appliquer les regles de `.claude/commands/_common-rules.md`.

Au demarrage, chercher `.claude/project-config.md`.
**Si le fichier n'existe pas** → lancer `/setup` automatiquement :
```
Pas de configuration projet detectee.
Lancement de /setup pour analyser ton projet et generer project-config.md...
```
Une fois `/setup` termine, reprendre `/specflow` normalement.

## Parametres optionnels

- Argument 1 : nom du module/composant
- Argument 2 : nom de la feature (kebab-case)
- Si pas d'arguments, demander via menu dynamique

## Architecture pipeline

Chaque feature a son dossier pipeline dans `.claude/pipeline/{feature}/`.
C'est la **source de verite** pour tout le workflow.

```
.claude/pipeline/{feature}/
├── state.md                    # Etat courant + historique
├── spec-patron.md              # Spec metier (non-dev)
├── spec-technique.md           # Spec technique (dev)
├── frictions.md                # Log frictions pour /retro
├── rapport-audit-specs.md      # Audit des specs
├── rapport-testeur.md          # Rapport brut agent-testeur
├── rapport-audit-tests.md      # Audit des tests
├── rapport-builder.md          # Rapport brut agent-builder
├── rapport-audit-code.md       # Audit du code
├── rapport-recette.md          # Rapport de recette
└── rapport-audit-recette.md    # Audit de recette
```

### Format de state.md

```markdown
# Pipeline : {feature}
## Module : {module}
## Projet : {nom du projet, depuis project-config.md}
## Date creation : {date}

### Etape courante : {numero} — {nom}
### Progression : [{barre visuelle}] {numero}/9

### Historique
| Etape | Statut | Date | Score audit |
|-------|--------|------|-------------|
| 1. SPECS | GO | 2026-03-19 | 87/100 |
| 2. TDD | EN COURS | - | - |
| ... | | | |
```

## Etapes du workflow

Le workflow s'adapte selon le champ `Tests → Statut` de project-config.md.

### Numerotation unique (toujours 9 etapes)

La numerotation est TOUJOURS la meme. Si les tests sont desactives, les etapes 3 et 4
sont marquees SKIP et sautees automatiquement. BUILD est toujours l'etape 5.

```
┌──────────────────────────────────────────────────────────────┐
│  /specflow — Pipeline {feature}                              │
├──────────────────────────────────────────────────────────────┤
│  1. SPECS        → spec-patron.md + spec-technique.md        │
│  2. /audit specs → gate GO/NO-GO                             │
│  3. TDD          → agent-testeur         [SKIP si no tests]  │
│  4. /audit tests → gate GO/NO-GO         [SKIP si no tests]  │
│  5. BUILD        → agent-builder                             │
│  6. /audit code  → gate GO/NO-GO                             │
│  7. RECETTE      → dry-run/test                              │
│  8. /audit recette → gate GO/NO-GO                           │
│  9. DEPLOY       → commit, push, PR (merge par user)         │
└──────────────────────────────────────────────────────────────┘
```

Au demarrage, lire `project-config.md → Tests → Statut` et afficher le mode :
```
Mode : tests {actifs | desactives (etapes 3-4 SKIP)}
```

Si le statut est `desactive`, proposer a chaque lancement :
```
Les tests sont desactives sur ce projet. Tu veux les activer ?

1. Non, continuer sans tests [RECOMMENDED si pas d'infra tests]
2. Oui, lancer /setup pour initialiser les tests
3. Autre : precisez
```

## Demarrage

### Reprise de session

Au lancement, TOUJOURS verifier s'il existe un pipeline actif :
1. Lister `.claude/pipeline/*/state.md`
2. Si un pipeline existe avec une etape "EN COURS" → proposer la reprise

```
Pipeline actif detecte : {feature} ({module})
Etape courante : {numero} — {nom}
Progression : [████████░░] 7/9

1. Reprendre a l'etape {numero} [RECOMMENDED]
2. Repartir de zero (nouveau pipeline)
3. Autre : precisez
```

### Nouveau pipeline

Si pas de pipeline actif ou nouveau pipeline demande :

```
Bienvenue dans /specflow ! Configurons le projet.

Module/composant cible ?
{liste numerotee depuis project-config.md → section "Modules / composants modifiables"}
N. Autre : precisez

Feature ?
> [nom libre, en kebab-case : ex. task-tickets]

Spec existante ?
1. Oui, je charge depuis .claude/specs/ [RECOMMENDED si spec existe]
2. Non, on la cree ensemble
3. J'ai un brief, redige une premiere version
4. Autre : precisez
```

Puis :
1. Creer le dossier `.claude/pipeline/{feature}/`
2. Initialiser `state.md` avec l'etape 1
3. Initialiser `frictions.md` vide
4. Afficher le recapitulatif + progression
5. Demarrer l'etape 1

## Comportement a chaque etape

### Affichage progression OBLIGATOIRE

A chaque etape, afficher :
```
━━━ /specflow — {feature} ({module}) ━━━
[██████░░░░░░░░░░░░] Etape 5/9 — BUILD
Gates : SPECS ✓ (87) | TDD ✓ (92) | TESTS ✓ (90) | CODE → en cours
```

Si tests desactives, les etapes 3-4 s'affichent grisees :
```
━━━ /specflow — {feature} ({module}) ━━━
[████░░░░░░░░░░░░░░] Etape 5/9 — BUILD
Gates : SPECS ✓ (87) | TDD ⊘ | TESTS ⊘ | CODE → en cours
```

### Etape 1 — SPECS

Objectif : produire 2 specs dans `.claude/pipeline/{feature}/`
- **spec-patron.md** : lisible par un non-dev, vocabulaire metier, pas de jargon
- **spec-technique.md** : fichiers, classes, methodes, SQL, mecanismes du framework

Actions :
1. Si spec existante → la copier dans le pipeline et la relire ensemble
2. Si creation → brainstorm collaboratif avec menus dynamiques
3. Si brief → rediger v1 puis iterer
4. Aussi copier dans `.claude/specs/{feature}.md` (reference perenne)

Mettre a jour state.md. Transition :
```
Specs terminees. On passe a l'audit ?

1. Oui, lancer /audit specs {feature} [RECOMMENDED]
2. Je veux relire/modifier d'abord
3. Autre : precisez
```

### Etape 2 — /audit specs (gate)

Lancer `/audit specs {feature}`. Si NO-GO :
- Afficher les points bloquants
- Proposer les corrections via menu
- Relancer l'audit apres corrections
- Ne JAMAIS passer a l'etape 3 sans GO

### Etape 3 — TDD [SKIP si tests desactives]

> **Si Tests = desactive** : afficher `Etape 3 — TDD [SKIP]` et passer a l'etape 5.

Lancer l'agent-testeur en lui fournissant :
- Le dossier pipeline : `.claude/pipeline/{feature}/`
- Le module cible

L'agent-testeur produit `rapport-testeur.md` + ecrit ses frictions.

Transition :
```
Tests ecrits. Rapport testeur disponible. On passe a l'audit ?

1. Oui, lancer /audit tests {feature} [RECOMMENDED]
2. Je veux relire les tests d'abord
3. Lancer les tests pour voir le resultat
4. Lire le rapport testeur
5. Autre : precisez
```

### Etape 4 — /audit tests [SKIP si tests desactives]

> **Si Tests = desactive** : afficher `Etape 4 — /audit tests [SKIP]` et passer a l'etape 5.

Lancer `/audit tests {feature}`. Meme logique gate.

### Etape 5 — BUILD

Lancer l'agent-builder en lui fournissant :
- Le dossier pipeline : `.claude/pipeline/{feature}/`
- Le module cible

L'agent-builder produit `rapport-builder.md` + ecrit ses frictions.

Transition :
```
Implementation terminee. Rapport builder disponible. On passe a l'audit ?

1. Oui, lancer /audit code {feature} [RECOMMENDED]
2. Je veux relire le code d'abord
3. Lancer les tests pour verifier
4. Lire le rapport builder
5. Autre : precisez
```

### Etape 6 — /audit code (gate)

Lancer `/audit code {feature}`. Meme logique gate.

### Etape 7 — RECETTE

Proposer via menu (adapter selon project-config.md → section infra) :
```
Comment on recette ?

1. Dry-run du script de rattrapage sur prod [RECOMMENDED si script existe]
2. Deploiement sur serveur test d'abord
3. Deploiement direct sur prod
4. Test manuel dans l'interface
5. Autre : precisez
```

Produire `rapport-recette.md` dans le pipeline.

### Etape 8 — /audit recette (gate)

Lancer `/audit recette {feature}`. Meme logique gate.

### Etape 9 — DEPLOY

Appliquer le workflow Git de `project-config.md` → section Git.
**Le merge est TOUJOURS fait par l'utilisateur.**
Mettre a jour state.md : etape 9 = TERMINE.

## Fin de pipeline

Apres l'etape 9 (DEPLOY), proposer :
```
Pipeline termine ! Frictions enregistrees : {N}

1. Lancer /retro analyse pour ameliorer le workflow [RECOMMENDED si frictions > 0]
2. Passer, on verra plus tard
3. Autre : precisez
```

## Regles

- Ne JAMAIS sauter une etape
- Ne JAMAIS passer une gate sans GO
- Toujours lire `project-config.md` au demarrage
- Toujours afficher la progression (barre visuelle + etape/9)
- Toujours mettre a jour state.md apres chaque action
- Si l'utilisateur veut revenir en arriere, c'est autorise — mettre a jour state.md
- Si l'utilisateur dit "on reprend" ou "on continue specflow", relire state.md et reprendre
- Chaque agent DOIT produire son rapport dans le pipeline avant de passer a l'audit
- L'audit DOIT lire tous les rapports precedents pour verifier la coherence de chaine
- **Toujours loguer les frictions** dans frictions.md
