# POC 2 — Phase A : modèles et tarifs vérifiés

> **Vérification : 2026-11-06**, sur les pages officielles des fournisseurs. Aucun appel aux modèles. Les tarifs sont en USD par million de tokens (MTok), tarif standard (hors Batch, hors cache).

## Modèles candidats retenus

| | Anthropic — Claude Haiku 5.5 | OpenAI — GPT-6 Luna |
|---|---|---|
| Identifiant | `claude-haiku-5-5` | `gpt-6-luna` (instantané par défaut, seul listé) |
| Entrée | **0,10 $ / MTok** (prompts ≤ 100 000 tokens) ; 0,50 $ au-delà | **0,10 $ / MTok** (contexte ≤ 272K) |
| Sortie | **0,50 $ / MTok** (≤ 100 000 tokens d’entrée) ; 2,50 $ au-delà | **0,50 $ / MTok** |
| Lecture du cache | 0,01 $ / MTok | 0,01 $ / MTok (« cached input ») |
| Sortie structurée | Messages API : `output_config.format = { type: "json_schema", schema }` ; `claude-haiku-5-5` figure dans la liste des modèles pris en charge | Responses API : `text.format = { type: "json_schema", name, schema, strict: true }` ; « structured_outputs » listé dans les fonctionnalités du modèle |
| Réflexion / raisonnement | Réflexion adaptative active par défaut, facturée comme sortie ; effort par défaut `medium` → le POC fixe `low` | Modèle de raisonnement (`reasoning.effort`, défaut `medium`) → le POC fixe `low` ; la page modèle ne précise pas la facturation des tokens de raisonnement : **comptés comme sortie par prudence** |
| Contexte / sortie max | (non nécessaire ici) / 128K | 1 050 000 / 128 000 |
| Sources | [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | [pricing](https://developers.openai.com/api/docs/pricing), [modèle](https://developers.openai.com/api/docs/models/gpt-6-luna), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) |

Les deux modèles ont **le même tarif de base**. La comparaison de la phase B portera donc sur la qualité de classification, le respect du schéma et la consommation réelle de tokens (réflexion comprise), pas sur le prix affiché.

## Alternatives relevées, non retenues

| Modèle | Tarif (entrée / sortie) | Raison |
|---|---|---|
| `gpt-5-nano` (OpenAI) | 0,05 $ / 0,40 $ | Moins cher, mais sortie structurée non vérifiée sur sa page modèle lors de ce relevé. Configuré, non candidat |
| `claude-sonnet-5-5` (Anthropic) | 2 $ / 10 $ | 20 fois plus cher que Haiku 5.5 : à réserver à une éventuelle comparaison de qualité |
| `claude-haiku-4-5` (Anthropic) | 1 $ / 5 $ | Génération précédente, 10 fois plus chère que Haiku 5.5 |
| `gpt-5.4-nano` / `gpt-5-mini` (OpenAI) | 0,20 $ / 1,25 $ et 0,25 $ / 2 $ | Plus chers que gpt-6-luna |

Remarque : une recherche web a d’abord renvoyé des agrégateurs tiers aux tarifs contradictoires. Seules les pages officielles ont été retenues.

## Implications pour le budget (voir budget-scenarios.md)

- Coût maximal estimé d’une requête au plafond du POC (4 000 tokens d’entrée, 800 de sortie, marge ×1,25, 1 USD = 1 EUR) : **0,001 €**, soit 500 analyses au pire cas dans le budget d’essai de 0,50 €.
- Une passe complète du jeu d’évaluation (37 publications éligibles) : **≤ 0,025 € par modèle**.

## Points à confirmer avant la phase B

1. **Revérifier les tarifs** le jour des essais (ils sont figés dans `src/config/models.ts`).
2. Le schéma utilise des unions avec `null` (`summary`, `exclusionReason`) et un `enum` entier (`novelty`). Leur acceptation par les deux fournisseurs est documentée en principe, mais doit être confirmée par une **première requête réelle**, comptée dans le budget d’essai.
3. Facturation des tokens de raisonnement de gpt-6-luna (comptés comme sortie par prudence).
4. Implémenter les appels avec les **SDK officiels** (`@anthropic-ai/sdk`, `openai`) en phase B. En phase A, les adaptateurs ne font que construire les paramètres de requête (`buildAnthropicParams`, `buildOpenAIParams`) et ne contiennent aucun code réseau.
5. Configurer les **plafonds de dépense dans les consoles** des fournisseurs, en plus du garde applicatif.
