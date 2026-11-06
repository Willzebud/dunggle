# Dunggle

Dunggle est une application de veille technologique. Elle collecte, classe et résume les publications récentes sur trois thématiques :

- **Angular** : blog officiel, releases du framework et d'Angular Components ;
- **Intelligence artificielle** : OpenAI, Google DeepMind, Hugging Face, Google Research ;
- **Agents IA** : Simon Willison, OpenAI Agents SDK, LangGraph, MCP TypeScript SDK, Claude Code.

Cinq sources complémentaires, validées au POC 1.2, élargissent la veille de façon sélective : TypeScript Blog (Angular), Google Project Zero (cybersécurité), IEEE Spectrum Robotics (robotique), MIT Technology Review et One Useful Thing (transformations et prospective). Au total : **17 sources**.

Cible technique : frontend **Angular**, API **NestJS**, base **MongoDB**. Le projet avance par POC successifs avant toute conception de l'application finale.

## Structure du monorepo

```text
dunggle/
├── apps/
│   ├── web/                 # Future application Angular (non initialisée)
│   └── api/                 # Future API NestJS (non initialisée)
├── pocs/
│   ├── veille-feasibility/  # POC 1 et 1.1 : collecte des sources et extraction de contenu
│   └── ai-analysis/         # POC 2 : analyse et classification par IA (phase A : préparation, sans appel réel)
├── docs/                    # Documentation transverse
├── package.json             # Racine npm workspaces (apps/*, pocs/*)
├── package-lock.json        # Lockfile unique du monorepo
└── README.md
```

Monorepo léger basé sur **npm workspaces**, sans Nx ni Turborepo. Chaque projet garde son propre `package.json` et ses dépendances. Il n'y a pas encore de bibliothèque partagée : un dossier `packages/` sera créé seulement si un besoin réel apparaît.

## Prérequis

- Node.js ≥ 20 (testé avec Node.js 22), qui fournit le `fetch` natif
- npm ≥ 10
- Accès Internet pour les POC, qui interrogent les vraies sources
- Facultatif : un token GitHub sans scope (`GITHUB_TOKEN`) pour passer de 60 à 5 000 requêtes/heure (voir `pocs/veille-feasibility/.env.example`)

## Installation

Depuis la racine du dépôt :

```bash
npm install
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm test` | Tous les tests hors ligne (POC 1 et POC 2), sans réseau ni facturation |
| `npm run poc2:test` | Tests du POC 2 seuls (schéma, politiques de contenu, budget, concurrence, erreurs fournisseur) |
| `npm run poc2:prepare` | POC 2 : prépare l’évaluation (modes envoyés, coûts maximaux, mesure du préfiltre), sans appel |
| `npm run poc2:budget` | POC 2 : exécute les scénarios budgétaires et génère leur rapport |
| `npm run poc:sources` | POC 1 : teste les 17 sources (un passage, environ 30 requêtes) et génère les rapports de faisabilité |
| `npm run poc:extraction` | POC 1.1 : extrait le contenu de 6 pages et vérifie un lien par source (environ 21 pages). Nécessite d'avoir lancé `poc:sources` avant |
| `npm run poc:candidates` | POC 1.2 : re-teste les sources candidates (**requêtes réseau**) |
| `npm run poc:candidates:offline` | POC 1.2 : régénère les rapports depuis `candidates-raw.json`, sans aucune requête |
| `npm run poc:all` | POC 1 puis POC 1.1 |
| `npm run typecheck` | Vérification TypeScript de tous les workspaces |

Les commandes réseau font un passage unique et séquentiel. Ne les lancez pas en boucle.

## État des POC

| POC | Statut | Résultat |
|---|---|---|
| **POC 1** : faisabilité de la collecte | ✅ Terminé | 12/12 sources accessibles avec des dates fiables ; environ 9 publications/jour |
| **POC 1.1** : extraction de contenu et niveaux FULL / PARTIAL / MINIMAL | ✅ Terminé | Hugging Face et Google Research passent de MINIMAL à FULL par extraction de la page (6/6). Aucune source n'est exclue faute de contenu |
| **POC 1.2** : élargissement ciblé des sources | ✅ Terminé | 8 candidates et 2 variantes testées ; 5 retenues et **intégrées à la configuration** (17 sources) ; règles éditoriales ciblées (« The Download » exclu avec trace, « Video Friday » marqué) ; taxonomie du POC 2 documentée |
| **POC 2 — phase A** : préparation de l’analyse IA | ✅ Terminée | Politiques de contenu (17 sources en `metadata-only`), schéma validé, adaptateurs Anthropic/OpenAI désactivés et simulés, garde budgétaire (10 € / 8 € / 0,50 €), jeu d’évaluation de 39 publications. **Aucun appel réel** |
| **POC 2 — phase B** : essais réels | ⏳ À valider | Sous budget d’essai de 0,50 €, après validation des points listés dans `pocs/ai-analysis/README.md` |

Rapports détaillés : `pocs/veille-feasibility/results/` (index dans [`docs/README.md`](docs/README.md)).

## Prochaines étapes

1. Trancher les restrictions de réutilisation du contenu ([`docs/content-reuse.md`](docs/content-reuse.md)), en particulier pour les 3 sources dont le robots.txt exclut les robots d'IA.
2. **POC 2 — phase B** (`pocs/ai-analysis/`) : premiers appels réels sous budget d’essai, comparaison des modèles sur le jeu d’évaluation.
3. Validation juridique de la réutilisation du texte intégral des pages extraites (conditions d'utilisation, opt-out TDM).
4. Conception de l'API NestJS (`apps/api/`) et du modèle MongoDB.
5. Développement du dashboard Angular (`apps/web/`).
