# POC 2 — Modèles et tarifs : validation documentaire

> **Vérification directe le 2026-11-06** : chaque page officielle a été téléchargée (`curl`, version Markdown servie par le site, HTTP 200) et les passages ci-dessous en sont **extraits mot pour mot**. Aucun résumé d’agent n’est retenu comme preuve. Aucun appel aux modèles.

## Verdicts

| Modèle | Verdict | Motif |
|---|---|---|
| `claude-haiku-5-5` | ✅ **validated** | Identifiant, tarifs et paliers, sortie structurée, plafond de sortie et facturation de la réflexion : tous confirmés par le texte officiel |
| `gpt-6-luna` | ✅ **validated** | Mêmes points confirmés par le texte officiel. **Un risque de coût découvert** (mise en cache activée par défaut, écritures à 1,25×) est neutralisé dans la requête et couvert dans l’estimation maximale |
| `gpt-5-nano` | ❌ not-validated | Sortie structurée non vérifiée ; refusé par le budget |

Même validés, les appels réels restent bloqués (`REAL_CALLS_ENABLED = false`) jusqu’à l’autorisation explicite de la phase B.

## Claude Haiku 5.5

| Point | Preuve (texte officiel) | Source |
|---|---|---|
| Identifiant API | Ligne « Claude API ID » du tableau : `` `claude-haiku-5-5` `` (alias identique) | [models/overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| Tarifs ≤ 100K | « Claude Haiku 5.5 (for prompts up to 100,000 tokens) \| $0.10 / MTok \| … \| $0.50 / MTok » (entrée, sortie) | [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Palier > 100K | « Claude Haiku 5.5 (for prompts over 100,000 tokens) \| $0.50 / MTok \| … \| $2.50 / MTok » ; « a request whose prompt is over 100,000 tokens pays higher prices » | [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Mise en cache | « Automatic caching: Add a single `cache_control` field at the top level of your request. » La mise en cache passe par `cache_control`, que Dunggle n’envoie pas : aucune écriture facturée | [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Sortie structurée | `claude-haiku-5-5` dans la liste `supportedModels` de la page ; requête `"type": "json_schema"` | [structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| Schéma | « `required` and `additionalProperties` (must be set to `false` for objects) » ; « `enum` (strings, numbers, booleans, or nulls only, no complex types) » ; unions : « type arrays (for example, `"type": ["string", "null"]`) » (limite de 16) ; non pris en charge : « Numerical constraints (such as `minimum`, `maximum`, `multipleOf`) » | [structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| Surcoût d’entrée | « Claude automatically receives an additional system prompt explaining the expected output format » ; « Your input token count is slightly higher. » | [structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| Plafond de sortie | « Max output \| … \| 128K tokens » ; « `max_tokens` is a hard cap on total output for the request, thinking and response text combined. » | [models/overview](https://platform.claude.com/docs/en/about-claude/models/overview), [thinking-steering-and-cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost) |
| Réflexion | « Tokens Claude uses while thinking (billed as output tokens) » ; « `output_tokens` remains the inclusive, authoritative total used for billing. » | [thinking-steering-and-cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost) |

## GPT-6 Luna

| Point | Preuve (texte officiel) | Source |
|---|---|---|
| Identifiant API | « Model ID: `gpt-6-luna` » ; « Default snapshot: `gpt-6-luna` » | [models/gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| Tarifs (Standard) | Tableau « Standard pricing data » : « \| gpt-6-luna \| $0.10 \| $0.50 \| $0.01 \| $0.125 \| $0.25 \| $0.20 \| $0.75 \| … » (entrée, sortie et lecture du cache en contexte court ; écritures 30 min et 12 h ; entrée et sortie en contexte long) ; page modèle : « Input \| $0.1 », « Output \| $0.5 » | [pricing](https://developers.openai.com/api/docs/pricing), [models/gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| Paliers | « Short context: ≤272K input tokens. Long context: >272K input tokens. » ; « priced at 2x input and cache rates and 1.5x output for the full request » | [pricing](https://developers.openai.com/api/docs/pricing), [models/gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| ⚠️ Mise en cache par défaut | « Prompt caching is enabled by default for supported OpenAI models. » ; « For GPT-5.6 and later, cache writes cost 1.25× the standard, uncached input-token rate for the default 30-minute lifetime » ; en mode implicite, un point d’arrêt est placé « at the end of the latest eligible message » | [prompt-caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| Neutralisation | Mode explicite : « When no explicit breakpoints are placed, the request does not use prompt caching or create cache writes. » → Dunggle envoie `prompt_cache_options: { mode: "explicit" }` sans point d’arrêt | [prompt-caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| Comptage | « multiply ordinary input tokens by the model’s input price, `cached_tokens` by its cached-input price, `ttl_30m_tokens` by 1.25× its input price, and `ttl_12h_tokens` by 2.5× » → appliqué par `normalizeOpenAIUsage` | [prompt-caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| Sortie structurée | Liste « Supported features » de la page modèle : « structured_outputs » | [models/gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| Schéma (mode strict) | « all fields or function parameters must be specified as `required` » ; « `additionalProperties: false` must always be set in objects » ; « emulate an optional parameter by using a union type with `null` » ; exemple officiel : `"enum": ["violence", "sexual", "self_harm", null]` | [structured-outputs](https://developers.openai.com/api/docs/guides/structured-outputs) |
| Plafond de sortie | « 128,000 max output tokens » ; « The `max_output_tokens` and `max_completion_tokens` parameters limit all tokens generated by the model, including non-visible tokens. » | [models/gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [token-counting](https://developers.openai.com/api/docs/guides/token-counting) |
| Raisonnement | « billed as output tokens » ; « Reported output token usage includes all tokens generated by the model […] The Responses API reports this total as `output_tokens` » | [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [token-counting](https://developers.openai.com/api/docs/guides/token-counting) |
| Contenu système caché | « Tokens in the OpenAI-provided hidden system content do not count toward this minimum » : un contenu système est ajouté par OpenAI, couvert par la marge forfaitaire | [prompt-caching](https://developers.openai.com/api/docs/guides/prompt-caching) |

## Conséquences intégrées dans le code (phase A.1, contrôle final)

1. **gpt-6-luna** : `prompt_cache_options: { mode: "explicit" }` est ajouté à la requête (aucune écriture en cache). L’estimation maximale compte l’entrée à 1,25× au cas où une écriture serait facturée malgré tout, ce qui porte le pire cas d’une requête de 0,00250 € à environ 0,00300 €.
2. **Normalisation OpenAI** : `output_tokens` est pris tel quel (inclusif, documenté) ; le coût d’entrée suit la formule officielle (écritures 1,25× ou 2,5×, lectures comptées à 1× par prudence).
3. **Normalisation Anthropic** : `output_tokens` est pris tel quel (inclusif, documenté).
4. Toutes les preuves des deux modèles candidats sont désormais de niveau « texte », et un test vérifie qu’aucune ne relève du résumé, de la déduction ou de l’absence.

## Vérifications de la première requête réelle (phase B)

| Modèle | À vérifier sur la réponse réelle |
|---|---|
| Claude Haiku 5.5 | Schéma accepté (pas d’erreur 400) ; écart entre `input_tokens` et la borne haute ; absence de `cache_creation_input_tokens` |
| GPT-6 Luna | Schéma accepté ; `input_tokens_details.cache_write_tokens` = 0 ; écart entre `input_tokens` et la borne haute |

Ces vérifications ne remettent pas la validation en cause : elles mesurent les marges, et tout écart est capté par le garde budgétaire (dette).
