# POC 2 — Qualité du jeu d’évaluation (phase A.1)

> Généré par `npm run prepare:eval` le 2026-11-06. Vérité terrain révisée : 2026-11-06 (préparation B.2 : Gemini 4 Carbon aligné sur Genie 4).

## Composition

| Dimension | Répartition |
|---|---|
| Origine | réelle (métadonnées seules) 30, synthétique 9 |
| Décision éditoriale | must_keep 30, must_exclude 5, ambiguous 4 |
| Couverture | mandatory 11, selective 28 |
| Classification difficile (hardToClassify) | non 29, oui 10 |
| Niveau de contenu | FULL 22, PARTIAL 13, MINIMAL 4 |
| Bande de pertinence | medium 16, high 13, low 10 |
| Thématique principale attendue | ANGULAR 8, AI 8, (aucune : exclusion) 7, DIGITAL_INNOVATION 7, AI_AGENTS 9 |
| Type principal attendu | release 12, feature 3, product 9, prospective_analysis 7, research 4, security_advisory 1, technical_analysis 2, breakthrough 1 |
| Résumé attendu | false 33, true 6 |

## Indépendance des dimensions (exemples présents dans le jeu)

- Couverture obligatoire avec pertinence moyenne : 7 publications (aucune pertinence forcée à 70+).
- Couverture obligatoire et nouveauté faible (≤ 2) : 9.
- `must_keep` difficiles à classer : 6 (la décision n’est pas déduite de la difficulté).
- Résumé autorisé mais non attendu (exclusion) : 1 (`synthetic:lumio-funding`, test dédié au comportement d’exclusion).

## Contrôles de cohérence

✅ Aucune incohérence entre décision éditoriale, exclusions acceptables, couverture, rubriques et résumés.

## Journal des modifications de la vérité terrain

- Ajout de editorialDecision (must_keep / must_exclude / ambiguous), choisi explicitement par publication.
- Renommage de ambiguous → hardToClassify (difficulté de classification, distincte de la décision éditoriale).
- Ajout de coveragePolicy (déterministe, par source) et de summaryAllowed ; summaryExpected redéfini.
- gh-angular:435859328 : relevance high → medium
- gh-openai-agents:413354170 : relevance high → medium
- gh-mcp-ts-sdk:422181946 : relevance high → medium
- gh-claude-code:433257014 : relevance high → medium
- synthetic:lumio-funding : summaryExpected true → false
- synthetic:regional-agents-rules : summaryExpected true → "if-kept"
- mit-tech-review:…?p=1144908 (« The Download ») : acceptableExclusions [null] → ["duplicate"] (digest reprenant des articles déjà publiés ; cohérence avec must_exclude)
- synthetic:regional-agents-rules : editorialDecision ambiguous → must_keep (réglementation à impact concret sur les agents : dans le périmètre E ; reste hardToClassify), summaryExpected if-kept → true
- Préparation B.2 — règle des types validée par l’utilisateur (événement dominant ; voir reports/editorial-types-proposal.md). Modifications justifiées par le contenu, indépendamment des sorties des modèles :
- synthetic:orion-multimodal : types ['research', 'product'] → ['product', 'release', 'research'] (événement dominant : modèle rendu accessible (poids ouverts) → product ; le texte cite « la version précédente du même laboratoire » → release acceptable ; rapport technique → research acceptable)
- deepmind-blog:https://deepmind.google/blog/gemini-4-carbon-o : types ['product', 'research'] → ['product', 'release', 'research'] (nouveau modèle accessible → product ; « Gemini 4 » : nouvelle version d'une famille existante → release acceptable)
- huggingface-blog:https://huggingface.co/blog/nvidia/cosmos-i : types ['product', 'research'] → ['product', 'release', 'research'] (« Cosmos 3 Open Models » : modèles ouverts → product ; nouvelle version d'une famille existante → release acceptable)
- ieee-robotics:https://spectrum.ieee.org/video-friday-whole-b : types ['product', 'research'] → ['research', 'product'] (démonstration de manipulation corps entier dont la disponibilité n'est pas établie → research en principal (règle Video Friday))
- Vérification éditoriale avant B.2 (une comparaison avec un modèle antérieur ou un simple numéro de version ne prouve pas une release) :
- deepmind-blog:https://deepmind.google/blog/gemini-4-carbon-o : types ["product","release","research"] → ["product","research"] (titre seul (MINIMAL) ; le numéro « 4 » ne suffit pas à établir une nouvelle version d’un modèle existant)
- huggingface-blog:https://huggingface.co/blog/nvidia/cosmos-i : types ["product","release","research"] → ["product","research"] (titre seul (MINIMAL) ; « Open Models » établit la mise à disposition (product), mais le numéro « 3 » ne suffit pas à établir une release)
- synthetic:orion-multimodal : types ["product","release","research"] → ["product","research"] (le texte compare le score d’OrionVision à « la version précédente du même laboratoire » sans présenter OrionVision comme une nouvelle version d’un modèle existant ; une comparaison ne suffit pas)
- ieee-robotics:…video-friday-whole-body-manipulation : inchangé ["research","product"] (titre : démonstration de manipulation ; disponibilité de la capacité non établie)
- Vérification Gemini 4 Carbon / Genie 4 (même règle : research si la disponibilité n’est pas établie par les métadonnées) :
- deepmind-blog:https://deepmind.google/blog/gemini-4-carbon-o : types ["product","research"] → ["research","product"] (titre seul « Gemini 4 Carbon: Our next frontier model » : annonce d’un modèle sans disponibilité établie (ni API, ni poids, ni accès) ; aligné sur Genie 4)
- deepmind-blog:https://deepmind.google/blog/genie-4-a-new-gen : inchangé ["research","product"] (titre seul « Genie 4: A new generation of world simulation » : disponibilité non établie)

## Sources à couverture obligatoire

- `angular-blog` : Blog officiel Angular
- `gh-angular` : Releases angular/angular
- `gh-angular-components` : Releases angular/components
- `typescript-blog` : Annonces officielles TypeScript
- `gh-openai-agents` : Releases OpenAI Agents SDK (framework agentique suivi)
- `gh-langgraph` : Releases LangGraph (framework agentique suivi)
- `gh-mcp-ts-sdk` : Releases MCP TypeScript SDK
- `gh-claude-code` : Releases Claude Code (outil de développement assisté par IA)
