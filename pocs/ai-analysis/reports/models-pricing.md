# POC 2 — Modèles et tarifs vérifiés

> **Revérification : 2026-11-06 (phase A.1)**, sur les pages officielles des fournisseurs. Aucun appel aux modèles. Tarifs standard en USD par million de tokens (MTok).
> Niveau de preuve : **texte** = phrase officielle citée ; **résumé** = extrait résumé d’une page officielle (page trop longue pour être lue intégralement) ; **déduit** = déduction d’un exemple ; **absent** = non documenté.

## Modèles candidats (inchangés : aucune raison de les remplacer)

| | Claude Haiku 5.5 | GPT-6 Luna |
|---|---|---|
| Identifiant | `claude-haiku-5-5` (texte) | `gpt-6-luna`, instantané par défaut (texte) |
| Entrée / sortie | **0,10 $ / 0,50 $** (prompts ≤ 100 000 tokens) ; 0,50 $ / 2,50 $ au-delà (texte) | **0,10 $ / 0,50 $** (≤ 272K tokens d’entrée) ; **0,20 $ / 0,75 $ au-delà**, palier ajouté en A.1 (texte) |
| Lecture du cache | 0,01 $ (texte) | 0,01 $ (texte) |
| Sortie structurée | `output_config.format = { type: "json_schema", schema }`, modèle pris en charge (texte) | `text.format = { type: "json_schema", name, schema, strict: true }` ; `structured_outputs` listé dans les fonctionnalités du modèle (texte) |
| Plafond de sortie et réflexion | `max_tokens` borne réflexion + texte (texte) | `max_output_tokens` borne raisonnement + sortie visible + formatage (texte) |
| Facturation de la réflexion | En sortie ; `output_tokens` est le total facturé (texte) | En sortie (texte) ; inclusion dans `output_tokens` **déduite** d’un exemple → normalisation prudente |
| Surcoût de la sortie structurée | Prompt système injecté et facturé en entrée (résumé) | Non relevé |
| Sortie maximale fournisseur | 128K (texte) | 128 000 (texte) |
| **Statut de configuration** | **validated** | **validated** |

Statut `validated` : identifiant, tarif et mécanisme de sortie structurée sont confirmés par le texte officiel. Les points de niveau « résumé » ou « déduit » sont listés ci-dessous comme vérifications de la première requête réelle.

## Ajustements faits en phase A.1

- **Schéma** : l’`enum` entier de `novelty` est retiré. Il n’est pas documenté côté Anthropic, et la borne 1–5 reste vérifiée localement. Les unions avec `null` et l’`enum` de `exclusionReason` incluant `null` sont conservés : ils sont autorisés selon les résumés des deux documentations et apparaissent dans un exemple officiel OpenAI.
- **gpt-6-luna** : ajout du palier long contexte (2× entrée, 1,5× sortie au-delà de 272K tokens).
- **Normalisation de l’usage** (`src/adapters/real.ts`) : Anthropic prend `output_tokens` tel quel (inclusif, documenté) ; OpenAI calcule `max(output, min(output + reasoning, max_output_tokens))`, prudent mais borné.
- **Garde-fou** : un modèle au statut `not-validated` (cas de `gpt-5-nano`, dont la sortie structurée n’est pas vérifiée) est refusé par le budget. `realCallBlockers()` liste tout ce qui empêche un appel réel, à commencer par `REAL_CALLS_ENABLED = false`.

## Vérifications de la première requête réelle (phase B, dans le budget d’essai)

| Modèle | À confirmer |
|---|---|
| Claude Haiku 5.5 | Schéma accepté sans erreur 400 (unions avec `null`, `enum` incluant `null`) ; écart entre `input_tokens` réel et borne haute (taille du prompt injecté) |
| GPT-6 Luna | Schéma accepté en mode strict ; structure réelle de `usage` (`output_tokens` et `output_tokens_details.reasoning_tokens`) |

## Alternatives relevées, non retenues

| Modèle | Tarif (entrée / sortie) | Raison |
|---|---|---|
| `gpt-5-nano` | 0,05 $ / 0,40 $ | Sortie structurée non vérifiée : configuré en `not-validated` |
| `claude-sonnet-5-5` | 2 $ / 10 $ | 20 fois plus cher, à réserver à une comparaison de qualité |
| `claude-haiku-4-5` | 1 $ / 5 $ | Génération précédente, 10 fois plus chère |

## Sources

- Anthropic : [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- OpenAI : [pricing](https://developers.openai.com/api/docs/pricing), [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
