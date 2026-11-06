# POC 2 — Préparation de l’évaluation (phase A.1)

> Généré par `npm run prepare:eval` le 2026-11-06. **Aucun appel à un modèle.** Coûts = MAXIMA : borne haute d’entrée (octets UTF-8 + 2000 tokens de marge pour le formatage et le prompt injecté par la sortie structurée), sortie au plafond de 800 tokens (réflexion comprise), marge ×1.25, 1 USD compté 1 EUR.

## 1. Synthèse

- 39 publications ; **37 éligibles à l’IA** (non éligibles : 1 source bloquée, 1 exclusion éditoriale tracée).
- Décisions éditoriales, **ensemble des 39 publications** : must_keep 30, must_exclude 5, ambiguous 4. **Sur les 37 éligibles** : must_keep 29, must_exclude 4, ambiguous 4. Couverture : mandatory 11, selective 28.
- Publications non éligibles : `mit-tech-review:https://www.technologyreview.com/?p=1144908` (must_exclude), `synthetic:blocked-source` (must_keep).
- Cohérence ensemble / sous-ensemble : ✅ effectifs éligibles ≤ effectifs globaux, sommes exactes.
- Résumés : autorisés pour 7 publications, attendus pour 6 (+ 0 « si conservée »). Toutes sont synthétiques.
- Modes envoyés : metadata 30, aucun appel 2, full 5, excerpt 2.

## 2. Préfiltre déterministe (observation — **désactivé**)

Préfiltre activé : **non**. Mesure sur les 37 publications éligibles, contre la décision éditoriale explicite de la vérité terrain.

| Groupe | Total | Correct | Erreurs | Détail |
|---|---|---|---|---|
| `must_keep` | 29 | 29 conservées | **0 faux négatifs** (écartées à tort) | — |
| `must_exclude` | 4 | 4 écartées | **0 faux positifs** (conservées à tort) | — |
| `ambiguous` (hors erreurs) | 4 | — | — | 1 écartées, 3 conservées (écartées : openai-news:https://openai.com/index/openai-to-acquire-pierre) |

Rappel « à conserver » : **100 %** ; rappel « à exclure » : **100 %**.

**Correction méthodologique (phase A.1)** : le rapport précédent comptait l’acquisition OpenAI comme faux négatif. Or sa vérité terrain autorise la conservation comme l’exclusion. Elle est désormais `ambiguous` et comptée à part. Les erreurs ne portent plus que sur les publications `must_keep` (faux négatifs) et `must_exclude` (faux positifs).

Décision : le préfiltre reste **désactivé**. Son intérêt économique est nul à ce volume (budget-scenarios.md). Sur 37 publications, l’absence de faux négatif ne suffit pas à garantir son innocuité sur le flux réel : il faudra le remesurer en phase B, contre les classifications réelles.

## 3. Détail par publication

| Publication | Source | Décision | Couverture | Niveau | Politique | Mode envoyé | Résumé autorisé / attendu | Tokens (typique / borne) | Coût max Haiku 5.5 | Coût max gpt-6-luna | Préfiltre |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 22.3.0-next.4 | gh-angular | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1900 / 7819 | 0.001477 € | 0.001722 € | MISE_A_JOUR |
| 21.2.26 | gh-angular | must_keep | mandatory | PARTIAL | metadata-only | metadata | non / non | 1896 / 7807 | 0.001476 € | 0.001720 € | MISE_A_JOUR |
| 22.2.6 | gh-angular-components | must_keep | mandatory | PARTIAL | metadata-only | metadata | non / non | 1897 / 7811 | 0.001476 € | 0.001720 € | MISE_A_JOUR |
| An update on Angular’s TypeScript 7-powered Compiler | angular-blog | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1929 / 7908 | 0.001489 € | 0.001736 € | PERTINENT |
| Signal Value Transforms, Routing Essentials, and Video Exten | angular-blog | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1944 / 7952 | 0.001494 € | 0.001743 € | AMBIGU |
| Announcing TypeScript 7.1 Beta | typescript-blog | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1911 / 7852 | 0.001482 € | 0.001727 € | MISE_A_JOUR |
| Announcing TypeScript 7.0 | typescript-blog | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1908 / 7842 | 0.001480 € | 0.001725 € | PERTINENT |
| GPT‑6 Cyber: Advancing the frontier of aligned cybersecurity | openai-news | must_keep | selective | PARTIAL | metadata-only | metadata | non / non | 1910 / 7850 | 0.001481 € | 0.001727 € | AMBIGU |
| Cult.fit builds operational muscle with Codex | openai-news | must_exclude | selective | PARTIAL | metadata-only | metadata | non / non | 1903 / 7828 | 0.001479 € | 0.001723 € | PROMO → écarterait |
| Flipsnack grows product signups with conversion optimization | openai-news | must_exclude | selective | PARTIAL | metadata-only | metadata | non / non | 1905 / 7835 | 0.001479 € | 0.001724 € | PROMO → écarterait |
| OpenAI to acquire Pierre Computer Company, Inc. | openai-news | ambiguous | selective | PARTIAL | metadata-only | metadata | non / non | 1903 / 7829 | 0.001479 € | 0.001723 € | FINANCE_STARTUP → écarterait |
| Australian universities are creating AI-native graduates | openai-news | ambiguous | selective | PARTIAL | metadata-only | metadata | non / non | 1913 / 7857 | 0.001482 € | 0.001728 € | PERTINENT |
| Gemini 4 Carbon: Our next frontier model | deepmind-blog | must_keep | selective | MINIMAL | metadata-only | metadata | non / non | 1911 / 7851 | 0.001481 € | 0.001727 € | AMBIGU |
| Genie 4: A new generation of world simulation | deepmind-blog | must_keep | selective | PARTIAL | metadata-only | metadata | non / non | 1914 / 7861 | 0.001483 € | 0.001728 € | PERTINENT |
| New NVIDIA Cosmos 3 Open Models for Interactive World Simula | huggingface-blog | must_keep | selective | MINIMAL | metadata-only | metadata | non / non | 1918 / 7873 | 0.001484 € | 0.001730 € | PERTINENT |
| Detecting signs of hypertension using wearable sensors | google-research | must_keep | selective | MINIMAL | metadata-only | metadata | non / non | 1920 / 7880 | 0.001485 € | 0.001731 € | AMBIGU |
| Quoting Paul Ford | simon-willison | ambiguous | selective | PARTIAL | metadata-only | metadata | non / non | 1894 / 7800 | 0.001475 € | 0.001719 € | AMBIGU |
| llm 0.37.1 | simon-willison | must_keep | selective | PARTIAL | metadata-only | metadata | non / non | 1889 / 7787 | 0.001473 € | 0.001717 € | PERTINENT |
| v0.24.0 | gh-openai-agents | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1901 / 7822 | 0.001478 € | 0.001722 € | MISE_A_JOUR |
| langgraph-cli==0.4.42 | gh-langgraph | must_keep | mandatory | PARTIAL | metadata-only | metadata | non / non | 1901 / 7822 | 0.001478 € | 0.001722 € | MISE_A_JOUR |
| 2.4.0 | gh-mcp-ts-sdk | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1900 / 7819 | 0.001477 € | 0.001722 € | MISE_A_JOUR |
| v2.1.318 | gh-claude-code | must_keep | mandatory | FULL | metadata-only | metadata | non / non | 1895 / 7804 | 0.001476 € | 0.001719 € | MISE_A_JOUR |
| A 0-click exploit chain for the Pixel 10: When a Door Closes | project-zero | must_keep | selective | FULL | metadata-only | metadata | non / non | 1918 / 7873 | 0.001484 € | 0.001730 € | AMBIGU |
| Agency and Agents | one-useful-thing | must_keep | selective | FULL | metadata-only | metadata | non / non | 1901 / 7821 | 0.001478 € | 0.001722 € | AMBIGU |
| I watched a humanoid robot clean my apartment. It felt like  | mit-tech-review | must_keep | selective | FULL | metadata-only | metadata | non / non | 1946 / 7958 | 0.001495 € | 0.001743 € | PERTINENT |
| A new bill could change how the US builds energy infrastruct | mit-tech-review | must_exclude | selective | FULL | metadata-only | metadata | non / non | 1919 / 7876 | 0.001484 € | 0.001731 € | HORS_SUJET → écarterait |
| The Download: Texas’s fragile AI boom and energy policy shif | mit-tech-review | must_exclude | selective | FULL | metadata-only | aucun appel (règle éditoriale) | non / non | — | 0.000000 € | 0.000000 € | AMBIGU |
| Securing the agentic enterprise with data lineage | mit-tech-review | ambiguous | selective | FULL | metadata-only | metadata | non / non | 1925 / 7894 | 0.001487 € | 0.001733 € | AMBIGU |
| Video Friday: Spot Plays to Show Its Whole-Body Manipulation | ieee-robotics | must_keep | selective | FULL | metadata-only | metadata | non / non | 1976 / 8056 | 0.001507 € | 0.001759 € | PERTINENT |
| Your Robot’s Safety Functions Already Work. What If the Inpu | ieee-robotics | must_keep | selective | FULL | metadata-only | metadata | non / non | 1919 / 7879 | 0.001485 € | 0.001731 € | PERTINENT |
| [SYNTHÉTIQUE] Angular 99.0 introduit l’API fictive deriveSig | synthetic-fixtures | must_keep | selective | FULL | full-allowed | full | oui / oui | 2259 / 8928 | 0.001616 € | 0.001895 € | PERTINENT |
| [SYNTHÉTIQUE] Le laboratoire fictif Orion publie un modèle m | synthetic-fixtures | must_keep | selective | FULL | full-allowed | full | oui / oui | 2198 / 8740 | 0.001593 € | 0.001866 € | PERTINENT |
| [SYNTHÉTIQUE] La spécification fictive MCP 2099-01 ajoute le | synthetic-fixtures | must_keep | selective | FULL | full-allowed | full | oui / oui | 2215 / 8794 | 0.001599 € | 0.001874 € | AMBIGU |
| [SYNTHÉTIQUE] OrchestraJS 3.2 (fictif) : reprise après panne | synthetic-fixtures | must_keep | selective | PARTIAL | full-allowed | excerpt | oui / oui | 2005 / 8147 | 0.001518 € | 0.001773 € | PERTINENT |
| [SYNTHÉTIQUE] La start-up fictive Lumio lève 40 millions d’e | synthetic-fixtures | must_exclude | selective | FULL | full-allowed | full | oui / non | 2111 / 8474 | 0.001559 € | 0.001824 € | HORS_SUJET → écarterait |
| [SYNTHÉTIQUE] Démonstration fictive de 48 qubits logiques av | synthetic-fixtures | must_keep | selective | FULL | full-allowed | full | oui / oui | 2166 / 8643 | 0.001580 € | 0.001850 € | AMBIGU |
| [SYNTHÉTIQUE] Une région fictive encadre l’usage des agents  | synthetic-fixtures | must_keep | selective | PARTIAL | full-allowed | excerpt | oui / oui | 1998 / 8123 | 0.001515 € | 0.001769 € | AMBIGU |
| [SYNTHÉTIQUE] Article d’une source configurée comme bloquée | synthetic-blocked | must_keep | selective | FULL | blocked | aucun appel (bloquée) | non / non | — | 0.000000 € | 0.000000 € | HORS_SUJET → écarterait |
| [SYNTHÉTIQUE] Annonce fictive d’un nouvel outil d’agents de  | synthetic-fixtures | must_keep | selective | MINIMAL | full-allowed | metadata | non / non | 1919 / 7882 | 0.001485 € | 0.001732 € | AMBIGU |

## 4. Coût d’une passe complète (maximum)

| Modèle | Passe complète (éligibles) | Passes possibles dans 0,50 € |
|---|---|---|
| claude-haiku-5-5 | 0.0554 € | 9 |
| gpt-6-luna | 0.0647 € | 7 |

Borne haute maximale : 8928 tokens (plafond par requête : 16000) ✅.

## 5. Protocole de la phase B (préparé, non exécuté)

1. Une passe par modèle candidat sur les publications éligibles, avec le garde **persistant** (`createPersistentGuard`), en périmètre `trial`.
2. Score automatique de la classification contre la vérité terrain : thématiques, type, bande de pertinence, intervalle de nouveauté, décision éditoriale, rubrique.
3. Contrôles automatiques **indicatifs** des résumés (`src/evaluation/summary-checks.ts`), puis **revue manuelle obligatoire** dans `review/phase-b-manual-review.template.json` (grille : `reports/summary-evaluation-grid.md`).
4. Aucun second LLM évaluateur.

## 6. Limites de représentativité

- 39 publications choisies à la main pour couvrir les cas, pas un échantillon aléatoire du flux réel (environ 13 publications par jour).
- Les 30 publications réelles sont en `metadata-only` : seule la classification sur titre et métadonnées y sera mesurée. Les résumés ne seront évalués que sur 7 fixtures synthétiques, courtes et en français, alors que les articles réels sont surtout en anglais.
- La vérité terrain a été rédigée par l’assistant : elle doit être relue, en particulier les 4 décisions `ambiguous` et les 10 publications `hardToClassify`.
