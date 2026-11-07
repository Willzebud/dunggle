# POC 1 et 1.1 : faisabilité de la collecte de veille

Ce POC teste les 17 sources de Dunggle (12 initiales et 5 ajoutées au POC 1.2) (flux RSS/Atom et API GitHub Releases), analyse leur faisabilité, puis vérifie l'extraction du contenu des pages et la classification FULL / PARTIAL / MINIMAL. Il ne fait aucun appel à un LLM.

## Relancer les tests

Depuis la **racine du monorepo** :

```bash
npm install
npm run poc:sources      # POC 1
npm run poc:extraction   # POC 1.1 (lit les résultats du POC 1)
npm run poc:candidates:offline   # POC 1.2 : régénère les rapports sans requête
npm test                 # tests unitaires hors ligne
```

Ou depuis ce dossier :

```bash
npm run test:sources
npm run test:content
npm run test:candidates -- --offline
npm run test:unit
npm run typecheck
```

Variables d'environnement facultatives (voir `.env.example`). Elles sont lues depuis l'environnement du shell, car aucun fichier `.env` n'est chargé automatiquement :

```bash
GITHUB_TOKEN=xxx npm run poc:sources
```

## Fichiers

| Chemin | Rôle |
|---|---|
| `src/sources.config.ts` | Configuration centralisée des 17 sources (`INITIAL_SOURCE_IDS` = les 12 initiales) et des réglages |
| `src/editorial-rules.ts` | Règles éditoriales déterministes **ciblées par source** : « The Download » (MIT TR) exclu avec trace, « Video Friday » (IEEE Robotics) marqué et conservé |
| `src/http.ts` | `fetch` avec timeout, User-Agent, trace HTTP, vérification de robots.txt |
| `src/collectors/feed.ts` / `github.ts` | Collecteurs RSS/Atom et GitHub Releases |
| `src/analysis.ts` | Analyse de faisabilité par source et estimation du volume |
| `src/content-level.ts` | Classification de la disponibilité du contenu (FULL / PARTIAL / MINIMAL) |
| `src/url-utils.ts` | Validation des URL et clé de déduplication (`dedupKey`) |
| `src/extract.ts` | Extraction générique de pages (Mozilla Readability + linkedom) |
| `src/test-sources.ts` / `src/report.ts` | Point d'entrée et rapports du POC 1 |
| `src/test-content.ts` | Point d'entrée et rapport du POC 1.1 |
| `src/tests/unit.test.ts` | Tests unitaires hors ligne (`npm run test:unit`) |
| `src/poc-1-2/` | POC 1.2 : candidates (`candidates.config.ts`), grille éditoriale déterministe, tests et rapports |

## Résultats (`results/`)

| Fichier | Contenu |
|---|---|
| `feasibility-report.md` | Rapport POC 1 lisible (tableau des sources, bilan par catégorie, volume, projection de budget) |
| `sources-report.json` | Détail des tests par source (requêtes HTTP, analyse) |
| `articles.json` | Publications normalisées (10 par source) avec `contentLevel`, `dedupKey`, `idBasis` et `editorial` ; `excluded` contient les publications exclues par une règle éditoriale, avec leur motif |
| `content-extraction-report.md` | Rapport POC 1.1 (extraction, URL, niveaux, comportement du dashboard) |
| `content-extraction.json` | Détail des extractions et des contrôles d'URL |
| `archive/` | Résultats conservés : `poc-1.1-12-sources/` (avant intégration des 5 sources). Les rapports POC 1.2 validés sont dans `poc-1.2/` (l'ancienne copie identique `archive/poc-1.2-validated/` a été retirée le 2026-11-07 ; état complet au tag `poc-final`) |
| `poc-1.2/` | POC 1.2 : 7 rapports Markdown (candidates, tests, qualité éditoriale, couverture, volume, taxonomie, recommandations) et données brutes JSON |

Chaque exécution **réécrit** ces fichiers avec les réponses réelles du moment.

## Identifiants et règles éditoriales

- **Identifiants** : `id` = `<source>:<identifiant natif>` par défaut. Si plusieurs publications d'un flux partagent un identifiant natif, celles-ci passent à `<source>:<dedupKey>` (URL normalisée) et un avertissement est émis. Project Zero est configuré en `idStrategy: 'normalized-url'`, car son flux Atom réutilise le même `<id>`. `url` (lien original) et `nativeId` ne sont jamais modifiés.
- **Règles éditoriales** : une règle cible **une source et un motif de titre**. `exclude` retire la publication de `articles` mais la conserve dans `excluded` avec `editorial.ruleId` et son motif. `flag` la conserve dans `articles` avec `editorial.action = "flagged"`. Ce n'est pas un filtre par mot-clé : la classification IA du POC 2 pourra récupérer ces publications.
- **Signaux de réutilisation** : `robots.aiCrawlersDisallowed` liste les robots d'IA exclus par le site (voir `docs/content-reuse.md`).
