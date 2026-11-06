# POC 1.2 — Audit des sources existantes et sources candidates

> Document rédigé à partir des rapports des POC 1 et 1.1 (`../feasibility-report.md`, `../content-extraction-report.md`) et des 120 publications de `../articles.json`.

## 1. Audit des 12 sources existantes

| Domaine | Sources | Couverture constatée | Lacunes |
|---|---|---|---|
| **Angular** (A) | Angular Blog, angular/angular, angular/components | Releases suivies finement (~4,7/semaine, beta/RC compris). Le blog est devenu un **récapitulatif hebdomadaire** sur Medium | **TypeScript** : aucune source, alors que TS conditionne les versions d'Angular (TS 7 est cité dans le blog Angular). RxJS : pas de source, mais quasiment aucune release. RFC Angular : GitHub Discussions, accessibles seulement par l'API GraphQL avec token |
| **IA** (B) | OpenAI, DeepMind, Hugging Face, Google Research | Grands modèles et recherche appliquée bien suivis. **OpenAI News est bruyant** : sur 10 publications, 3 témoignages clients et 2 acquisitions ou annonces corporate | Pas de flux officiel exploitable pour Anthropic, Meta ou Mistral (non retesté ici). Peu de **regard extérieur** ou analytique |
| **Agents IA** (C) | Simon Willison, OpenAI Agents SDK, LangGraph, MCP TS SDK, Claude Code | Frameworks et outils de développement bien suivis par leurs releases, plus une veille experte (Simon Willison) | Peu d'analyse sur les **usages réels** et l'impact des agents sur le travail |
| **Quantique** (D) | — | Aucune publication dans l'échantillon | Aucune source |
| **Robotique** (D) | — (DeepMind « Gemini for Robotics », NVIDIA Cosmos sur HF) | Seulement à travers l'IA | Aucune source dédiée |
| **Cybersécurité** (D) | — (OpenAI « GPT-6 Cyber », HF « CWE-bench ») | Seulement IA × sécurité | Aucune source sur la recherche de vulnérabilités |
| **Matériel** (D) | — | Rien | Aucune source |
| **Prospective** (E) | Google Research (« Does better work… »), OpenAI (éducation) | Marginale et vue par les éditeurs eux-mêmes | Aucune analyse indépendante |

**Risques de doublons identifiés** :
- angular/angular et angular/components publient au même rythme (versions alignées).
- Le récapitulatif du blog Angular reprend des fonctionnalités déjà visibles dans les releases.
- Les annonces de modèles OpenAI et Google sont reprises par les médias, d'où un risque élevé avec tout média IA ajouté.

**Domaines qui justifient une nouvelle source** : TypeScript (priorité maximale, lacune nette), cybersécurité, robotique, prospective IA et travail. Le quantique et le matériel justifient un test, mais une seule source suffirait. Aucun ajout n'est nécessaire en IA générale ni en agents. Les 12 sources existantes ne sont pas modifiées.

## 2. Sources candidates (8, plus 2 variantes testées après revue)

| # | Source | Accès | Type | Domaine visé | Justification |
|---|---|---|---|---|---|
| 1 | **TypeScript Blog** (Microsoft) | RSS `devblogs.microsoft.com/typescript/feed/` | Officiel | A — TypeScript | Comble la principale lacune Angular ; annonces beta, RC et versions majeures |
| 2 | **IEEE Spectrum** | RSS `spectrum.ieee.org/feeds/feed.rss` | Média spécialisé (IEEE) | D — robotique, matériel, quantique | Seul média d'ingénieurs couvrant largement le matériel et la robotique |
| 2a | IEEE Spectrum — Robotics | RSS `/feeds/topic/robotics.rss` | Variante | D — robotique | Testée car le flux principal s'est révélé trop bruyant |
| 2b | IEEE Spectrum — Semiconductors | RSS `/feeds/topic/semiconductors.rss` | Variante | D — matériel | Même raison |
| 3 | **Quanta Magazine** | RSS `quantamagazine.org/feed/` | Média scientifique | D — percées en informatique et quantique | Vulgarisation de haut niveau des percées en recherche |
| 4 | **Google Project Zero** | Atom découvert : `projectzero.google/feed.xml` | Laboratoire de recherche | D — cybersécurité | Référence de la recherche offensive ; analyses techniques de fond |
| 5 | **MIT Technology Review** | RSS `technologyreview.com/feed/` | Média spécialisé | E — prospective, IA, robotique | Analyse de l'impact des technologies, indépendante des éditeurs |
| 6 | **The Quantum Insider** | RSS `thequantuminsider.com/feed/` | Média spécialisé quantique | D — quantique | Seul média dédié au quantique testé ; test du bruit business |
| 7 | **Ars Technica** | RSS `feeds.arstechnica.com/arstechnica/index` | Média tech de qualité | D — sécurité, produits | Test d'un média tech généraliste reconnu |
| 8 | **One Useful Thing** (Ethan Mollick, Wharton) | RSS Substack `oneusefulthing.org/feed` | Analyste / chercheur | E — IA et travail ; C — agents | Analyses empiriques de l'IA au travail, faible volume |

Écartés sans test :
- **Agrégateurs** (Hacker News, Techmeme, Product Hunt) : trop bruyants et redondants, conformément à la consigne.
- **TechCrunch** : orienté levées de fonds.
- **arXiv quant-ph et cs.\*** : volume massif, contraire à « pas de collecte massive ».
- **Flux CISA, GitHub Advisories** : avis de sécurité unitaires, très nombreux, qui relèvent d'un outil de sécurité plutôt que de la veille.

Les résultats sont dans `sources-test-report.md`, `editorial-quality-report.md` et `manual-review.json`.
