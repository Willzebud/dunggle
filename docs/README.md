# Documentation Dunggle

Documentation transverse du projet. Les rapports générés restent à côté du POC qui les produit.

## Rapports de faisabilité

- [POC 1 : faisabilité de la collecte des sources](../pocs/veille-feasibility/results/feasibility-report.md)
- [POC 1.1 : extraction de contenu et niveaux FULL / PARTIAL / MINIMAL](../pocs/veille-feasibility/results/content-extraction-report.md)
- [POC 1.2 : recommandations de sources complémentaires](../pocs/veille-feasibility/results/poc-1.2/recommendations.md) et [taxonomie du POC 2](../pocs/veille-feasibility/results/poc-1.2/taxonomy.md)

- [POC 2 — phase A : modèles et tarifs](../pocs/ai-analysis/reports/models-pricing.md), [politiques de contenu](../pocs/ai-analysis/reports/content-policy.md), [préparation de l’évaluation](../pocs/ai-analysis/reports/evaluation-readiness.md), [scénarios budgétaires](../pocs/ai-analysis/reports/budget-scenarios.md), [audit budgétaire](../pocs/ai-analysis/reports/budget-audit.md), [qualité du jeu d’évaluation](../pocs/ai-analysis/reports/evaluation-dataset-quality.md), [grille des résumés](../pocs/ai-analysis/reports/summary-evaluation-grid.md)

## Documents transverses

- [Réutilisation du contenu : restrictions non résolues](content-reuse.md)

## Décisions établies par les POC

- Une publication n'est **jamais exclue** parce que son contenu est inaccessible. Le niveau de contenu (`contentLevel`) détermine le traitement, pas le filtrage.
- La **disponibilité du contenu** (FULL / PARTIAL / MINIMAL) est distincte de la **pertinence**, qui sera calculée par l'IA au POC 2.
- L'URL originale (`url`) n'est jamais modifiée : c'est le lien « Lire l'article ». La forme normalisée `dedupKey` sert uniquement à la déduplication.
- Aucun contournement de protection : robots.txt est respecté et les pages protégées sont signalées, pas forcées.
- Les règles éditoriales sont **ciblées par source** (un format récurrent précis), jamais un filtre général par mot-clé. Une exclusion est tracée et la publication reste récupérable (`articles.json > excluded`).
- Identifiants : identifiant natif du flux par défaut, URL normalisée en cas de collision ou si la source l'exige (`idStrategy: 'normalized-url'`, cas de Project Zero).
- POC 2 : par défaut, une source est en `metadata-only` tant qu’aucune autorisation n’a été vérifiée. La disponibilité du contenu et l’autorisation de le transmettre à une IA restent indépendantes.
- POC 2 : le budget est réservé avant chaque appel (estimation maximale), puis réconcilié avec l’usage réel. Le budget opérationnel est de 8 €, le maximum absolu de 10 €, le budget d’essai de 0,50 €.
- POC 2 : la couverture obligatoire (canaux officiels Angular, TypeScript, MCP, frameworks agentiques suivis, Claude Code) est fixée par la source. Elle garantit la visibilité sans forcer la pertinence, et sans neutraliser les politiques de contenu, les règles éditoriales ni les doublons.
