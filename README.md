# Dunggle

Veille technologique personnelle : Dunggle collecte les publications récentes sur **Angular**, l'**intelligence artificielle** et les **agents IA**, puis les classe et les résume en français grâce à un modèle d'IA, dans le respect des droits de chaque source.

## Fonctionnalités

- **Collecte** de 17 sources officielles et sélectionnées (blogs, flux RSS/Atom, releases GitHub), en un passage poli qui respecte `robots.txt`.
- **Déduplication** par URL normalisée avant toute analyse ; l'URL originale n'est jamais modifiée.
- **Respect des droits** : une politique par source fixe ce qui peut être conservé, transmis ou résumé. Par défaut : métadonnées seulement.
- **Analyse par IA** (GPT-6 Luna) : thèmes, type de publication, pertinence, nouveauté, décision de conservation ou d'exclusion, résumé lorsque les droits le permettent.
- **Maîtrise des coûts** : réservation budgétaire avant chaque appel, quotas quotidiens et mensuels, arrêt en cas de coût incertain.

## Stack technique

| | Technologies |
|---|---|
| **Disponible** | Node.js 22, TypeScript, npm workspaces, `node:test` |
| **Prévu** | MongoDB 8 (stockage), API HTTP puis NestJS, dashboard Angular |

## État du projet

- ✅ **Études de faisabilité terminées** ([résultats des POC](docs/poc-results.md)) : collecte des sources, niveaux de contenu, politiques de droits, comparaison de modèles. **GPT-6 Luna** a été retenu selon le protocole du test final B3.
- 🚧 **Backend en cours** dans `apps/api` ([conception](docs/backend-design.md)) : analyse, collecte et garde budgétaire implémentées et testées hors ligne. Prochaines étapes : stockage MongoDB, ingestion, cycle complet.
- ⏳ **Dashboard Angular** : pas encore commencé.

Aucun appel payant n'est fait sans autorisation explicite. Tous les tests fonctionnent hors ligne.

## Démarrage rapide

Prérequis : Node.js ≥ 20 (testé avec 22) et npm ≥ 10.

```bash
npm install          # installe tous les workspaces
npm test             # tous les tests, hors ligne (POC et backend)
npm run typecheck    # vérification TypeScript de tous les workspaces
npm run api:test     # tests du backend seul
npm run check:secrets  # à lancer avant chaque commit
```

Les commandes de reproduction des POC (collecte réelle, scénarios budgétaires, comparaison des modèles) sont décrites dans le [guide de développement](docs/development.md).

## Structure

```text
apps/api/   Backend : collecte, analyse, budget (TypeScript)
apps/web/   Dashboard Angular (à venir)
docs/       Architecture, développement, droits, sécurité, résultats
pocs/       Études de faisabilité terminées et figées (code, rapports, tests)
```

## Documentation

- [Index de la documentation](docs/README.md)
- [Conception du backend](docs/backend-design.md)
- [Guide de développement](docs/development.md)
- [Réutilisation des contenus](docs/content-reuse.md) et [sécurité des appels IA](docs/ai-api-security.md)
- [Résultats des POC](docs/poc-results.md)
