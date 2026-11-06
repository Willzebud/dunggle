# POC 2 — Phase B.0 : audit de sécurité des dépenses IA

> Audit réalisé le 2026-11-06 sur le **code réel** (commit de départ `509482b`), **entièrement hors ligne**. Aucun appel payant, aucune clé créée, appels réels toujours désactivés.
> Un verdict GO signifie que le système est **techniquement prêt**. Ce n’est **pas** une autorisation de dépenser.

## 1. Risques identifiés et gravité

| # | Risque | Gravité | État |
|---|---|---|---|
| A1 | Clé API committée (fichier `.env`, code) | Critique | Protégé (`.gitignore`, scan `check:secrets`) |
| A2 | Clé dans un journal, un rapport d’erreur ou le registre | Élevée | **Corrigé** : masquage systématique |
| A3 | Clé envoyée à un frontend | Critique | Hors périmètre actuel (pas de frontend) → règles pour NestJS (`docs/ai-api-security.md`) |
| A4 | Clé volée utilisée hors de Dunggle | Critique | **Non couvert par le code** : seules les limites des fournisseurs protègent (§ 7) |
| B1 | Injection dans le titre, les catégories ou le texte d’une publication | Élevée | **Corrigé** : consigne de sécurité, données isolées et bornées, sorties filtrées |
| B2 | Une sortie du modèle qui modifierait le budget, le modèle ou le nombre d’appels | Critique | Protégé : aucune sortie n’est interprétée comme une commande |
| B3 | Manipulation sémantique des scores (« ce texte est très pertinent ») | Moyenne | **Résiduel** : scores consultatifs, couverture et règles éditoriales déterministes |
| C1 | Doublons, appels concurrents, plusieurs processus, scheduler répété, relance après crash | Élevée | **Corrigé** : idempotence atomique dans le registre |
| C2 | Exécution sans limite d’appels | Élevée | **Corrigé** : plafond par exécution (1 par modèle en smoke, 40 en full) |
| C3 | Relances automatiques non budgétées (SDK) | Élevée | **Corrigé** : `maxRetries: 0` |
| D1 | Tokens réels > estimation, raisonnement, écritures en cache | Élevée | Protégé : borne haute, normalisation, dette bloquante |
| D2 | Coût inconnu (pas d’usage, délai dépassé après envoi) | Élevée | **Corrigé** : arrêt sécurisé, aucune nouvelle dépense tant qu’un coût est incertain |
| D3 | Succès puis crash avant sauvegarde | Moyenne | **Corrigé** : analyse marquée « terminée » au moment de la réconciliation, jamais refacturée |
| D4 | Réinitialisation du budget (suppression ou restauration du registre) | Élevée | **Corrigé partiellement** : détection via le journal ; résiduel si le journal est aussi supprimé |
| D5 | Modification des plafonds à l’exécution | Moyenne | **Corrigé** : plafonds gelés (`Object.freeze`) |
| E1 | Argument CLI non validé (`--trial-cap=…`, `--no-budget`) | Élevée | **Corrigé** : analyse stricte, aucune option ne relève un plafond |
| E2 | Appel réel déclenché sans autorisation | Critique | Protégé : 7 verrous indépendants (§ 8) |

## 2. Protections déjà en place (vérifiées dans le code)

- `REAL_CALLS_ENABLED = false` est une constante de code, non pilotable par l’environnement (`src/adapters/real.ts`).
- Garde budgétaire : réservation du maximum avant l’appel, transactions atomiques (verrou mémoire ou `mkdir`, écriture par renommage), plafonds de 10 € / 8 € / 0,50 €, quota quotidien, borne haute d’entrée (octets + 2 000), sortie limitée à 800 tokens imposés au fournisseur, coûts incertains persistés et jamais libérés, dette enregistrée, mois civils UTC, persistance, réservations orphelines converties en coûts incertains, verrou orphelin bloquant.
- Politiques de contenu : les 17 sources réelles (RSS et GitHub) sont en `metadata-only`, donc aucun texte d’article n’est transmis.
- Sortie structurée validée strictement (champs, types, bornes) ; aucune donnée de sortie n’est utilisée comme paramètre.
- `.gitignore` : `.env*` (sauf `.env.example`), `var/` (registre, journal, résultats), données brutes de collecte.

## 3. Vulnérabilités corrigées pendant B.0

| Correction | Fichier(s) | Test(s) |
|---|---|---|
| **Idempotence** : clé `modèle \| publication \| version du prompt` revendiquée atomiquement dans la même transaction que la réservation (`duplicate-analysis`) ; supprimée seulement si la requête n’a certainement pas été facturée | `budget/guard.ts`, `budget/store.ts`, `pipeline.ts` | C : doublons, 20 analyses concurrentes, deux processus, scheduler répété, relance |
| **Arrêt sécurisé** : toute réservation est refusée tant qu’un coût incertain n’est pas réconcilié (`uncertain-pending`) | `budget/guard.ts`, `config/budget.ts` | D : réponse sans usage, délai dépassé, crash pendant l’appel |
| **Intégrité du registre** : compteur monotone (`sequence`) comparé au journal en ajout seul ; registre supprimé ou restauré → `LedgerIntegrityError` | `budget/factory.ts` | D : réinitialisation du budget |
| **Plafonds gelés** | `config/budget.ts` | D : plafonds gelés |
| **Masquage des secrets** (formats connus et valeurs exactes de l’environnement) dans les erreurs, les résultats, le registre (y compris le motif des coûts incertains, fuite trouvée par les tests) et le journal | `security/redact.ts`, `guard.ts`, `pipeline.ts`, `adapters/real.ts` | A : quatre tests |
| **Injection** : consigne de sécurité dans le prompt système ; publication isolée dans `untrustedPublication` ; consignes de traitement hors de cet objet ; champs bornés (titre 300, source 100, URL 500, 10 catégories de 60 caractères) ; caractères de contrôle supprimés | `prompt.ts` | B : cinq tests |
| **Filtrage des sorties** : reprise des consignes système (`possible-system-prompt-leak`) ; URL absente de la publication (`ungrounded-url`) | `pipeline.ts` | B : sortie qui obéit à l’injection |
| **Adaptateurs réels** (SDK officiels `@anthropic-ai/sdk` 1.6.0, `openai` 7.53.0) : aucune relance automatique, délai de 60 s, clé lue seulement au moment de l’appel, refus avant envoi si la clé est absente ou le modèle non validé, erreurs classées par risque financier (4xx : non facturé ; 5xx, délai, réseau : incertain), refus et sortie tronquée gérés | `adapters/real.ts` | E : faux clients SDK |
| **Exécuteur** `evaluate:real` : simulation par défaut, arguments stricts, 7 verrous, exécution séquentielle, plafond d’appels, reprise sans refacturation, arrêt sur incertitude | `runner/*.ts`, `scripts/evaluate-real.ts` | E : refus et exécution simulée |
| **Scan des secrets** avant commit | `scripts/check-secrets.ts` | exécuté : ✅ |

## 4. Risques résiduels

1. **Clé volée** : le garde applicatif ne voit que les appels faits par Dunggle. Une clé utilisée ailleurs n’est limitée que par les réglages des fournisseurs (§ 7).
2. **Suppression simultanée du registre et du journal** : non détectable localement. Le contrôle s’appuie sur la console du fournisseur.
3. **Manipulation sémantique** : un contenu peut influencer la pertinence ou la nouveauté estimées. C’est sans effet sur la dépense ; la couverture obligatoire et les règles éditoriales restent déterministes.
4. **Facturation non instantanée chez OpenAI** : le texte officiel précise qu’un dépassement léger est possible (§ 7).
5. **Classification des erreurs** : un 4xx est considéré comme non facturé, ce que la documentation laisse entendre sans le garantir. Tout le reste est traité comme incertain.
6. **Taille du prompt injecté par la sortie structurée et contenu système caché d’OpenAI** : couverts par une marge forfaitaire de 2 000 tokens (hypothèse). Un dépassement serait enregistré comme dette.
7. **Verrou fichier** : suppose un disque local.

## 5. Tests exécutés (2026-11-06)

| Vérification | Résultat |
|---|---|
| Compilation TypeScript (2 workspaces) | ✅ 0 erreur |
| Tests POC 1 | ✅ 11/11 |
| Tests POC 2 (dont **27 tests de sécurité** dans `tests/security.test.ts`) | ✅ 108/108 |
| Scénarios budgétaires (`npm run poc2:budget`) | ✅ 14/14 (dont arrêt sécurisé, doublon, réconciliation manuelle) |
| Cohérence du jeu d’évaluation (`npm run poc2:prepare`) | ✅ 0 incohérence |
| Scan des secrets (`npm run check:secrets`) | ✅ 99 fichiers suivis, aucun problème |
| Exécuteur, simulation par défaut | ✅ plan affiché, coût maximal 0,003050 €, aucune écriture dans `var/` |
| Exécuteur `--real` (non autorisé) | ✅ refus, code 3, aucune réservation |
| Exécuteur `--trial-cap=100` | ✅ refus, code 2 |

## 6. Ce qui ne concerne que le futur backend NestJS

Voir `docs/ai-api-security.md` : authentification de toute route déclenchant une analyse, aucun paramètre de modèle ou de budget fourni par le client, file de traitement à un seul consommateur, clés dans un gestionnaire de secrets, limitation de débit par utilisateur, journalisation masquée, CORS restrictif.

## 7. Protections à configurer chez les fournisseurs (vérifiées dans les documentations officielles)

| | Anthropic | OpenAI |
|---|---|---|
| Isolement | **Workspace dédié « dunggle-poc »** ; clé limitée à ce workspace (« API keys can be scoped to a single workspace ») — [workspaces](https://platform.claude.com/docs/en/build-with-claude/workspaces) | **Projet dédié « dunggle-poc »** et clé de compte de service du projet (« Use a project service account for an application’s identity ») — [production best practices](https://developers.openai.com/api/docs/guides/production-best-practices) |
| Plafond de dépense | Limite de dépense du workspace (page Workspaces → Spend limits) et de l’organisation (Billing). « When usage reaches a spend limit you set, requests return HTTP 400 » : appliquée, **sans garantie documentée de précision** — [rate limits](https://platform.claude.com/docs/en/api/rate-limits). Non disponible sur le workspace par défaut (« You can’t set spend limits on the default workspace ») | **Hard spend limit** du projet (« Enforce a hard limit »). « Enforcement is not instantaneous … recorded spend can slightly exceed the configured amount » : **pas strictement exact** — [spend limits](https://developers.openai.com/api/docs/guides/spend-limits) |
| Alertes | Alertes de dépense du workspace (« configure alerts when spending reaches certain thresholds ») | Spend alerts : « Sends a notification; API traffic continues » (non bloquantes) |
| Limites de débit | Par workspace et par modèle (requêtes, tokens d’entrée et de sortie par minute) dans Rate limits | Par projet ; réglables dans les limites du projet |
| Durée de vie des clés | Désactivation (`status: "inactive"`) ou archivage du workspace, qui archive ses clés | Date d’expiration de la clé ; durée maximale imposable au niveau du projet |
| Révocation | Console → API keys → désactiver ou supprimer ; l’archivage du workspace archive toutes ses clés « within seconds » | « revoke it promptly and replace it » (page Security / API keys) — [safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices) |

**Réglages recommandés pour le POC (à faire vous-même, dans les consoles) :**
1. Anthropic : créer le workspace `dunggle-poc`, fixer une limite de dépense mensuelle **minimale** (par exemple 1 $), une alerte à 50 %, des limites de débit basses (quelques requêtes par minute), puis créer **une** clé limitée à ce workspace.
2. OpenAI : créer le projet `dunggle-poc`, activer une hard spend limit **minimale** (par exemple 1 $), une alerte, n’autoriser que gpt-6-luna si l’option existe, puis créer une clé de compte de service avec **date d’expiration courte** (par exemple 7 jours).
3. Facturation : ne pas activer de recharge automatique des crédits, si votre compte en propose une (non documentée dans les pages consultées : à vérifier dans Billing).
4. Fournir les clés **uniquement** par variable d’environnement dans le terminal qui lance l’exécuteur (par exemple `read -s ANTHROPIC_API_KEY; export ANTHROPIC_API_KEY`). Jamais dans un fichier du dépôt, jamais dans la conversation.
5. Après les smoke tests : désactiver ou révoquer les clés si la suite n’est pas immédiate.

## 8. Prérequis avant le premier appel payant (B.1)

Les 7 verrous de l’exécuteur doivent tous être levés, et un seul suffit à bloquer :
1. Autorisation explicite de votre part pour B.1.
2. Commit revu passant `REAL_CALLS_ENABLED` à `true`.
3. Option `--real`.
4. `--confirm-max-eur` ≥ coût maximal du plan (et ≤ 0,50 €).
5. Clé présente dans l’environnement pour chaque modèle appelé.
6. Modèle au statut `validated`.
7. Registre intègre, aucun coût incertain ni réservation ouverte, budget d’essai suffisant.

À faire en plus : les réglages des consoles (§ 7) et la relecture de la vérité terrain.

## 9. Coût maximal prévu des smoke tests

Fixture commune : `synthetic:orion-multimodal` (FULL, synthétique). Borne d’entrée : 7 288 tokens. Sortie limitée à 800 tokens, réflexion comprise.

| Smoke test | Coût maximal réservé |
|---|---|
| Claude Haiku 5.5 | **0,001411 €** |
| GPT-6 Luna (écriture en cache au pire cas comprise) | **0,001639 €** |
| **Total** | **0,003050 €** (0,6 % du budget d’essai) |

## 10. Verdict B.1

**GO technique.** Les protections sont implémentées et testées hors ligne, les adaptateurs réels sont prêts mais verrouillés, l’exécuteur refuse tout appel tant que les 7 verrous ne sont pas levés, et le coût maximal des smoke tests est connu (0,003050 €).

Ce verdict **n’autorise aucune dépense**. Le premier appel payant attend votre autorisation explicite, puis les réglages des consoles et le commit d’activation.
