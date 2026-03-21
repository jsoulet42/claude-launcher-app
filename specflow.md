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

Si le statut est `desactive`, proposer a chaque lancement via **AskUserQuestion** :
- Option 1 : "Continuer sans tests (Recommended)" — description: "Pas d'infra tests configuree"
- Option 2 : "Activer les tests" — description: "Lancer /setup pour initialiser Vitest"

## Demarrage

### Reprise de session

Au lancement, TOUJOURS verifier s'il existe un pipeline actif :
1. Lister `.claude/pipeline/*/state.md`
2. Si un pipeline existe avec une etape "EN COURS" → proposer la reprise

Afficher la progression puis proposer via **AskUserQuestion** (header: "Reprise") :
- Option 1 : "Reprendre etape {numero} (Recommended)" — description: "Continuer le pipeline en cours"
- Option 2 : "Repartir de zero" — description: "Creer un nouveau pipeline pour cette feature"

### Nouveau pipeline

Si pas de pipeline actif ou nouveau pipeline demande :

Afficher "Bienvenue dans /specflow !" puis enchainer 3 questions via **AskUserQuestion** :

**Question 1** (header: "Module") : lister les modules depuis project-config.md → "Modules / composants"
- Les transformer en options AskUserQuestion (max 4, regrouper si besoin)

**Question 2** : demander le nom de la feature en texte libre (AskUserQuestion sans options, juste la question)

**Question 3** (header: "Specs") :
- Option 1 : "Charger spec existante (Recommended)" — description: "Depuis .claude/specs/" (si spec existe)
- Option 2 : "Creer ensemble" — description: "Brainstorm collaboratif"
- Option 3 : "J'ai un brief" — description: "Rediger une v1 a partir de ton brief"

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

**Source de verite** : `.claude/pipeline/{feature}/` est la version VIVANTE (modifiable pendant le pipeline). `.claude/specs/{feature}.md` est la version de REFERENCE (figee, copiee en fin de pipeline a l'etape DEPLOY). Pendant le pipeline, toujours modifier la version pipeline. La version reference est mise a jour une seule fois a la fin.

Mettre a jour state.md. Transition via **AskUserQuestion** (header: "Specs") :
- Option 1 : "Lancer /audit specs (Recommended)" — description: "Auditer les specs avant de coder"
- Option 2 : "Relire/modifier d'abord" — description: "Revoir les specs avant l'audit"

### Etape 2 — /audit specs (gate)

Lancer `/audit specs {feature}`. L'orchestrateur :
1. Affiche un menu multiSelect des audits disponibles (conformite, completude, securite)
2. Lance les audits choisis **en parallele** via l'outil Agent
3. Effectue une **validation croisee** pour eliminer les faux positifs
4. Affiche le **dashboard 3 niveaux** (verdict → bloquants → details)

Si NO-GO :
- Afficher les points bloquants (apres validation croisee)
- Proposer les corrections via menu
- Relancer l'audit apres corrections
- Ne JAMAIS passer a l'etape suivante sans GO global

### Etape 3 — TDD [SKIP si tests desactives]

> **Si Tests = desactive** : afficher `Etape 3 — TDD [SKIP]` et passer a l'etape 5.

Lancer l'agent-testeur en lui fournissant :
- Le dossier pipeline : `.claude/pipeline/{feature}/`
- Le module cible

L'agent-testeur produit `rapport-testeur.md` + ecrit ses frictions.

Transition via **AskUserQuestion** (header: "TDD") :
- Option 1 : "Lancer /audit tests (Recommended)" — description: "Auditer les tests avant le build"
- Option 2 : "Relire les tests" — description: "Verifier les tests ecrits par l'agent"
- Option 3 : "Executer les tests" — description: "Lancer npm run test:unit pour voir le resultat"
- Option 4 : "Lire le rapport testeur" — description: "Consulter rapport-testeur.md"

### Etape 4 — /audit tests [SKIP si tests desactives]

> **Si Tests = desactive** : afficher `Etape 4 — /audit tests [SKIP]` et passer a l'etape 5.

Lancer `/audit tests {feature}`. L'orchestrateur :
1. Affiche un menu multiSelect des audits disponibles (conformite, completude)
2. Lance les audits choisis **en parallele** via l'outil Agent
3. Effectue une **validation croisee** pour eliminer les faux positifs
4. Affiche le **dashboard 3 niveaux** (verdict → bloquants → details)

Si NO-GO :
- Afficher les points bloquants (apres validation croisee)
- Proposer les corrections via menu
- Relancer l'audit apres corrections
- Ne JAMAIS passer a l'etape suivante sans GO global

### Etape 5 — BUILD

Lancer l'agent-builder en lui fournissant :
- Le dossier pipeline : `.claude/pipeline/{feature}/`
- Le module cible

L'agent-builder produit `rapport-builder.md` + ecrit ses frictions.

Transition via **AskUserQuestion** (header: "Build") :
- Option 1 : "Lancer /audit code (Recommended)" — description: "Auditer le code implemente"
- Option 2 : "Relire le code" — description: "Inspecter les fichiers modifies"
- Option 3 : "Executer les tests" — description: "Lancer les tests pour verifier"
- Option 4 : "Lire le rapport builder" — description: "Consulter rapport-builder.md"

### Etape 6 — /audit code (gate)

Lancer `/audit code {feature}`. L'orchestrateur :
1. Affiche un menu multiSelect des audits disponibles (conformite, securite, completude)
2. Lance les audits choisis **en parallele** via l'outil Agent
3. Effectue une **validation croisee** pour eliminer les faux positifs
4. Affiche le **dashboard 3 niveaux** (verdict → bloquants → details)

Si NO-GO :
- Afficher les points bloquants (apres validation croisee)
- Proposer les corrections via menu
- Relancer l'audit apres corrections
- Ne JAMAIS passer a l'etape suivante sans GO global

### Etape 7 — RECETTE

Proposer via **AskUserQuestion** (header: "Recette", adapter selon project-config.md → section infra) :
- Option 1 : "Dry-run sur prod (Recommended)" — description: "Valider le script de rattrapage avant application" (si script existe)
- Option 2 : "Deployer sur test" — description: "Serveur test pour valider sans risque"
- Option 3 : "Direct sur prod" — description: "Plus rapide mais pas de filet de securite"
- Option 4 : "Test manuel interface" — description: "Verifier visuellement dans le navigateur"

Produire `rapport-recette.md` dans le pipeline.

### Etape 8 — /audit recette (gate)

Lancer `/audit recette {feature}`. L'orchestrateur :
1. Affiche un menu multiSelect des audits disponibles (conformite uniquement)
2. Lance l'audit
3. Affiche le **dashboard 3 niveaux** (verdict → bloquants → details)

Si NO-GO :
- Afficher les points bloquants
- Proposer les corrections via menu
- Relancer l'audit apres corrections
- Ne JAMAIS passer a l'etape suivante sans GO global

### Etape 9 — DEPLOY

Appliquer le workflow Git de `project-config.md` → section Git.
**Le merge est TOUJOURS fait par l'utilisateur.**
Mettre a jour state.md : etape 9 = TERMINE.

## Fin de pipeline

Apres l'etape 9 (DEPLOY), afficher "Pipeline termine ! Frictions enregistrees : {N}" puis proposer via **AskUserQuestion** (header: "Retro") :
- Option 1 : "Lancer /retro (Recommended)" — description: "{N} frictions a analyser pour ameliorer le workflow" (si frictions > 0)
- Option 2 : "Passer" — description: "On verra plus tard"

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
- **Ownership state.md** :
  - `/specflow` est responsable de : etape courante, progression, historique
  - `/audit` est responsable de : score audit, verdict GO/NO-GO dans l'historique
  - Les deux ne modifient JAMAIS les champs de l'autre
  - En cas de conflit : state.md est relu avant chaque ecriture
