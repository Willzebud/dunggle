# POC 2 — Qualité du jeu d’évaluation (phase A.1)

> Généré par `npm run prepare:eval` le 2026-11-06. Vérité terrain révisée : 2026-11-06 (phase A.1).

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
| Type principal attendu | release 12, feature 3, product 10, prospective_analysis 7, research 3, security_advisory 1, technical_analysis 2, breakthrough 1 |
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

## Sources à couverture obligatoire

- `angular-blog` : Blog officiel Angular
- `gh-angular` : Releases angular/angular
- `gh-angular-components` : Releases angular/components
- `typescript-blog` : Annonces officielles TypeScript
- `gh-openai-agents` : Releases OpenAI Agents SDK (framework agentique suivi)
- `gh-langgraph` : Releases LangGraph (framework agentique suivi)
- `gh-mcp-ts-sdk` : Releases MCP TypeScript SDK
- `gh-claude-code` : Releases Claude Code (outil de développement assisté par IA)
