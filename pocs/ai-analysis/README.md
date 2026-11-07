# POC 2 — Analyse IA, phase A (préparation)

Cette phase prépare l’analyse et la classification des publications par IA **sans effectuer aucun appel réel** :
- politiques de contenu par source ;
- schéma de sortie validé ;
- adaptateurs (Anthropic, OpenAI et simulé) ;
- protection budgétaire ;
- préfiltre en observation ;
- jeu d’évaluation avec vérité terrain.

## Commandes

Depuis la racine du monorepo :

```bash
npm install
npm run poc2:test        # tests hors ligne (aucun réseau, aucune facturation)
npm run poc2:prepare     # reports/evaluation-readiness.md
npm run poc2:budget      # reports/budget-scenarios.md
npm run typecheck        # tous les workspaces
```

Ou depuis ce dossier : `npm test`, `npm run prepare:eval`, `npm run budget:scenarios`, `npm run evaluate:real`, `npm run check:secrets`, `npm run typecheck`.

### Exécuteur de la phase B (`npm run evaluate:real`)

```bash
npm run evaluate:real                                   # simulation du smoke test (défaut, aucun appel)
npm run evaluate:real -- --mode=full --dry-run          # simulation de l’évaluation complète
npm run authorize:real -- --phase=B1 --models=anthropic-haiku-5-5,openai-gpt-6-luna --max-eur=0.004 --confirm="AUTORISER B1 0.004 EUR"
npm run evaluate:real -- --mode=smoke --real --confirm-max-eur=0.004   # réel : exige l’autorisation ci-dessus
```

Options autorisées : `--model=<clé>|all`, `--mode=smoke|full|final`, `--dry-run`, `--real`, `--confirm-max-eur=<€ ≤ 0,50>`, `--max-calls=<n>` (abaisse seulement le plafond). Toute autre option est refusée. Un appel réel exige tous les verrous décrits dans `reports/phase-b1-readiness.md` § 3 (autorisation locale à usage unique, quotas, budget, clés, registre cohérent). Les analyses déjà terminées ou incertaines ne sont jamais refacturées lors d’une reprise.

## Garanties de la phase A

- **Aucune activation permanente** : les adaptateurs réels (SDK officiels, `maxRetries: 0`) lèvent `RealCallsDisabledError` sans activation en mémoire issue d’une autorisation locale à usage unique.
- Aucun `fetch` dans le POC ; les SDK fournisseurs ne sont chargés (import dynamique) que dans `src/adapters/real.ts`, derrière les verrous. Un test le vérifie, et tous les tests remplacent `fetch` par une fonction qui échoue.
- Les clés API proviendraient des variables d’environnement (voir `.env.example`). Elles ne sont ni lues ni affichées en phase A, seule leur présence peut être testée.
- L’état budgétaire et les journaux locaux vont dans `var/`, qui est ignoré par Git.

## Architecture

| Fichier | Rôle |
|---|---|
| `src/taxonomy.ts` | Thématiques, sous-thématiques extensibles, types, motifs d’exclusion (taxonomie du POC 1.2) |
| `src/schema.ts` | Schéma JSON envoyé aux fournisseurs et validation locale stricte (bornes, cohérences) |
| `src/config/content-policies.ts` | Politique par source (`full-allowed` / `excerpt-only` / `metadata-only` / `blocked`) et garde-fou de vérification |
| `src/content-policy.ts` | Croisement niveau de contenu × politique → mode envoyé (`full` / `excerpt` / `metadata` / `none`) |
| `src/prompt.ts` | Consignes stables (compatibles avec la mise en cache) et charge utile par publication ; estimation prudente des tokens |
| `src/config/models.ts` | Modèles candidats et tarifs **vérifiés le 2026-11-06** (voir `reports/models-pricing.md`) |
| `src/config/budget.ts` | Plafonds : 10 € absolu, 8 € opérationnel, 0,50 € d’essai, quota quotidien, tokens par requête |
| `src/budget/guard.ts` | Estimation maximale, réservation atomique, réconciliation, coût incertain, libération, réservations orphelines, journal |
| `src/budget/store.ts` | Registre en mémoire (verrou asynchrone) ou fichier JSON (verrou `mkdir`, écriture atomique, inter-processus) |
| `src/adapters/` | Interface commune, adaptateur simulé, adaptateurs Anthropic / OpenAI désactivés |
| `src/pipeline.ts` | Analyse d’une publication en **un seul appel** : politique → règle éditoriale → budget → appel → validation → règles de contenu → rubrique → suppression du résumé si exclue |
| `src/config/coverage.ts` | Couverture `mandatory` / `selective` par source (indépendante des scores IA) |
| `src/budget/factory.ts` | `createPersistentGuard()` : garde persistant (`var/`) à utiliser pour tout appel réel |
| `src/evaluation/summary-checks.ts` | Contrôles automatiques **indicatifs** des résumés (grille à 6 critères) |
| `review/phase-b-manual-review.template.json` | Fiche de revue manuelle des résultats de la phase B |
| `src/prefilter.ts` | Préfiltre déterministe en **observation** (désactivé), qui réutilise la grille du POC 1.2 |
| `fixtures/` | 30 publications réelles (métadonnées seules), 9 fixtures synthétiques, vérité terrain séparée |

### Dimensions indépendantes

- `relevance` (0–100) : pertinence personnelle.
- `novelty` (1–5) : importance de la nouveauté.
- `contentLevel` : disponibilité du contenu.

Une release Angular mineure peut avoir `relevance` 85 et `novelty` 1.

### `confidence`

Nombre réel de **0 à 1** produit par le modèle : sa confiance dans la classification. Les consignes demandent de l’abaisser quand seules les métadonnées sont fournies. C’est une auto-évaluation, pas une probabilité calibrée. Sa calibration (corrélation avec les erreurs mesurées contre la vérité terrain) fait partie de la phase B.

### Couverture obligatoire et rubriques

La couverture (`coveragePolicy`) est fixée **par la source**, jamais par les thématiques renvoyées par le modèle. Les huit canaux officiels (Angular Blog, angular/angular, angular/components, TypeScript Blog, OpenAI Agents SDK, LangGraph, MCP TS SDK, Claude Code) sont `mandatory` : leurs publications restent visibles quels que soient la pertinence, la nouveauté ou le motif d’exclusion proposé par le modèle. Elles restent visibles même si l’analyse échoue (budget, erreur), avec le statut « non analysée ». La pertinence n’est jamais forcée. La couverture obligatoire ne neutralise ni les politiques de contenu, ni les règles éditoriales déterministes, ni l’exclusion pour doublon.

- `updates` : releases (`novelty` ≤ 3) et nouveautés faibles des sources obligatoires, et compilations marquées (« Video Friday »).
- `main` : le reste, y compris les versions majeures (`novelty` ≥ 4).
- `excluded` : exclusion motivée (sources sélectives) ou règle éditoriale (« The Download »). La publication est conservée et récupérable, **sans résumé**.
- `pending` : publication non analysée (source bloquée, budget, erreur fournisseur, sortie invalide). Elle est conservée pour une analyse ultérieure.

### Budget

Chaque appel suit le même circuit :
1. L’estimation maximale ((borne haute d’entrée en octets + marge, plus sortie au plafond) × marge × taux) est **réservée** dans une transaction exclusive, avant l’appel.
2. Après l’appel, la réservation est **réconciliée** avec l’usage réel renvoyé par le fournisseur.
3. En cas d’erreur :
   - usage inconnu : le maximum est compté et l’entrée « incertaine » est persistée ; elle n’est jamais libérée, seule `resolveUncertain()` la solde, et un excédent devient une dette qui bloque les appels suivants ;
   - requête certainement non envoyée : la réservation est libérée sans frais.
4. Un tarif inconnu, un plafond dépassé ou une requête trop grande entraînent un **refus avant l’appel**.

La comptabilité interne reste une estimation : il faut aussi configurer des plafonds dans les consoles des fournisseurs.

### Résumés et appel unique

`summaryAllowed` (politique × niveau) et `summaryExpected` (résumé réellement utile) sont distincts. Une publication exclue n’a pas de résumé : la consigne l’interdit, et le pipeline supprime tout résumé produit malgré tout. Les limites de l’appel unique sont décrites dans `reports/summary-evaluation-grid.md`.

## Rapports

- `reports/models-pricing.md` : modèles candidats, tarifs et capacités vérifiés.
- `reports/content-policy.md` : politiques par source et restrictions non résolues.
- `reports/evaluation-readiness.md` : jeu d’évaluation, modes envoyés, coûts maximaux, mesure du préfiltre (généré).
- `reports/budget-scenarios.md` : scénarios budgétaires exécutés et projections (généré).
- `reports/phase-b3-final-test.md` : audit hors ligne de B.2 et préparation du test final B3 (jeu figé `fixtures/b3/`, règle de décision, phase B3 **inactive**). Comparaison : `npm run compare` (B.2) ou `npm run compare -- --phase=B3`.
- `reports/phase-b-security-audit.md` : audit de sécurité des dépenses (phase B.0), protections fournisseurs, prérequis et plan des smoke tests.
- `reports/budget-audit.md` : audit de la protection budgétaire, limites et protections à configurer chez les fournisseurs.
- `reports/evaluation-dataset-quality.md` : composition et cohérence du jeu d’évaluation (généré).
- `reports/summary-evaluation-grid.md` : grille d’évaluation des résumés et limites de l’appel unique.

## Limites connues (phase A)

- Aucune mesure de qualité réelle : c’est l’objet de la phase B.
- Toutes les sources réelles sont en `metadata-only` : pas de résumé réel possible tant que les droits ne sont pas vérifiés.
- La vérité terrain a été rédigée par l’assistant et doit être relue.
- Les formats de requête fournisseurs (unions avec `null`, `enum` entier) restent à confirmer par une première requête réelle.
- Le préfiltre importe un module du POC 1 par chemin relatif (`../../veille-feasibility/...`). C’est acceptable pour un POC ; un paquet partagé serait à envisager dans l’application finale.
