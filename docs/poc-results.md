# Résultats des POC

Les études de faisabilité sont **terminées et figées** (état de référence : tag Git local `poc-final`). Elles ont validé la collecte, les politiques de droits et le choix du modèle d'analyse avant toute conception de l'application.

## Synthèse

| Étude | Résultat |
|---|---|
| **POC 1** : collecte | 12/12 sources initiales accessibles, avec des dates fiables ; environ 9 publications par jour |
| **POC 1.1** : extraction de contenu | Niveaux FULL / PARTIAL / MINIMAL. Aucune source n'est exclue faute de contenu |
| **POC 1.2** : élargissement des sources | 8 candidates et 2 variantes testées. 5 sources retenues, pour un total de **17**. Règles éditoriales ciblées par source. Taxonomie validée |
| **POC 2, phases A à B.0.1** : préparation de l'analyse IA | Politiques de droits (toutes les sources en `metadata-only`). Schéma strict. Garde budgétaire (8 € opérationnels, 10 € absolus). Quotas persistants. Sécurité contre l'injection. Aucun appel réel |
| **POC 2, phases B.1 et B.2** : essais réels | Smoke tests, puis évaluation complète (75 appels) de Claude Haiku 5.5 et de GPT-6 Luna. Le biais introduit par les fixtures « fictives » a été identifié |
| **POC 2, phase B3** : test final discriminant | 30 appels, 0,011615 €. Règle de décision figée et revue humaine à l'aveugle : **GPT-6 Luna retenu** (86,61/100). Haiku 5.5 éliminé pour 2 sorties invalides |

Coût total des essais réels : 0,036253 €, sur un budget d'essai de 0,50 €. Les trois phases du POC 2 sont aujourd'hui fermées.

## Décision sur le modèle

**GPT-6 Luna est retenu pour Dunggle selon le protocole B3.** Ce choix vaut pour l'usage testé : tri, classification et résumé en français, avec le prompt `bc786201b88a`. Il ne se généralise pas. Les limites de l'échantillon sont détaillées dans le [rapport B3, § 8](../pocs/ai-analysis/reports/phase-b3-final-test.md#8-résultat-de-b3-et-décision-2026-11-07).

## Décisions établies par les POC

- Une publication n'est **jamais exclue** parce que son contenu est inaccessible. Le niveau de contenu détermine le traitement, pas le filtrage.
- La **disponibilité du contenu** (FULL / PARTIAL / MINIMAL) est distincte de la **pertinence**, que calcule l'IA.
- L'URL originale n'est jamais modifiée : c'est le lien « Lire l'article ». La forme normalisée `dedupKey` sert uniquement à la déduplication.
- Aucune protection n'est contournée : `robots.txt` est respecté, et les pages protégées sont signalées, jamais forcées.
- Les règles éditoriales sont **ciblées par source** (un format récurrent précis), jamais un filtre général par mot-clé. Une exclusion est tracée et la publication reste récupérable.
- Identifiants : l'identifiant natif du flux par défaut, l'URL normalisée en cas de collision ou si la source l'exige (cas de Project Zero).
- Par défaut, une source est en `metadata-only` tant qu'aucune autorisation n'a été vérifiée. La disponibilité du contenu et l'autorisation de le transmettre à une IA restent indépendantes.
- Le budget est réservé avant chaque appel (estimation maximale), puis réconcilié avec l'usage réel. Un coût incertain bloque toute nouvelle dépense.
- La couverture obligatoire (canaux officiels Angular, TypeScript, MCP, frameworks agentiques suivis, Claude Code) est fixée par la source. Elle garantit la visibilité sans forcer la pertinence, et sans neutraliser les politiques de droits, les règles éditoriales ni les doublons.

## Rapports détaillés

**POC 1 : collecte et contenu** ([README](../pocs/veille-feasibility/README.md))
- [Faisabilité de la collecte](../pocs/veille-feasibility/results/feasibility-report.md)
- [Extraction de contenu et niveaux](../pocs/veille-feasibility/results/content-extraction-report.md)
- POC 1.2 : [recommandations](../pocs/veille-feasibility/results/poc-1.2/recommendations.md), [taxonomie](../pocs/veille-feasibility/results/poc-1.2/taxonomy.md), [qualité éditoriale](../pocs/veille-feasibility/results/poc-1.2/editorial-quality-report.md), [estimation du volume](../pocs/veille-feasibility/results/poc-1.2/volume-estimation.md)
- [Données de collecte : ce qui est versionné ou non](../pocs/veille-feasibility/results/README.md)

**POC 2 : analyse IA** ([README](../pocs/ai-analysis/README.md))
- Phase A : [modèles et tarifs](../pocs/ai-analysis/reports/models-pricing.md), [politiques de contenu](../pocs/ai-analysis/reports/content-policy.md), [préparation de l'évaluation](../pocs/ai-analysis/reports/evaluation-readiness.md), [qualité du jeu d'évaluation](../pocs/ai-analysis/reports/evaluation-dataset-quality.md), [grille des résumés](../pocs/ai-analysis/reports/summary-evaluation-grid.md), [proposition de types éditoriaux](../pocs/ai-analysis/reports/editorial-types-proposal.md)
- Budget : [scénarios budgétaires](../pocs/ai-analysis/reports/budget-scenarios.md), [audit budgétaire](../pocs/ai-analysis/reports/budget-audit.md)
- Sécurité et préparation des essais : [audit de sécurité B.0](../pocs/ai-analysis/reports/phase-b-security-audit.md), [préparation de B.1](../pocs/ai-analysis/reports/phase-b1-readiness.md), [préparation de B.2](../pocs/ai-analysis/reports/phase-b2-readiness.md), [incident 429 de B.2](../pocs/ai-analysis/reports/phase-b2-incident-429.md)
- [Audit de B.2, test final B3 et décision](../pocs/ai-analysis/reports/phase-b3-final-test.md)
