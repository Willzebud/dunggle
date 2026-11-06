# POC 2 — Phase A : tests et scénarios budgétaires

> Généré par `npm run budget:scenarios` le 2026-11-06. Aucun appel réel ; modèle fictif `mock-cheap` (1 $ / 5 $ par M de tokens) pour exercer les plafonds.

## Paramètres appliqués

| Paramètre | Valeur |
|---|---|
| Maximum absolu mensuel | 10 € |
| Budget opérationnel mensuel (appliqué) | 8 € |
| Budget total des essais du POC | 0.5 € |
| Analyses par jour (max) | 200 |
| Tokens d’entrée / sortie par requête (max) | 16000 / 800 |
| Marge de sécurité | ×1.25 |
| Conversion | 1 USD = 1 EUR (borne haute prudente) |

## Scénarios exécutés

| Scénario | Attendu | Observé | Résultat |
|---|---|---|---|
| 100 réservations simultanées, plafond 0,05 € (0,005125 € chacune) | 9 acceptées, réservé ≤ 0,05 € | 9 acceptées, réservé 0.046125 € | ✅ |
| 30 réservations via deux gardes sur un même fichier, plafond 0,03 € | 5 acceptées | 5 acceptées | ✅ |
| 2e analyse avec un quota quotidien de 1 | refus daily-limit | refus daily-limit | ✅ |
| Modèle sans tarif vérifié | refus unknown-pricing | refus unknown-pricing | ✅ |
| Entrée de 120 000 tokens (plafond 16 000) | refus request-too-large | refus request-too-large | ✅ |
| Réservation dont le maximum dépasse le budget d’essai restant | refus trial-cap | refus trial-cap | ✅ |
| Timeout après envoi, usage inconnu | facturé au maximum (0.000875 €), marqué incertain | 0.000875 €, incertain 0.000875 € | ✅ |
| Réconciliation (2 400 entrée / 300 sortie, Haiku 5.5) | 0,00039 € (= (2400×0,10 + 300×0,50)/1e6) | 0.00039 € | ✅ |
| Libérer un coût incertain | refus unknown-reservation (jamais libéré) | refus unknown-reservation | ✅ |
| Coût réel (0,025 €) > estimation (0,00075 €), budget d’essai 0,02 € | dette enregistrée, appel suivant refusé | dépense 0.025 €, appel suivant : refus trial-cap | ✅ |
| Réservation le 31/10 à 23:59, réconciliée le 01/11 | imputée à octobre ; novembre repart de zéro | octobre 0.0006 €, novembre : accepté | ✅ |

## Projection avec les tarifs vérifiés (2026-11-06)

| Modèle | Coût max d’une requête au plafond (16000 / 800 tokens) | Coût max d’une requête « métadonnées » (borne ~3 600 tokens) | Analyses au pire cas dans 0,50 € | Analyses au pire cas dans 8 €/mois |
|---|---|---|---|---|
| claude-haiku-5-5 | 0.002500 € | 0.000950 € | 200 | 3200 |
| gpt-6-luna | 0.002500 € | 0.000950 € | 200 | 3200 |

À environ 390 publications par mois (POC 1.2), même le pire cas (≈ 1 € par mois) reste très inférieur au budget opérationnel. Le plafond qui s’applique en premier en pratique est le budget d’essai de 0,50 €.

## Tests automatisés correspondants

Fichiers `tests/budget.test.ts` et `tests/budget-audit.test.ts` (phase A.1 : borne haute d’entrée, coût maximal, normalisation des tokens de raisonnement, palier long contexte, modèle non validé, coût incertain jamais libéré, dette, changement de mois, persistance après redémarrage, interruption de processus, verrou orphelin). `tests/budget.test.ts` (exécuté par `npm test`) : estimation, tarif inconnu, requête trop grande, limites incohérentes, budget d’essai, plafonds mensuels, quota quotidien, réconciliation / libération / coût incertain, coût réel supérieur à l’estimation, réservations orphelines, concurrence en mémoire, concurrence via fichier, concurrence entre **trois processus distincts**, journal JSON Lines. `tests/pipeline.test.ts` couvre les échecs fournisseur de bout en bout.

## Limites

- La comptabilité interne est une **estimation prudente**. Elle ne garantit pas la facture : configurer aussi les plafonds de dépense dans les consoles Anthropic et OpenAI avant la phase B.
- Le verrou fichier suppose un système de fichiers local (pas de NFS). Un verrou orphelin n’est jamais cassé automatiquement : il bloque les analyses jusqu’à une intervention manuelle.
- Les tarifs sont figés dans `src/config/models.ts` : ils doivent être revérifiés avant chaque campagne d’essais.
- Les tokens de réflexion ou de raisonnement sont comptés en sortie et bornés par le plafond de 800 tokens. Une réponse tronquée par ce plafond est facturée, puis rejetée comme sortie invalide.
- Audit détaillé et protections fournisseurs : `reports/budget-audit.md`.
