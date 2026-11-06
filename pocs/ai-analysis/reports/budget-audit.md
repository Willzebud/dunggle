# POC 2 — Audit de la protection budgétaire (phase A.1)

> Audit réalisé le 2026-11-06 **sans aucun appel réel**. Chaque garantie renvoie au test automatisé qui la vérifie (`npm run poc2:test`).

## Garanties vérifiées

| Point audité | Constat avant A.1 | État après A.1 | Test |
|---|---|---|---|
| Plafond absolu 10 € / opérationnel 8 € / essais 0,50 € | Conformes | Inchangés ; toute réservation qui ferait dépasser l’un d’eux est refusée **avant** l’appel | `budget.test.ts` (plafonds, essai), `budget-audit.test.ts` (valeurs) |
| Réservation atomique | Transaction exclusive (verrou mémoire, ou `mkdir` + renommage atomique pour le fichier) | Inchangé | `budget.test.ts` (concurrence) |
| Appels concurrents | 100 réservations simultanées, 2 gardes sur un même fichier, 3 processus distincts : plafond jamais dépassé | Inchangé | `budget.test.ts` |
| Appels quotidiens maximum | Quota par jour UTC ; une requête libérée (non envoyée) ne compte pas | Inchangé | `budget.test.ts` |
| **Coût maximal (pas moyen)** | ❌ L’entrée était estimée à 1 token pour 3 caractères, une **moyenne**, sans tenir compte du prompt injecté par la sortie structurée | ✅ **Borne haute** : octets UTF-8 (un tokeniseur BPE au niveau de l’octet ne peut produire plus d’un token par octet) + 2 000 tokens de marge forfaitaire. Plafond par requête porté à 16 000 tokens | `budget-audit.test.ts` (borne haute, coût maximal) |
| Plafond de tokens en sortie | 800 tokens imposés au fournisseur (`max_tokens`, `max_output_tokens`) | Inchangé ; la documentation officielle confirme que ce plafond borne aussi la réflexion et le raisonnement | `budget-audit.test.ts` |
| **Tokens de raisonnement** | ❌ Non traités dans l’usage | ✅ Anthropic : `output_tokens` est documenté comme le total facturé, réflexion incluse. OpenAI : l’inclusion n’est que déduite d’un exemple, donc normalisation prudente (sortie + raisonnement, plafonnée par `max_output_tokens`) | `budget-audit.test.ts` (normalisation) |
| Erreurs fournisseur | Non envoyée → libérée ; usage connu → réconcilié ; inconnu → coût incertain | Inchangé, mais le coût incertain n’est plus soldé prématurément (ligne suivante) | `pipeline.test.ts` |
| **Coût réel inconnu** | ❌ Le maximum était facturé, puis la réservation disparaissait : aucune réconciliation ultérieure, aucun dépassement capturé | ✅ Entrée `uncertain` **persistée**, comptée au maximum, **jamais libérable**. Seul `resolveUncertain()` la solde, avec l’usage réel relevé, et un excédent devient une dette | `budget-audit.test.ts` (coût incertain, dette sur incertain) |
| **Dette (réel > estimation)** | Enregistrée, mais non testée | ✅ Intégralement imputée (`overrunEur`), journalisée (`actual-exceeds-estimate`, `trial-cap-exceeded`) ; les réservations suivantes sont **refusées** | `budget-audit.test.ts` (dette) |
| **Persistance après redémarrage** | Registre fichier existant, mais non branché par défaut et non testé | ✅ `createPersistentGuard()` (registre `var/budget-ledger.json` et journal `var/usage-log.jsonl`, ignorés par Git) ; état relu à l’identique par une nouvelle instance | `budget-audit.test.ts` (persistance) |
| **Transitions de mois** | Non testées | ✅ Mois civil UTC ; une réservation est imputée au mois de sa création, même réconciliée le mois suivant ; le nouveau mois repart de zéro ; le budget d’essai reste cumulatif | `budget-audit.test.ts` (mois civils) |
| **Interruption d’un processus** | Non testée | ✅ Un processus tué après réservation laisse une réservation **comptée**. `expireStale()` la convertit en coût incertain, sans jamais la libérer. Un verrou orphelin n’est jamais cassé automatiquement : les analyses sont bloquées | `budget-audit.test.ts` (interruption, verrou orphelin) |
| Tarifs inconnus / modèle non validé | Refus si tarif absent | ✅ Refus aussi si la configuration est `not-validated` (cas de `gpt-5-nano`) ; palier long contexte de gpt-6-luna ajouté | `budget-audit.test.ts` (tarifs) |

## Ce que la comptabilité applicative NE garantit PAS

1. **La facture du fournisseur.** L’application estime les coûts à partir de tarifs figés et de l’usage déclaré. Une erreur de tarif, un changement de prix, une facturation non documentée ou une requête faite hors de l’application (autre script, console) lui échappent.
2. **Une borne stricte sur l’entrée.** La borne en octets est stricte pour le texte, mais la marge de 2 000 tokens couvrant le formatage et le prompt injecté par la sortie structurée est une **hypothèse**, car sa taille n’est pas publiée. Un dépassement est capté comme dette au moment de la réconciliation, donc après l’appel.
3. **Les appels à coût inconnu.** Ils sont comptés au maximum réservé. Si le fournisseur a facturé davantage (cas improbable, les plafonds de tokens étant imposés), l’écart n’apparaît qu’après un relevé manuel suivi de `resolveUncertain()`.
4. **Le fuseau de facturation.** Les mois et jours sont calculés en UTC ; un fournisseur qui facturerait dans un autre fuseau décalerait les frontières de quelques heures.
5. **Le taux de change.** 1 USD est compté 1 EUR, une borne haute volontaire, à réviser si le dollar dépassait l’euro.
6. **Le verrou fichier** suppose un disque local (pas de NFS). Les écritures étant atomiques par renommage, une interruption pendant l’écriture laisse au pire un fichier temporaire orphelin, jamais un registre corrompu.

## Protections à configurer chez les fournisseurs avant la phase B (obligatoire)

- **Anthropic Console** : limite de dépense mensuelle de l’organisation ou de l’espace de travail, réglée au plus bas possible (par exemple 1 à 2 € pour les essais) ; clé API dédiée aux essais Dunggle.
- **OpenAI Platform** : limite de budget du projet, alertes de consommation ; clé de projet dédiée.
- Vérifier ensuite, dans chaque console, que la dépense réelle correspond au registre `var/budget-ledger.json`.
- Ne jamais réutiliser ces clés ailleurs que dans le garde persistant, sinon l’application ne voit pas ces dépenses.

Ces limites fournisseurs sont la seule garantie **stricte**. Le garde applicatif refuse les appels avant tout dépassement, mais il ne peut pas empêcher une facturation qu’il ne voit pas.
