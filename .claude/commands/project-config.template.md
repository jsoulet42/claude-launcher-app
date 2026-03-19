# Project Config — {Nom du projet}

Ce fichier est la seule source de configuration projet-specifique.
Tous les skills du workflow (/specflow, /audit, /agent-testeur, /agent-builder, /retro)
lisent ce fichier au demarrage pour adapter leur comportement au projet.

## Projet

- **Nom** : {nom du projet}
- **Description** : {description courte}
- **Stack** : {langages / framework / BDD / serveur}
- **Repo** : {url du repo ou organisation}

## Architecture

- **Chemin racine local** : {chemin local}
- **Code modifiable** : {dossiers ou fichiers modifiables}
- **Code en lecture seule** : {framework, vendor, node_modules, etc.}
- **Mecanismes d'extension** : {hooks, middleware, plugins, decorators, etc.}

## Regle absolue

> {La regle #1 du projet que personne ne doit enfreindre.}
> {Exemples : "Ne pas modifier le core du framework", "Ne pas commit sur main sans PR", etc.}

## Modules / composants modifiables

Liste des composants sur lesquels on peut travailler (pour le menu /specflow) :

1. {composant 1} — {description courte}
2. {composant 2} — {description courte}
3. ...

## Tests

- **Framework** : {PHPUnit, Jest, pytest, go test, cargo test, etc.}
- **Runner** : {commande pour lancer les tests, ex: npm test, pytest, bash test.sh}
- **Bootstrap / Setup** : {fichier de setup si applicable, sinon "aucun"}
- **Repertoire tests** : {chemin relatif, ex: tests/, __tests__/, spec/}
- **Convention nommage** : {pattern fichiers, ex: {NomClasse}Test.php, *.test.ts}
- **Convention methodes** : {pattern methodes, ex: test{Methode}_{Scenario}, it('should...')}
- **Principe d'isolation** : {zero DB, mocks, containers, base en memoire, etc.}
- **Catalogue** : {comment les tests sont references — README, config runner, aucun}
- **Risque metier** : {oui/non — chaque test documente-t-il ce qui casse s'il echoue ?}

## Infrastructure

### Production
- **Serveur** : {acces SSH, URL de deploiement, ou plateforme (Vercel, Heroku, etc.)}
- **Chemin** : {chemin de deploiement sur le serveur}
- **BDD** : {host, nom, acces}
- **CLI** : {commande pour executer du code en prod, ex: php, node, python}
- **Log** : {chemin des logs applicatifs}

### Staging / Test (si applicable)
- **URL** : {url de test}
- **Specificites** : {donnees limitees, config differente, etc.}

## Git

- **Workflow** : {feature branches, trunk-based, gitflow, etc.}
- **Convention branches** : {feature/{nom}, fix/{nom}, etc.}
- **Convention commits** : {conventional commits, libre, etc.}
- **Fichiers IA exclus** : {.claude/ dans .gitignore}

## Pieges connus (optionnel)

{Lister ici les pieges techniques specifiques au projet que les agents doivent connaitre.
Exemples : cache invalide, versions differentes local/prod, tables manquantes, etc.}
