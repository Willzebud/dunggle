# Résultats des POC 1, 1.1 et 1.2

## Fichiers suivis par Git

- Les rapports de synthèse (`*.md`).
- Les JSON de **métadonnées** : `sources-report.json` (traces HTTP, analyses), `poc-1.2/editorial-grid.json` (titres, URL, verdicts), `poc-1.2/manual-review.json` (revue manuelle).
- `content-extraction-report.md` contient 6 courtes citations (au plus 160 caractères), avec leur lien source. Elles servent de preuve que le texte extrait correspond bien à l'article (POC 1.1). C'est la seule reprise de texte tiers conservée.

## Fichiers exclus de Git (extraits de contenus tiers)

Ces fichiers reproduisent des extraits d'articles tiers (descriptions jusqu'à 500 caractères, aperçus de pages de 300 caractères). Leur réutilisation n'est pas autorisée (voir `docs/content-reuse.md`). Ils existent seulement en local :

| Fichier exclu | Produit par | Utilisé par | Régénération |
|---|---|---|---|
| `articles.json` | `npm run poc:sources` | `poc:extraction`, `poc:candidates:offline` | `npm run poc:sources` (réseau, un passage) |
| `content-extraction.json` | `npm run poc:extraction` | `poc:candidates:offline` | `npm run poc:sources && npm run poc:extraction` |
| `poc-1.2/candidates-raw.json` | `npm run poc:candidates` | `poc:candidates:offline` | `npm run poc:candidates` (réseau) |
| `archive/**/{articles,content-extraction,candidates-raw}.json` | copies des précédents | — | non régénérables à l'identique |

**Conséquence** : après un clonage, `poc:candidates:offline` ne fonctionne qu'après `poc:candidates`. Comme les flux évoluent, les rapports régénérés diffèrent des rapports **validés**, qui sont conservés dans `poc-1.2/` (versionnés : toute régénération apparaît dans `git diff` ; état validé au tag `poc-final`). Les rapports Markdown suivis restent la référence.
