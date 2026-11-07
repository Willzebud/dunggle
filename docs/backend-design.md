# Conception du premier backend Dunggle

> Conception validée le 2026-11-07, corrections de l'utilisateur intégrées. Elle sert de référence pour les lots L0 à L9.
> Statut de l'implémentation : voir la [section 9](#9-plan-dimplémentation).

## 1. Principes

- **TypeScript modulaire** dans `apps/api`, sans framework (NestJS viendra avec l'API HTTP du dashboard).
- **Volume réel** : environ 15 publications par jour pour 17 sources, et **deux cycles par jour** au départ.
  - Un seul processus.
  - MongoDB sert de file d'attente, avec un statut par publication.
  - Ni microservice ni file de messages.
- **MongoDB 8 (Docker, instance autonome)** avec le driver officiel `mongodb`.
  - Aucune transaction multi-documents.
  - L'atomicité repose sur des index uniques et des écritures conditionnelles (*compare-and-set*).
- **GPT-6 Luna** comme modèle d'analyse ([décision B3](../pocs/ai-analysis/reports/phase-b3-final-test.md), § 8).
- **Reprise des POC par copie.** `apps/api` n'importe jamais `pocs/`, et un test le vérifie.
- **Aucun appel payant sans autorisation distincte.**
  - L'adaptateur simulé est utilisé par défaut.
  - Un appel réel exige trois conditions : un drapeau versionné, une clé dans `.env` et l'option `--real`.
- Les quotas de production sont conservés : 20 appels par jour, 500 par mois, 10 par exécution. Les plafonds aussi : 8 € opérationnels, 10 € absolus.

## 2. Modules (`apps/api/src`)

| Module | Responsabilité | Origine |
|---|---|---|
| `config/sources.ts` | Sources collectées (flux, API GitHub, stratégie d'identifiant) | POC 1 `sources.config.ts` |
| `config/content-policies.ts` | Politique de droits par source (`full-allowed`, `excerpt-only`, `metadata-only`, `blocked`), validée | POC 2 |
| `config/coverage.ts` | Couverture obligatoire ou sélective, fixée par la source | POC 2 |
| `config/limits.ts` | Plafonds budgétaires, quotas de production, délai entre appels, estimation des tokens (figés) | POC 2 `config/budget.ts`, `config/quotas.ts` (production seulement) |
| `config/model.ts` | GPT-6 Luna : identifiant, tarifs, date de vérification | POC 2 `config/models.ts` |
| `collection/` | HTTP poli et `robots.txt`, flux RSS/Atom, GitHub Releases, URL normalisée (`dedupKey`), identifiants stables, niveau de contenu, règles éditoriales | POC 1 |
| `analysis/` | Taxonomie, schéma, prompt, résolution de l'entrée selon les droits (`resolveInput`), règles de contenu, rubrique | POC 2 |
| `budget/` | Garde budgétaire, quotas, temporisation, journal d'usage, masquage des secrets | POC 2, sans les phases d'essai |
| `storage/` (L4) | Connexion MongoDB, index, dépôts, stockage du registre budgétaire, verrou | nouveau |
| `pipeline/` (L5-L6) | Ingestion et doublons, sélection des analyses en attente, cycle | POC 2 `quota/pending.ts`, puis nouveau |
| `cli/` (L8) | `cycle` (simulation par défaut), `status`, `reconcile`, `requeue` | nouveau |

La configuration des sources reste dans le code : versionnée, relue et validée par les tests. Chaque source a une entrée de droits, sa couverture et sa configuration de collecte. L'empreinte de cette configuration (`sourceConfigVersion`) est enregistrée avec chaque publication et chaque analyse.

## 3. Modèle de données MongoDB (L4)

**`publications`** : une par publication et par source.
- `_id` : identifiant stable du POC 1 (identifiant natif, ou URL normalisée en cas de collision).
- Champs d'identification : `sourceId`, `nativeId`, `idBasis`, `url` (URL originale exacte, jamais modifiée), `dedupKey`.
- Métadonnées : `title`, `publishedAt`, `author`, `categories`, `contentLevel`.
- `text` : seulement ce que la politique autorise. Rien en `metadata-only`, 400 caractères au plus en `excerpt-only`, 6 000 en `full-allowed`.
- `hashes.allowedContent` et `hashes.analysisInput` (voir § 4).
- `rights` : `{ policy, termsStatus, sourceConfigVersion }`, instantané au moment de la collecte.
- Classement : `coverage`, `editorial`, `canonical`, `duplicateOf`.
- `status` : `pending` | `analyzed` | `failed` | `duplicate` | `excluded-editorial` | `blocked` | `expired`.
- Résultat : `section`, `currentAnalysisId`.
- Suivi des essais : `attempts { count, lastError, nextEligibleAt }`.
- Historique : `revision`, `firstSeenAt`, `lastSeenAt`, `provenance { runId, feedUrl, collectedAt }`, `lastWriteToken`.
- Index :
  - `dedupKey` unique et partiel sur `canonical: true` ;
  - `{ status, coverage, publishedAt: -1 }` ;
  - `{ sourceId, publishedAt: -1 }` ;
  - `{ section, publishedAt: -1 }`.

**`publication_revisions`** : en ajout seul.
- Champs : `{ publicationId, revision, title, hashes, changed, detectedAt, runId }`.
- Index unique `{ publicationId, revision }`.

**`analyses`** : en ajout seul, jamais écrasées.
- `analysisKey` (unique) : `publicationId|modelKey|promptVersion|analysisInput#attempt`.
- Traçabilité :
  - `model { key, provider, apiModelId }` ;
  - `promptVersion`, `schemaVersion`, `taxonomyVersion`, `sourceConfigVersion`, `appVersion` ;
  - `input { mode, policy, termsStatus, contentLevel, chars, coverage }`.
- Résultat :
  - `status` ;
  - `output` (validé) ;
  - `section`, `violations` ;
  - coût : `usage`, `costEur`, `costUncertain`, `stopReason`, `latencyMs` ;
  - liens : `reservationId`, `runId`, `supersedes`.
- `diagnostic` (sortie brute rejetée, résumé supprimé) : jamais exposé par une API.
- Index : `{ publicationId, createdAt: -1 }`, `{ runId }`.

**Autres collections :**
- **`budget_ledger`** : un seul document `_id: 'operational'`. Il contient l'état du registre, un compteur de révision `rev` et le dernier jeton de verrou accepté `fence` (§ 6). La fonction `transaction(fn)` lit le document, applique `fn`, puis fait `replaceOne({ _id, rev })`, en recommençant en cas de conflit.
- **`usage_events`** : journal d'usage, en ajout seul, masqué.
- **`provider_pacing`** : un document par fournisseur.
- **`runs`** : compteurs, coût et erreurs de chaque cycle.
- **`locks`** : `{ _id: 'cycle', owner, token, expiresAt }`.

## 4. Empreintes et mises à jour (correction 1)

Les empreintes ne sont calculées **qu'à partir des données dont la politique de la source autorise le traitement**. Aucun texte supplémentaire n'est récupéré pour calculer une empreinte.

| Politique | Données prises en compte dans `allowedContent` |
|---|---|
| `metadata-only` | titre, URL, date, catégories (rien d'autre, même si le flux contient du texte) |
| `excerpt-only` | métadonnées et extrait borné (400 caractères) |
| `full-allowed` | métadonnées et texte borné (6 000 caractères) |
| `blocked` | aucune empreinte de contenu ; identifiant et URL seulement |

- `analysisInput` est l'empreinte du message exact envoyé au modèle (version du prompt comprise).
- Si `allowedContent` change, une nouvelle révision est créée.
- Si `analysisInput` change, la publication repasse en attente pour une nouvelle analyse, comptée dans les quotas. L'ancienne analyse est conservée.
- Si rien ne change, il n'y a aucun appel.

## 5. Cycle de collecte et d'analyse (L5-L6)

**0. Démarrage**
- Prendre le verrou avec bail (§ 6).
- Contrôler l'intégrité du registre.
- Rapprocher les réservations orphelines (§ 7).

**1-2. Collecte et normalisation**
- Les sources une par une, avec une pause polie entre elles et contrôle de `robots.txt`.
- Identifiant stable, `dedupKey`, niveau de contenu, règles éditoriales.
- Une source en erreur est consignée sans arrêter le cycle.

**3. Ingestion idempotente** (`insertOne` ; un conflit de clé est traité comme une publication existante). Statut initial :
- `blocked` si la source est bloquée ;
- `excluded-editorial` si une règle éditoriale l'exclut ;
- `duplicate` si l'URL normalisée est déjà canonique pour une autre source (`duplicateOf`, provenance conservée) ;
- `pending` sinon.

**4. Sélection** :
- les publications de plus de 14 jours passent en `expired` (couverture obligatoire : rubrique `updates`) ;
- tri : couverture obligatoire, puis les plus récentes ;
- limite = le plus petit de : quota par exécution, quota du jour restant, 100 en attente au maximum.

**5. Analyse**, une publication à la fois :
1. Délai de 75 s après la fin de la requête précédente.
2. `reserve` (un refus de quota ou de budget arrête la boucle).
3. Appel à Luna.
4. `validateAnalysis` (sans correction).
5. `enforceContentRules` et `computeSection`.
6. `reconcile`.
7. Insertion de l'analyse.
8. Mise à jour de la publication.
9. `recordResult`.

**6. Clôture**
- Écrire le document `runs`.
- Libérer le verrou.

## 6. Verrou renouvelable et protection contre un ancien propriétaire (correction 4)

**Acquisition et bail :**
- Pour acquérir le verrou : `findOneAndUpdate` sur `{ _id: 'cycle', expiresAt < now }` (ou insertion si le document est absent), avec `owner = runId` et `token + 1`. Le jeton est **strictement croissant**.
- Pour renouveler le bail : mise à jour conditionnée par `{ owner, token }`, toutes les 5 minutes, pour un bail de 15 minutes. Si le renouvellement échoue, le cycle s'arrête avant toute nouvelle réservation.

**Protection contre un ancien propriétaire** (jeton de garde, *fencing token*). Un ancien propriétaire dont le bail a expiré ne peut plus rien écrire :
- **Registre budgétaire :** chaque transaction exige `token >= ledger.fence` et enregistre `fence = token`. Une écriture portant un jeton plus ancien est refusée : aucune réservation ni réconciliation par un processus périmé.
- **Publications :** chaque mise à jour est conditionnée par `lastWriteToken <= token`.
- **Analyses :** insertion seule, avec `analysisKey` unique.
- **Runs et journal d'usage :** ajout seul. Chaque entrée porte le jeton de son auteur.

## 7. Facturation incertaine et arrêts brutaux (corrections 2 et 3)

Une erreur n'est considérée comme **non facturée** que si l'absence d'envoi ou de traitement est **certaine**. Dans le doute, la réservation est conservée en « coût incertain », compté au maximum, et **toute nouvelle dépense est bloquée** jusqu'au rapprochement manuel (`cli/reconcile`).

| Erreur | Coût | Traitement |
|---|---|---|
| Refus avant envoi (garde, clé absente, verrou perdu, arrêt demandé) | 0, certain | Réservation libérée ; non comptée comme tentative transmise |
| HTTP 4xx (401, 403, 400, 429) | 0, certain : le fournisseur a refusé sans traiter | Réservation libérée, tentative transmise comptée dans les quotas. 429 : boucle arrêtée, nouvel essai au cycle suivant. Au plus **2 tentatives**, puis `failed` |
| HTTP 5xx, délai dépassé, coupure réseau, réponse sans usage | **Incertain** | Coût incertain : dépenses bloquées jusqu'au rapprochement. Aucun nouvel essai automatique |
| Sortie invalide ou tronquée | Connu (facturé) | Réconciliation ; analyse `invalid-output` avec diagnostic. Aucune relance automatique (`cli/requeue`) |

**Points d'arrêt brutal.** Chaque scénario aura son test (L4 : stockage, L6 : cycle).

| # | Arrêt entre… | État laissé | Reprise au cycle suivant |
|---|---|---|---|
| A1 | réservation et envoi | Réservation ouverte, entrée d'idempotence en cours, aucune analyse | L'envoi n'est pas prouvé absent : la réservation orpheline passe en **coût incertain**, et les dépenses sont bloquées jusqu'au rapprochement |
| A2 | envoi et réponse | Idem A1 (facturation possible) | **Coût incertain**, dépenses bloquées |
| A3 | réponse et réconciliation | Idem, usage connu seulement en mémoire et donc perdu | **Coût incertain** ; le rapprochement manuel s'appuie sur la console du fournisseur |
| A4 | réconciliation et insertion de l'analyse | Coût réconcilié, entrée d'idempotence en cours, aucune analyse | Pas de nouvel appel (clé déjà prise). Publication marquée `failed` (« analyse perdue après facturation »), puis `cli/requeue` explicite (tentative suivante) |
| A5 | insertion de l'analyse et mise à jour de la publication | Analyse enregistrée, publication en attente | Réparation sans appel : la publication est rattachée à la dernière analyse pour cette `analysisKey` |
| A6 | mise à jour de la publication et `recordResult` | Tout est enregistré sauf l'état « terminé » dans le registre | Réparation sans appel : l'entrée est passée à « terminé » à partir de l'analyse enregistrée |
| A7 | écriture du registre et journal d'usage | Registre à jour, événement d'usage manquant | Le registre fait foi pour le budget ; l'événement manquant est reconstitué et marqué « reconstitué » |

Le registre budgétaire est la **seule source de vérité pour l'argent**. Le journal d'usage sert à l'audit et ne déclenche jamais de dépense.

## 8. Prompt, schéma et règles de contenu validés en B3 (correction 5)

- `SYSTEM_PROMPT`, `ANALYSIS_JSON_SCHEMA`, la taxonomie, `buildPrompt`, `validateAnalysis`, `enforceContentRules` et `computeSection` sont **copiés à l'identique** du POC 2.
- Des tests de référence figent :
  - `PROMPT_VERSION === 'bc786201b88a'` ;
  - l'empreinte du prompt système et celle du schéma ;
  - le message produit pour des publications types ;
  - le comportement des règles (résumé interdit, extrait dépassé, chiffre ou URL absents de la source, fuite du prompt système).
- **Toute évolution** suit ces étapes :
  1. une décision explicite ;
  2. la mise à jour des valeurs de référence dans le même commit ;
  3. une nouvelle version du prompt, ce qui change la clé d'idempotence : aucun écrasement silencieux ;
  4. une mention dans ce document.

## 9. Plan d'implémentation

| Lot | Contenu | Statut |
|---|---|---|
| L0 | Squelette `apps/api`, test d'indépendance vis-à-vis de `pocs/` | fait |
| L1 | Analyse : taxonomie, schéma, prompt, politiques de droits, couverture, règles, tests de référence | fait |
| L2 | Collecte : HTTP, flux, GitHub, normalisation, règles éditoriales, configuration des sources, tests hors ligne | fait |
| L3 | Budget : garde (périmètre opérationnel seul), quotas, temporisation, journal d'usage, tests | autorisé |
| L4 | `mongodb` : connexion, index, dépôts, stockage du registre (écriture conditionnelle et jeton de garde), verrou ; tests d'intégration ; scénarios A1 à A7 côté stockage | à valider |
| L5 | Ingestion : doublons, révisions, empreintes autorisées | à faire |
| L6 | Cycle complet avec l'adaptateur simulé ; scénarios d'erreur et d'arrêt brutal | à faire |
| L7 | Adaptateur OpenAI copié et verrouillé (`REAL_CALLS_ENABLED = false`) | à faire |
| L8 | Commandes en ligne et documentation d'exploitation | à faire |
| L9 | Premier cycle réel, **sur autorisation distincte** (plafond fixé par l'utilisateur, tarifs revérifiés) | à autoriser |

## 10. Hors périmètre de la V1

- Extraction de pages (Readability) : toutes les sources réelles sont en `metadata-only`.
- Doublons par similarité de titre : signalement envisagé plus tard. La V1 se limite à l'URL normalisée exacte.
- API HTTP, NestJS et dashboard Angular.
- Réévaluation du délai de 75 s et des quotas, une fois les limites du projet OpenAI de production connues.
