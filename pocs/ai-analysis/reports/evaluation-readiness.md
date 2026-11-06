# POC 2 — Phase A : préparation de l’évaluation

> Généré par `npm run prepare:eval` le 2026-11-06. **Aucun appel à un modèle.** Les coûts sont des MAXIMA estimés (entrée estimée à 1 token / 3 caractères, sortie au plafond de 800 tokens, marge ×1.25, 1 USD compté 1 EUR).

## 1. Jeu d’évaluation

- **39 publications** : 30 réelles (métadonnées uniquement) et 9 synthétiques (textes fictifs signalés).
- Niveaux de contenu : FULL 22, PARTIAL 13, MINIMAL 4.
- Politiques : metadata-only 30, full-allowed 8, blocked 1.
- Modes d’entrée effectifs : metadata 31, full 5, excerpt 2, none 1.
- Cas ambigus (vérité terrain) : 10. Résumés attendus : 7 (uniquement des fixtures synthétiques).
- **Éligibles à l’IA : 37** (exclus : 1 source bloquée, 1 exclusion éditoriale tracée).

## 2. Détail par publication

| Publication | Source | Niveau | Politique | Mode envoyé | Résumé permis | Tokens entrée (est.) | Coût max Haiku 5.5 | Coût max gpt-6-luna | Préfiltre (observation) |
|---|---|---|---|---|---|---|---|---|---|
| 22.3.0-next.4 | gh-angular | FULL | metadata-only | metadata | non | 1244 | 0.000655 € | 0.000655 € | MISE_A_JOUR |
| 21.2.26 | gh-angular | PARTIAL | metadata-only | metadata | non | 1240 | 0.000655 € | 0.000655 € | MISE_A_JOUR |
| 22.2.6 | gh-angular-components | PARTIAL | metadata-only | metadata | non | 1241 | 0.000655 € | 0.000655 € | MISE_A_JOUR |
| An update on Angular’s TypeScript 7-powered Compiler | angular-blog | FULL | metadata-only | metadata | non | 1273 | 0.000659 € | 0.000659 € | PERTINENT |
| Signal Value Transforms, Routing Essentials, and Video Extension with  | angular-blog | FULL | metadata-only | metadata | non | 1288 | 0.000661 € | 0.000661 € | AMBIGU |
| Announcing TypeScript 7.1 Beta | typescript-blog | FULL | metadata-only | metadata | non | 1255 | 0.000657 € | 0.000657 € | MISE_A_JOUR |
| Announcing TypeScript 7.0 | typescript-blog | FULL | metadata-only | metadata | non | 1252 | 0.000657 € | 0.000657 € | PERTINENT |
| GPT‑6 Cyber: Advancing the frontier of aligned cybersecurity agents | openai-news | PARTIAL | metadata-only | metadata | non | 1254 | 0.000657 € | 0.000657 € | AMBIGU |
| Cult.fit builds operational muscle with Codex | openai-news | PARTIAL | metadata-only | metadata | non | 1247 | 0.000656 € | 0.000656 € | PROMO → écarterait |
| Flipsnack grows product signups with conversion optimization | openai-news | PARTIAL | metadata-only | metadata | non | 1249 | 0.000656 € | 0.000656 € | PROMO → écarterait |
| OpenAI to acquire Pierre Computer Company, Inc. | openai-news | PARTIAL | metadata-only | metadata | non | 1247 | 0.000656 € | 0.000656 € | FINANCE_STARTUP → écarterait |
| Australian universities are creating AI-native graduates | openai-news | PARTIAL | metadata-only | metadata | non | 1257 | 0.000657 € | 0.000657 € | PERTINENT |
| Gemini 4 Carbon: Our next frontier model | deepmind-blog | MINIMAL | metadata-only | metadata | non | 1255 | 0.000657 € | 0.000657 € | AMBIGU |
| Genie 4: A new generation of world simulation | deepmind-blog | PARTIAL | metadata-only | metadata | non | 1258 | 0.000657 € | 0.000657 € | PERTINENT |
| New NVIDIA Cosmos 3 Open Models for Interactive World Simulation | huggingface-blog | MINIMAL | metadata-only | metadata | non | 1262 | 0.000658 € | 0.000658 € | PERTINENT |
| Detecting signs of hypertension using wearable sensors | google-research | MINIMAL | metadata-only | metadata | non | 1264 | 0.000658 € | 0.000658 € | AMBIGU |
| Quoting Paul Ford | simon-willison | PARTIAL | metadata-only | metadata | non | 1238 | 0.000655 € | 0.000655 € | AMBIGU |
| llm 0.37.1 | simon-willison | PARTIAL | metadata-only | metadata | non | 1233 | 0.000654 € | 0.000654 € | PERTINENT |
| v0.24.0 | gh-openai-agents | FULL | metadata-only | metadata | non | 1245 | 0.000656 € | 0.000656 € | MISE_A_JOUR |
| langgraph-cli==0.4.42 | gh-langgraph | PARTIAL | metadata-only | metadata | non | 1245 | 0.000656 € | 0.000656 € | MISE_A_JOUR |
| 2.4.0 | gh-mcp-ts-sdk | FULL | metadata-only | metadata | non | 1244 | 0.000655 € | 0.000655 € | MISE_A_JOUR |
| v2.1.318 | gh-claude-code | FULL | metadata-only | metadata | non | 1239 | 0.000655 € | 0.000655 € | MISE_A_JOUR |
| A 0-click exploit chain for the Pixel 10: When a Door Closes, a Window | project-zero | FULL | metadata-only | metadata | non | 1262 | 0.000658 € | 0.000658 € | AMBIGU |
| Agency and Agents | one-useful-thing | FULL | metadata-only | metadata | non | 1245 | 0.000656 € | 0.000656 € | AMBIGU |
| I watched a humanoid robot clean my apartment. It felt like a taste of | mit-tech-review | FULL | metadata-only | metadata | non | 1290 | 0.000661 € | 0.000661 € | PERTINENT |
| A new bill could change how the US builds energy infrastructure | mit-tech-review | FULL | metadata-only | metadata | non | 1263 | 0.000658 € | 0.000658 € | HORS_SUJET → écarterait |
| The Download: Texas’s fragile AI boom and energy policy shifts | mit-tech-review | FULL | metadata-only | aucun appel (règle éditoriale) | non | — | 0.000000 € | 0.000000 € | AMBIGU |
| Securing the agentic enterprise with data lineage | mit-tech-review | FULL | metadata-only | metadata | non | 1269 | 0.000659 € | 0.000659 € | AMBIGU |
| Video Friday: Spot Plays to Show Its Whole-Body Manipulation | ieee-robotics | FULL | metadata-only | metadata | non | 1320 | 0.000665 € | 0.000665 € | PERTINENT |
| Your Robot’s Safety Functions Already Work. What If the Input Lies? | ieee-robotics | FULL | metadata-only | metadata | non | 1263 | 0.000658 € | 0.000658 € | PERTINENT |
| [SYNTHÉTIQUE] Angular 99.0 introduit l’API fictive deriveSignal() | synthetic-fixtures | FULL | full-allowed | full | oui | 1603 | 0.000700 € | 0.000700 € | PERTINENT |
| [SYNTHÉTIQUE] Le laboratoire fictif Orion publie un modèle multimodal  | synthetic-fixtures | FULL | full-allowed | full | oui | 1542 | 0.000693 € | 0.000693 € | PERTINENT |
| [SYNTHÉTIQUE] La spécification fictive MCP 2099-01 ajoute les tâches a | synthetic-fixtures | FULL | full-allowed | full | oui | 1559 | 0.000695 € | 0.000695 € | AMBIGU |
| [SYNTHÉTIQUE] OrchestraJS 3.2 (fictif) : reprise après panne des agent | synthetic-fixtures | PARTIAL | full-allowed | excerpt | oui | 1349 | 0.000669 € | 0.000669 € | PERTINENT |
| [SYNTHÉTIQUE] La start-up fictive Lumio lève 40 millions d’euros | synthetic-fixtures | FULL | full-allowed | full | oui | 1455 | 0.000682 € | 0.000682 € | HORS_SUJET → écarterait |
| [SYNTHÉTIQUE] Démonstration fictive de 48 qubits logiques avec correct | synthetic-fixtures | FULL | full-allowed | full | oui | 1510 | 0.000689 € | 0.000689 € | AMBIGU |
| [SYNTHÉTIQUE] Une région fictive encadre l’usage des agents IA dans le | synthetic-fixtures | PARTIAL | full-allowed | excerpt | oui | 1342 | 0.000668 € | 0.000668 € | AMBIGU |
| [SYNTHÉTIQUE] Article d’une source configurée comme bloquée | synthetic-blocked | FULL | blocked | aucun appel (bloquée) | non | — | 0.000000 € | 0.000000 € | HORS_SUJET → écarterait |
| [SYNTHÉTIQUE] Annonce fictive d’un nouvel outil d’agents de test | synthetic-fixtures | MINIMAL | full-allowed | metadata | non | 1263 | 0.000658 € | 0.000658 € | AMBIGU |

## 3. Coût d’une passe complète (maximum estimé)

| Modèle | Passe complète (éligibles) | Passes possibles dans le budget d’essai de 0,50 € |
|---|---|---|
| claude-haiku-5-5 | 0.0245 € | 20 |
| gpt-6-luna | 0.0245 € | 20 |

Entrée maximale estimée : 1603 tokens (plafond par requête : 4000) ✅.

## 4. Préfiltre déterministe (observation, non activé)

Préfiltre activé : **non**. Mesure sur les 37 publications éligibles, comparée à la vérité terrain (« exclusion obligatoire » = exclue) :

| Écartées à juste titre | Gardées alors qu’à exclure (faux positifs) | **Écartées à tort (faux négatifs)** | Gardées à juste titre |
|---|---|---|---|
| 4 | 0 | **1** | 32 |

Faux négatifs (publications pertinentes que le préfiltre aurait écartées) : openai-news:https://openai.com/index/openai-to-acquire-pierre.

Ces chiffres opposent le préfiltre à la vérité terrain **avant** tout appel IA. Il faudra les recompter en phase B, contre les classifications réelles. Le préfiltre ne doit pas être activé tant qu’il produit des faux négatifs sur des publications prioritaires.

## 5. Limites de représentativité

- 39 publications seulement, choisies à la main pour couvrir les cas ; ce n’est pas un échantillon aléatoire du flux réel (environ 13 publications par jour).
- Les 30 publications réelles sont toutes en `metadata-only` : la phase B ne mesurera sur elles que la classification à partir du titre et des métadonnées. La qualité des résumés ne sera mesurée que sur 7 fixtures synthétiques.
- La vérité terrain a été rédigée par l’assistant à partir des titres : elle doit être relue par le propriétaire du projet, en particulier les 10 cas ambigus.
- Les fixtures synthétiques sont en français et courtes ; les articles réels sont surtout en anglais et plus longs.
- Les tokens sont estimés (3 caractères par token) ; le comptage exact viendra de l’usage renvoyé par les fournisseurs en phase B.
