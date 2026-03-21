# /audit — Orchestrateur d'audits intelligent

Tu es un orchestrateur d'audits. Tu detectes les traits de la feature, recommandes les audits pertinents, les lances en parallele, valides les resultats croises, et produis un verdict global.

## Configuration

Appliquer les regles de `.claude/commands/_common-rules.md`.

## Parametres

- Argument 1 (optionnel) : etape a auditer (`specs`, `tests`, `code`, `recette`)
- Argument 2 (optionnel) : nom de la feature (ex: `jarvis-v2`)

Exemples : `/audit specs jarvis-v2` ou `/audit code` ou `/audit`

Si arguments absents :
1. Chercher le pipeline actif dans `.claude/pipeline/` (le plus recent avec une etape "EN COURS")
2. Lire `state.md` pour determiner l'etape courante
3. En deduire l'etape d'audit correspondante

## Audits disponibles par etape

| Gate | Audits disponibles |
|------|-------------------|
| specs | conformite, completude, securite |
| tests | conformite, completude |
| code | conformite, securite, completude |
| recette | conformite |

## Processus

### Etape 1 : Detection du contexte

1. Lire `project-config.md`
2. Localiser le pipeline : `.claude/pipeline/{feature}/state.md`
3. Determiner l'etape courante et les audits disponibles pour cette gate

### Etape 2 : Detection automatique des traits

**AVANT d'afficher le menu**, lire la spec technique du pipeline (`.claude/pipeline/{feature}/spec-technique.md` ou equivalent) et analyser son contenu pour detecter les traits de la feature.

Scanner la spec a la recherche des mots-cles suivants :

| Trait | Mots-cles de detection | Audits actives |
|-------|------------------------|----------------|
| Endpoints publics | "endpoint", "webhook", "URL", "public/", "API", "json.php", "ajax", "REST" | Securite (obligatoire) |
| Inputs utilisateur | "input", "recherche", "LIKE", "validateInput", "formulaire", "message", "POST", "GET param" | Securite (obligatoire) |
| Acces base de donnees | "SELECT", "INSERT", "CREATE TABLE", "llx_", "SQL", "UPDATE", "DELETE FROM" | Completude (recommande) |
| Gestion droits | "hasRight", "permission", "droit", "checkPermissions", "restrictedArea" | Securite (recommande) |
| Multi-tenant / entity | "entity", "multi-entite", "multicompany", "$conf->entity", "cross-entity" | Securite + Completude |
| Cron / jobs | "cron", "cronjob", "scheduler", "planifie", "batch", "tache planifiee" | Completude (recommande) |
| Integration externe | "API externe", "webhook", "HMAC", "token", "OAuth", "curl", "callAPI" | Securite + Completude |
| Grande feature (> 5 classes) | Compter les classes/interfaces/modules dans la spec | Completude (obligatoire si > 5) |
| Petite feature (≤ 3 classes) | Peu de composants, feature simple | Conformite seul suffit |

**Regles de detection :**
- Conformite est **TOUJOURS** obligatoire, quel que soit le resultat de la detection
- Un trait "obligatoire" signifie que l'audit correspondant DOIT etre lance (pre-coche, non decochable conceptuellement)
- Un trait "recommande" signifie que l'audit est conseille mais l'utilisateur peut le retirer
- Si aucun trait n'est detecte (spec tres courte ou vague), proposer tous les audits avec un warning : "Spec trop courte pour detecter les traits automatiquement — tous les audits sont proposes."

### Etape 3 : Menu intelligent avec AskUserQuestion

**Si feature simple detectee** (≤ 3 classes, pas d'endpoints, pas d'inputs) ET que l'etape n'est pas `recette` :

Afficher le message :
```
━━━ Audit {etape} — {feature} ━━━

Traits detectes : petite feature (≤ 3 classes, pas d'endpoint, pas d'input)
→ Feature simple detectee. Conformite suffit.
```

Puis `AskUserQuestion` avec :
```json
{
  "questions": [{
    "question": "Lancer uniquement l'audit Conformite ?",
    "header": "Audit",
    "options": [
      {
        "label": "Conformite seul (Recommended)",
        "description": "Feature simple detectee — conformite couvre les besoins"
      },
      {
        "label": "Tous les audits disponibles",
        "description": "Lancer quand meme tous les audits de la gate {etape}"
      }
    ],
    "multiSelect": false
  }]
}
```

**Si feature non simple** (traits detectes ou spec trop courte) :

Afficher le message :
```
━━━ Audit {etape} — {feature} ━━━

Traits detectes :
- {trait 1} → {audits actives} ({obligatoire|recommande})
- {trait 2} → {audits actives} ({obligatoire|recommande})
- ...
```

Puis construire le menu `AskUserQuestion` avec `multiSelect: true`.

**Regles de construction du menu :**
1. Ne proposer QUE les audits disponibles pour cette gate (cf. tableau "Audits disponibles par etape")
2. Les audits obligatoires (detectes via traits) : description = "Obligatoire : {raison basee sur les traits detectes}"
3. Les audits recommandes (detectes via traits) : description = "Recommande : {raison basee sur les traits detectes}"
4. Les audits non pertinents (aucun trait ne les active) : **NE PAS les proposer dans le menu**
5. Si tous les audits disponibles sont obligatoires ou recommandes, ajouter "Tous" en premiere option avec `(Recommended)`
6. Maximum 4 options (regle AskUserQuestion)

**Note** : si le nombre d'audits disponibles depasse 4 (limite AskUserQuestion), regrouper en 2 questions : "Audits essentiels" puis "Audits complementaires". Actuellement 3 audits max, ce cas ne se produit pas.

Exemple de menu genere :
```json
{
  "questions": [{
    "question": "Quels audits lancer pour la gate {etape} ?",
    "header": "Audits",
    "options": [
      {
        "label": "Tous ({N} audits) (Recommended)",
        "description": "Lance : {liste}. Traits detectes : {liste traits}"
      },
      {
        "label": "Conformite",
        "description": "Obligatoire : toujours requis"
      },
      {
        "label": "Securite",
        "description": "Obligatoire : endpoints publics et inputs utilisateur detectes"
      },
      {
        "label": "Completude",
        "description": "Recommande : acces BDD et integration externe detectes"
      }
    ],
    "multiSelect": true
  }]
}
```

### Etape 4 : Execution en parallele

Lancer chaque audit choisi via l'outil **Agent** (subagent_type=Explore).

**Format d'appel pour chaque agent :**
- prompt : "Tu es un auditeur de {type}. Lis le skill {path/audit-{type}.md} pour connaitre ta grille. Audite les specs de {feature} : {path/spec-patron.md} et {path/spec-technique.md}. Etape : {etape}. Produis le rapport en texte (NE PAS ecrire de fichier)."
- Tous les agents sont lances dans le meme bloc de messages (parallelisme)
- Chaque agent retourne son rapport complet en texte brut

**Exemple concret :**
Agent 1 : "Tu es un auditeur de conformite. Lis .claude/commands/audit-conformite.md. Audite .claude/pipeline/jarvis-v2/spec-patron.md et spec-technique.md. Etape : specs."
Agent 2 : "Tu es un auditeur de completude. Lis .claude/commands/audit-completude.md. Audite ..."
Agent 3 : "Tu es un auditeur de securite. Lis .claude/commands/audit-securite.md. Audite ..."

### Etape 5 : Validation croisee (anti faux-positifs)

Apres reception de **TOUS** les rapports, effectuer une validation croisee systematique.

Pour chaque BLOQUANT signale par un audit :

1. **Verification documentaire** : l'info est-elle documentee dans une autre section de la spec ?
   → Si oui : declasser en MINEUR avec mention `[declasse — documente en section {X}]` (faux positif documentaire)

2. **Verification perimetre** : est-ce un detail de BUILD (comment implementer, pas quoi specifier) ?
   → Si oui : declasser en RECOMMANDATION avec mention `[declasse — detail BUILD]`
   → **SEUIL DE PROTECTION** : Si plus de 30% des fichiers listes dans la spec ne sont PAS implementes, le bloquant de completude ne peut PAS etre declasse en "detail BUILD". Un code qui ne couvre que 70% du scope spec est incomplet, pas un detail. Ce seuil s'applique uniquement a l'etape `code`, pas a `specs` ou `tests`.

3. **Deduplication** : le meme probleme est-il signale par 2 audits differents ?
   → Si oui : ne compter qu'une fois, garder la version la plus precise, mentionner l'autre audit entre parentheses

4. **Verification impact reel** : le prochain agent CRASHERAIT-il reellement sans cette info ?
   → Si non : declasser en IMPORTANT ou MINEUR selon la gravite reelle

Apres validation, **recalculer les scores** de chaque audit en tenant compte des declassements :
- Un BLOQUANT declasse en MINEUR ne penalise plus le verdict
- Un BLOQUANT declasse en RECOMMANDATION non plus
- Recalculer le score de l'audit concerne en consequence

**Formule de recalcul :**
- Prendre le score brut de l'audit
- Pour chaque BLOQUANT declasse en MINEUR : ajouter +2 points au score (le BLOQUANT penalisait ~3-5 pts, le MINEUR penalise ~1 pt)
- Pour chaque BLOQUANT declasse en RECOMMANDATION : ajouter +3 points
- Cap a 100/100
- Le verdict change de NO-GO a GO si : aucun BLOQUANT restant ET moins de 3 WARNINGs restants

### Etape 6 : Dashboard 3 niveaux

Afficher le resultat a l'utilisateur dans ce format exact :

```
━━━ AUDIT {etape} — {feature} ━━━

### Niveau 1 : Verdict
| Audit | Score | Verdict |
|-------|-------|---------|
| Conformite | XX/100 | GO/NO-GO |
| Completude | XX/100 | GO/NO-GO |
| Securite | XX/100 | GO/NO-GO |
| **GLOBAL** | **{MIN}/100** | **{GO/NO-GO}** |

Traits : {liste} | Audits : {nombre} | Faux positifs elimines : {nombre}

### Niveau 2 : Points a traiter (si bloquants apres validation)
1. [{code}] {description courte} → {action}
2. [{code}] {description courte} → {action}
(max 5 points, les plus critiques)

### Niveau 3 : Details
→ .claude/pipeline/{feature}/rapport-audit-{etape}.md
```

**Regles du dashboard :**
- Ne montrer dans le tableau que les audits effectivement lances
- Score global = MIN des scores individuels (pas la moyenne)
- Verdict global = GO seulement si TOUS les audits sont GO
- Niveau 2 : max 5 points, tries par criticite decroissante (trier par : severite decroissante [BLOQUANT > IMPORTANT > MINEUR], puis par audit [conformite > completude > securite])
- Niveau 2 : n'afficher que s'il y a des bloquants ou warnings apres validation croisee

**Detail du scoring :**
- Chaque audit calcule son score en moyenne de ses criteres (/10 × 10 = /100)
- Le score GLOBAL = MIN des scores des audits (pas la moyenne)
- Raison : un seul audit faible doit bloquer (un code securise mais mal specifie = risque)

### Etape 7 : Ecriture du rapport complet

Ecrire le rapport dans `.claude/pipeline/{feature}/rapport-audit-{etape}.md` :

```markdown
# Rapport d'audit global — {etape} — {date}

## Audits realises : {liste des audits} (inclure la version de chaque grille, ex: 'Conformite v1.0')
## Traits detectes : {liste des traits}

### Verdict global

| Audit | Score | Verdict | Bloquants | Warnings |
|-------|-------|---------|-----------|----------|
| Conformite | XX/100 | GO | N | N |
| Completude | XX/100 | GO | N | N |
| Securite | XX/100 | GO | N | N |
| **GLOBAL** | **{MIN}/100** | **{GO/NO-GO}** | **{total}** | **{total}** |

### Validation croisee
- Faux positifs documentaires declasses : {N}
- Details BUILD declasses : {N}
- Doublons elimines : {N}
- Bloquants requalifies (impact reel) : {N}
{detail de chaque declassement/deduplication si applicable}

### Points bloquants (si NO-GO)
1. [{audit} — {code critere}] : {probleme} → {action corrective}

### Recommandations (si GO avec WARNINGs)
1. [{audit} — {code critere}] : {recommandation}

---

## Detail : Audit Conformite

{rapport complet de l'audit conformite tel que retourne par l'agent}

---

## Detail : Audit Completude

{rapport complet de l'audit completude tel que retourne par l'agent}

---

## Detail : Audit Securite

{rapport complet de l'audit securite tel que retourne par l'agent}

---
{etc. pour chaque audit realise}
```

### Etape 8 : Mise a jour de state.md

- **Score** : le score le plus bas (MIN de tous les scores, apres validation croisee)
- **Verdict** : GO seulement si TOUS les audits sont GO
- Mettre a jour l'historique dans state.md avec la date et le verdict

## Regles

- Tu es un **orchestrateur**, pas un auditeur — tu coordonnes, valides croises, et compiles
- Chaque audit specialise est execute selon sa propre grille et methode
- **Le verdict global = GO seulement si TOUS les audits sont GO**
- **Le score global = MIN des scores individuels** (pas la moyenne)
- Les audits sont lances **en parallele** via l'outil Agent (tous dans le meme bloc)
- La **validation croisee** est obligatoire avant de produire le dashboard
- La **detection des traits** est obligatoire avant d'afficher le menu
- Le rapport global est TOUJOURS sauve dans `.claude/pipeline/{feature}/rapport-audit-{etape}.md`
- state.md est TOUJOURS mis a jour avec le verdict et la date
- Le systeme est **generique** : pas de reference a un projet ou une techno specifique. `project-config.md` fournit le contexte specifique.
- Toujours afficher les traits detectes avant le menu (transparence)
- Appliquer les regles de `_common-rules.md` (AskUserQuestion obligatoire, frictions)
