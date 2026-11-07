# Guide de développement

## Prérequis

- Node.js ≥ 20 (testé avec Node.js 22), qui fournit le `fetch` natif.
- npm ≥ 10.
- Accès Internet uniquement pour les commandes réseau des POC, qui interrogent les vraies sources.

## Organisation

Le monorepo utilise des **npm workspaces**, sans Nx ni Turborepo. Chaque projet garde son propre `package.json`, et un seul lockfile est commun à tous.

| Workspace | Rôle |
|---|---|
| `apps/api` (`@dunggle/api`) | Backend : collecte, analyse, budget ([conception](backend-design.md)) |
| `pocs/veille-feasibility` | POC 1, 1.1 et 1.2 : collecte, extraction de contenu, règles éditoriales (figé) |
| `pocs/ai-analysis` | POC 2 : analyse IA, garde budgétaire, comparaison des modèles (figé) |

Les POC sont **figés**. Leur état de référence correspond au tag Git local `poc-final`. `apps/api` reprend leurs composants **par copie** et n'importe jamais `pocs/`, ce que vérifie un test.

## Commandes de l'application

| Commande | Rôle |
|---|---|
| `npm test` | Tous les tests hors ligne (POC et backend), sans réseau ni facturation |
| `npm run api:test` | Tests du backend seul |
| `npm run typecheck` | Vérification TypeScript de tous les workspaces |
| `npm run check:secrets` | Recherche de secrets et de fichiers sensibles dans les fichiers suivis par Git (à lancer avant chaque commit) |

## Reproduction des POC

Les commandes réseau font un passage unique et séquentiel : ne les lancez pas en boucle.

| Commande | Rôle |
|---|---|
| `npm run poc:sources` | POC 1 : teste les 17 sources (un passage, environ 30 requêtes) et génère les rapports de faisabilité |
| `npm run poc:extraction` | POC 1.1 : extrait le contenu de 6 pages et vérifie un lien par source (environ 21 pages). À lancer après `poc:sources` |
| `npm run poc:all` | POC 1 puis POC 1.1 |
| `npm run poc:candidates` | POC 1.2 : teste à nouveau les sources candidates (**requêtes réseau**) |
| `npm run poc:candidates:offline` | POC 1.2 : régénère les rapports depuis `candidates-raw.json`, sans aucune requête |
| `npm run poc2:test` | Tests du POC 2 seuls |
| `npm run poc2:prepare` | POC 2 : prépare l'évaluation (modes envoyés, coûts maximaux, préfiltre), sans appel |
| `npm run poc2:budget` | POC 2 : rejoue les scénarios budgétaires et régénère leur rapport |
| `npm run poc2:evaluate` | POC 2 : exécuteur des phases B, en **simulation** uniquement. Les trois phases sont fermées : aucun appel réel n'est possible |
| `npm run poc2:authorize` | POC 2 : création d'une autorisation locale à usage unique, refusée pour une phase fermée |
| `npm run poc2:compare` | POC 2 : comparaison hors ligne des résultats locaux (`-- --phase=B3` pour le test final) |

Les détails de chaque POC se trouvent dans leur README : [POC 1](../pocs/veille-feasibility/README.md) et [POC 2](../pocs/ai-analysis/README.md).

## Variables d'environnement

Aucune n'est obligatoire pour les tests.

| Variable | Usage |
|---|---|
| `GITHUB_TOKEN` | Facultatif : token GitHub sans scope, qui fait passer l'API de 60 à 5 000 requêtes par heure |
| `DUNGGLE_USER_AGENT` | Facultatif : User-Agent de la collecte du backend |
| `POC_USER_AGENT` | Facultatif : User-Agent de la collecte des POC |
| `OPENAI_API_KEY` | Réservée aux appels réels, qui exigent une autorisation distincte. Elle va dans un fichier `.env` local, jamais dans Git ni dans une conversation |

Les modèles de fichier sont `pocs/*/.env.example`. Les fichiers `.env` sont ignorés par Git.

## Règles de travail

- **Tests hors ligne.** `fetch` est remplacé par une fonction qui échoue ou par un faux serveur aux réponses synthétiques. Aucun test ne fait d'appel réseau ni d'appel payant.
- **Aucun appel payant sans autorisation explicite.** Les plafonds et quotas sont figés dans le code (`apps/api/src/config/limits.ts`).
- **Prompt, schéma et règles de contenu validés en B3 : figés.** Des tests de référence le vérifient. Toute évolution est explicite et versionnée ([conception, § 8](backend-design.md#8-prompt-schéma-et-règles-de-contenu-validés-en-b3-correction-5)).
- **Données locales hors Git** : registres budgétaires, journaux d'usage, sorties brutes, revues à l'aveugle (`pocs/ai-analysis/var/`) et données de collecte contenant des extraits tiers.
