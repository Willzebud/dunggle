# POC 2 — Préparation de B.2

> État au 2026-11-06, après B.1 (deux smoke tests réussis, 0,000854 € dépensés). **Aucun appel B.2 effectué.** Complète `phase-b1-readiness.md`.

## 1. Corrections depuis B.1

- **Affirmations interdites** (`containsClaim`, `src/evaluation/summary-checks.ts`) : la recherche est désormais sensible à la casse et bornée par des frontières de mots Unicode. « MIT » n’est plus détecté dans « limites ». Les espaces insécables sont acceptés et la ponctuation reste littérale.
- **Activation par phase** (`ACTIVATION_TTL_MS_BY_PHASE`) : 30 minutes pour B.1, 90 minutes pour B.2. Le plafond absolu est de 90 minutes. L’activation reste en mémoire et à usage unique, et l’autorisation locale expire toujours en 15 minutes. Si la durée estimée, avec une marge de 25 %, dépasse la validité restante, l’exécution est refusée avant tout appel.
- **Ordre alterné des appels** (H, L, H, L…) : les appels Anthropic s’intercalent pendant l’attente imposée par OpenAI (61 s entre deux requêtes). Une interruption laisse les deux modèles à un avancement comparable.
- **Interruption propre** : un premier Ctrl+C termine l’appel en cours puis arrête l’exécution avant la réservation suivante, sans laisser de réservation ouverte. La reprise ne planifie que le reste, avec une nouvelle autorisation. Un second Ctrl+C arrête immédiatement : la réservation éventuellement ouverte bloque alors toute nouvelle exécution jusqu’à sa réconciliation manuelle.
- **Mesure des durées** : durée de chaque appel et de l’exécution enregistrée dans le fichier de résultats.
- **Comparaison** (`npm run poc2:compare`, hors ligne) : indicateurs et grille de revue humaine à l’aveugle, écrits dans `var/` (non versionné).

## 2. Plan B.2 (simulation sur le registre réel)

| Élément | Valeur |
|---|---|
| Publications éligibles | 37 sur 39 (exclues : source bloquée synthétique, digest « The Download ») |
| Modèles | `anthropic-haiku-5-5`, `openai-gpt-6-luna` (validés) |
| Déjà analysée en B.1 | `synthetic:orion-multimodal`, écartée pour les deux modèles (« déjà completed, non refacturé ») |
| **Appels prévus** | **72** (36 par modèle), quota B.2 : 74 (37 par modèle) |
| **Coût maximal réservé** | **0,103718 €** |
| Bornes | entrée ≤ 16 000 tokens par requête (plan : 6 507 à 7 648), sortie ≤ 800 tokens |
| **Durée estimée** | **≈ 36 min** en régime typique ; 72 min si chaque appel atteignait le délai maximal de 60 s |
| Activation B.2 | 90 min |
| Budget | 0,50 € au total, 0,000854 € dépensés ; après B.2, au moins **0,395428 €** restants |

Protections inchangées :
- quotas cumulatifs ;
- budget réservé avant chaque appel ;
- aucune relance automatique (SDK `maxRetries: 0`) ;
- arrêt sur coût incertain, refus budgétaire, quota atteint ou erreur 4xx ;
- clés au bon format pour chaque fournisseur ;
- résultats dans `var/`.

## 3. Indicateurs de comparaison

Module : `src/evaluation/compare.ts`.

| Indicateur | Définition |
|---|---|
| Conservation et exclusion | Précision et rappel par classe sur les décisions `must_keep` et `must_exclude`. Les décisions `ambiguous` sont rapportées à part. Une publication non analysée compte comme échec dans les rappels. |
| Couverture obligatoire | Publications des 8 canaux officiels visibles (« main » ou « updates »), et liste des manquantes |
| Thèmes | Correspondance exacte (thèmes tolérés inclus), précision et rappel micro |
| Sous-thèmes | Distribution seulement : la vérité de référence n’en contient pas, donc revue humaine |
| Types | Type acceptable, type principal, et liste des écarts |
| Pertinence et nouveauté | Proportion dans la bande ou l’intervalle attendu, écart moyen |
| Rubriques | Rubrique produite contenue dans les rubriques attendues |
| Résumés | Résumés produits sur résumés attendus ; résumés interdits (contrôle fiable) ; contrôles indicatifs par critère |
| Coûts | Coût total, coût moyen par publication analysée, projection mensuelle à 390 publications (volume estimé au POC 1.2) et à 500 (quota de production), tokens moyens |
| Durées et erreurs | Durée moyenne, médiane et p95 par appel ; statuts et erreurs |

Les thèmes, types, pertinence et nouveauté sont évalués sur les publications `must_keep` conservées.

## 4. Revue humaine

`npm run poc2:compare` produit `var/review/summary-review.blind.json`.
- Pour chaque publication, les résumés sont présentés sous les étiquettes A et B, tirées au hasard.
- Les 6 critères sont notés de 0 à 2, avec une préférence globale.
- La correspondance entre étiquettes et modèles est dans un fichier séparé (`summary-review.key.json`), à n’ouvrir qu’après la revue.
- Une grille déjà commencée n’est jamais écrasée.

Seules les fixtures synthétiques FULL ont un texte à résumer : les sources réelles sont en métadonnées seules.

## 5. Décisions en attente

Voir `editorial-types-proposal.md` : règle de typage, réordonnancement d’OrionVision, ambiguïtés A à F, et prompt avec ou sans définitions des types.

## 6. Risques résiduels

- Avec un seul passage par modèle, les écarts faibles ne sont pas significatifs, surtout sur 9 fixtures synthétiques.
- Les sources réelles sont en métadonnées seules : la qualité des résumés n’est mesurée que sur les fixtures synthétiques.
- Un 429 ou un 4xx arrête l’exécution. Le quota B.2 restant après une reprise est de 2 appels au-delà du plan.
- Une sortie tronquée à 800 tokens serait facturée et invalide. En B.1, les sorties ont été de 523 et 412 tokens, sur des textes plus longs que les métadonnées.
- Les plafonds des fournisseurs (1 $ par mois) restent la protection contre une clé volée. Celui d’OpenAI peut être légèrement dépassé.
