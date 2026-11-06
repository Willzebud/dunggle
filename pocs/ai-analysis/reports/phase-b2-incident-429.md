# B.2 — Incident HTTP 429 et préparation de la reprise

> 2026-11-06. B.2 a été arrêté après 6 appels (5 analyses réussies, 1 refus 429 de Luna). Ce document couvre le diagnostic hors ligne, la nouvelle temporisation, l’exception de quota et le plan de reprise. **Aucun appel réel n’a été effectué depuis l’incident.**

## 1. Diagnostic (données locales uniquement)

**Message du fournisseur** (identifiants de projet et d’organisation masqués ici) :

> 429 Rate limit reached for gpt-6-luna in project … organization … on requests per min (RPM): Limit 1, Used 1, Requested 1. Please try again in 1m0s.

**En-têtes de limitation :** aucun n’a été conservé. L’ancien code ne gardait que le message de l’erreur SDK. L’identifiant de requête et les en-têtes `x-ratelimit-*` ne sont donc pas disponibles.

**Chronologie des requêtes Luna** (journal `usage-log.jsonl` : la réservation précède l’envoi de quelques millisecondes, la réconciliation ou la libération suit la réponse) :

| Requête | Départ (réservation) | Fin | Durée | Écart depuis le départ précédent | Écart depuis la fin précédente |
|---|---|---|---|---|---|
| Luna 1 | 20:00:21.481 | 20:00:25.596 | 4,1 s | — | — |
| Luna 2 | 20:01:22.486 | 20:01:28.739 | 6,3 s | 61,0 s | 56,9 s |
| Luna 3 (429) | 20:02:23.491 | 20:02:24.248 | 0,8 s | 61,0 s | **54,8 s** |

**Tokens :** 1 342 et 1 336 tokens en entrée pour les deux requêtes réussies. Le message cite explicitement la limite de **requêtes** par minute (RPM), pas celle de tokens par minute (TPM).

**Ce que les données établissent :**
- le programme a bien respecté son intervalle de 61 s entre deux **départs** ;
- une seule requête Luna est partie dans chaque fenêtre de 60 s mesurée côté client à partir des départs ;
- OpenAI a pourtant compté une requête dans la fenêtre courante (« Used 1 »).

**Causes possibles** (aucune n’est prouvée par les données disponibles) :
1. **Requête comptée à sa fin, ou à son arrivée côté serveur.** Mesurée depuis la fin de Luna 2, Luna 3 arrive 54,8 s plus tard, donc moins de 60 s. C’est compatible avec le refus.
2. **Délai réseau variable.** Luna 2 a pu atteindre le serveur plus tard que sa réservation locale, et Luna 3 plus tôt (elle a échoué en 0,8 s). L’écart vu par le serveur aurait alors été inférieur à 60 s. La marge de 1 s était faible.
3. **Fenêtre ou découpage de la limite** côté fournisseur, différent d’une fenêtre glissante exacte de 60 s.
4. **Autre utilisation du même projet** pendant la minute concernée (tableau de bord, autre outil). Les données locales ne permettent pas de l’exclure : à vérifier dans le tableau de bord d’OpenAI.

**Causes écartées :**
- **Relance cachée** : le SDK est configuré avec `maxRetries: 0`, et une seule réservation a été faite par appel.
- **Dépassement de tokens** : le message vise les requêtes (RPM), et les volumes sont faibles.

## 2. Temporisation renforcée

| Règle | Implémentation |
|---|---|
| ≥ 75 s après la **fin** de la dernière requête OpenAI, réussie ou en erreur | `PROVIDER_MIN_GAP_AFTER_END_MS.openai = 75 000`. La fin est notée dans un bloc `finally`. |
| `Retry-After`, `retry-after-ms`, `x-ratelimit-reset-*`, `anthropic-ratelimit-*-reset`, « try again in … » | `retryAfterFrom()` retient le délai le plus long. Il s’ajoute au délai minimal sans jamais le réduire. |
| Persistance après une interruption, un redémarrage ou une reprise | `var/provider-pacing.json` (hors Git, droits 600, écriture atomique), relu avant chaque requête. |
| Arrêt brutal pendant une requête | Le début de la requête est noté avant l’envoi. Si sa fin n’a pas été notée : départ suivant au plus tôt début + 60 s (délai SDK) + 75 s. |
| Ctrl+C pendant l’attente | Attente découpée en tranches de 1 s et interruptible, **avant** la réservation : aucune réservation ne reste ouverte. |
| Diagnostic futur | Les en-têtes de limitation d’une liste blanche, dont l’identifiant de requête, sont ajoutés au message d’erreur. Aucun autre en-tête n’est conservé. |

La simulation lit le fichier de temporisation sans jamais l’écrire.

## 3. Décompte des analyses restantes

Vérifié dans le registre (`analyses` du prompt `96c4c96347de`) et dans le fichier de résultats :

| | Terminées | Restantes |
|---|---|---|
| Haiku | 3 (`gh-angular:435859328`, `gh-angular:432042455`, `gh-angular-components:433858366`) | **34** |
| Luna | 2 (`gh-angular:435859328`, `gh-angular:432042455`) | **35**, dont la publication refusée `gh-angular-components:433858366` |
| **Total** | 5 | **69** |

Le chiffre de 68 donné dans le rapport précédent était **faux**. Faute de quota, l’ancien plan écartait sans bruit une 35e publication Luna (`synthetic:minimal-announcement`). Avec l’exception, plus aucune publication n’est écartée faute de quota.

## 4. Exception de quota `B2-luna-http429-2026-11-06`

- **Portée :** phase B.2, modèle `openai-gpt-6-luna`, +1 tentative, **réservée** à la publication `gh-angular-components:433858366`.
- **Incident tracé :** exécution `5742ce5d-…`, réservation `4db6d939-…`, HTTP 429, non facturé.
- **Conditions d’utilisation :**
  - même phase, même modèle et même publication ;
  - pas encore consommée ;
  - exécution de l’incident présente dans les compteurs du registre ;
  - tentative faite **en dehors** de l’exécution de l’incident.
- **Consommation :** inscrite dans le registre (`quotas.exceptionsUsed`). Elle est restituée uniquement si la requête n’a pas été transmise (refus avant envoi). Un nouvel échec transmis la consomme définitivement.
- **Autres appels :** ils restent soumis au plafond de base (37 par modèle, 74 au total, hors tentatives imputées aux exceptions liées). L’exception ne peut donc pas servir à une autre publication.
- **Compteurs existants** (B.1 : 3 ; B.2 : 6) et historique conservés ; budget de 0,50 €, quotas de production et plafond par exécution inchangés.

## 5. Plan de reprise (simulation sur le registre réel)

| Élément | Valeur |
|---|---|
| Appels prévus | **69** (Haiku 34, Luna 35), aucun doublon ; seules les 5 analyses réussies sont écartées |
| Ordre | Alterné ; la première requête Luna porte sur la publication refusée |
| Quotas après la reprise | B.2 : 75/75 (Haiku 37/37, Luna 38/38 dont 1 au titre de l’exception) |
| **Coût maximal réservé** | **0,112265 €** (≤ 0,13 €) |
| Budget | 0,002343 € dépensés ; après la reprise, au moins **0,385392 €** restants sur 0,50 € |
| **Durée estimée** | **≈ 52 min** en régime typique (15 s par appel), 79 min dans le pire cas (60 s par appel) |
| Activation B.2 | 90 min ; la durée typique avec 25 % de marge (65 min) est compatible |
| Coûts incertains, réservations ouvertes | 0, 0 |

Latence réelle observée : 0,8 à 6,3 s par appel. La durée effective devrait se situer vers 46 min.
