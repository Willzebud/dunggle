# POC 2 — Phase A : politiques de contenu

> Configuration : `src/config/content-policies.ts`. Règles appliquées par `src/content-policy.ts` et vérifiées par les tests.

## Principe

| Politique | Ce qui peut être transmis à une IA externe | Résumé |
|---|---|---|
| `full-allowed` | Texte intégral (tronqué à 6 000 caractères) | Fondé sur le texte |
| `excerpt-only` | Extrait d’au plus 400 caractères | Limité à l’extrait |
| `metadata-only` | Titre, source, date, URL, catégories | **Aucun** |
| `blocked` | Rien : **aucun appel externe** | Aucun |

- **L’absence de restriction détectée ne vaut pas autorisation.** Une politique permissive (`full-allowed`, `excerpt-only`) est refusée par la configuration si elle n’a pas de vérification documentée (`verifiedBy`, `verifiedAt`, `evidence`) ou si les conditions d’utilisation sont « non vérifié ».
- **Deux dimensions indépendantes** : le niveau de contenu disponible (FULL / PARTIAL / MINIMAL, POC 1.1) et la politique de réutilisation. Le mode effectivement envoyé est le plus restrictif des deux. Par exemple, une source `full-allowed` avec une publication MINIMAL envoie seulement les métadonnées.
- La sortie du modèle est contrôlée après coup. Un résumé produit alors qu’il n’est pas permis est supprimé et tracé (`summary-forbidden`). Un résumé plus long que l’extrait est supprimé. Un nombre absent du texte fourni entraîne la suppression du résumé (`ungrounded-number`).
- Une publication n’est **jamais** supprimée pour cause de contenu inaccessible : elle reste analysable sur ses métadonnées, ou « en attente ».

## Politique par source (état au 2026-11-06)

| Source | Politique | Signaux techniques (informatifs) | Conditions / droits |
|---|---|---|---|
| Angular Blog | metadata-only | ⚠️ robots.txt (Medium) exclut GPTBot, ClaudeBot et 4 autres robots d’IA ; pages protégées par Cloudflare | non vérifié |
| MIT Technology Review | metadata-only | ⚠️ robots.txt exclut 14 robots d’IA ; texte intégral dans le flux | non vérifié |
| IEEE Spectrum — Robotics | metadata-only | ⚠️ robots.txt exclut 11 robots d’IA ; texte intégral dans le flux | non vérifié |
| OpenAI News | metadata-only | pages protégées par Cloudflare | non vérifié |
| 6 dépôts GitHub (releases) | metadata-only | API officielle | non vérifié (licences des dépôts, conditions de l’API GitHub) |
| TypeScript Blog, DeepMind, Hugging Face, Google Research, Simon Willison, Project Zero, One Useful Thing | metadata-only | aucun robot d’IA exclu détecté | non vérifié |
| `synthetic-fixtures` (tests) | full-allowed | — | sans objet : textes rédigés pour le POC |
| `synthetic-blocked` (tests) | blocked | — | sans objet |

**Les 17 sources réelles sont donc en `metadata-only`.** C’est la conséquence directe de la règle « par défaut, sans autorisation vérifiée » : aucune vérification des conditions d’utilisation n’a été faite à ce stade.

## Lecture des signaux pour les trois sources à vigilance renforcée

Les robots.txt d’Angular Blog, MIT Technology Review et IEEE Spectrum excluent des robots d’IA nommés. Il faut distinguer trois choses :

1. **Signal technique** : ces règles visent des robots de collecte (entraînement, assistants), pas le User-Agent de Dunggle. Elles n’interdisent pas techniquement notre accès au flux.
2. **Conditions contractuelles** : les conditions d’utilisation de chaque site peuvent autoriser ou interdire la réutilisation, notamment l’envoi du texte à un tiers (fournisseur de LLM). Elles **n’ont pas été lues**.
3. **Droits applicables** : en droit européen, l’exception de fouille de textes et de données (directive 2019/790, art. 4) cède devant une réservation exprimée de manière appropriée. Les règles de robots.txt peuvent constituer une telle réservation. C’est une question juridique, pas technique.

Ces signaux ne prouvent pas que tout usage d’un LLM serait interdit. En cas d’incertitude, la politique restrictive s’applique.

## Ce que cela implique pour la phase B

- Sur les publications réelles, la phase B évalue la **classification à partir des métadonnées** (thématiques, type, pertinence, nouveauté, exclusions), sans résumé.
- La qualité des **résumés** n’est évaluée que sur les fixtures synthétiques (FULL et PARTIAL), dont les faits de référence sont connus.
- Pour passer une source en `excerpt-only` ou `full-allowed`, il faut une revue documentée (conditions d’utilisation, licence, éventuel accord) consignée dans le champ `verification`. Les tests refusent sinon la configuration.

## Restrictions encore non résolues

1. Conditions d’utilisation et droits : non vérifiés pour les 17 sources.
2. Décision à prendre pour les 3 sources dont le robots.txt exclut des robots d’IA.
3. Notes de release GitHub : licence du contenu des notes (souvent distincte de la licence du code) et conditions de l’API.
4. Forme acceptable d’un résumé affiché dans le dashboard pour un article protégé (longueur, citation, lien).
