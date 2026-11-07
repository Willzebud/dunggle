import type { EditorialFlag, NormalizedArticle } from './types.js';

/**
 * Règles éditoriales DÉTERMINISTES, ciblées par source.
 *
 * Principes :
 * - Pas de filtre général par mot-clé : chaque règle porte sur UNE source et un motif de titre précis
 *   correspondant à un format récurrent identifié au POC 1.2.
 * - 'exclude' : la publication est retirée de `articles` mais CONSERVÉE dans `excluded` avec sa trace,
 *   ce qui permet de la récupérer ou d'auditer la règle.
 * - 'flag' : la publication reste dans `articles`, simplement marquée (ex. compilation), sans suppression.
 */
export interface EditorialRule {
  id: string;
  sourceId: string;
  titlePattern: RegExp;
  action: 'exclude' | 'flag';
  kind: EditorialFlag['kind'];
  reason: string;
}

export const EDITORIAL_RULES: EditorialRule[] = [
  {
    id: 'mit-tr-the-download',
    sourceId: 'mit-tech-review',
    titlePattern: /^\s*The Download\s*:/i,
    action: 'exclude',
    kind: 'recurring-digest',
    reason:
      'Digest quotidien « The Download » reprenant des articles déjà publiés par MIT Technology Review (doublon interne, POC 1.2)',
  },
  {
    id: 'ieee-video-friday',
    sourceId: 'ieee-robotics',
    titlePattern: /^\s*Video Friday\b/i,
    action: 'flag',
    kind: 'recurring-digest',
    reason:
      'Compilation hebdomadaire de vidéos « Video Friday » : conservée (peut contenir une démonstration intéressante), à traiter comme compilation et non comme article individuel',
  },
];

export interface EditorialResult {
  kept: NormalizedArticle[];
  excluded: NormalizedArticle[];
}

export function applyEditorialRules(articles: NormalizedArticle[], rules: EditorialRule[] = EDITORIAL_RULES): EditorialResult {
  const kept: NormalizedArticle[] = [];
  const excluded: NormalizedArticle[] = [];
  for (const a of articles) {
    const rule = rules.find((r) => r.sourceId === a.sourceId && r.titlePattern.test(a.title));
    if (!rule) {
      kept.push(a);
      continue;
    }
    const flagged: NormalizedArticle = {
      ...a,
      editorial: { ruleId: rule.id, kind: rule.kind, action: rule.action === 'exclude' ? 'excluded' : 'flagged', reason: rule.reason },
    };
    (rule.action === 'exclude' ? excluded : kept).push(flagged);
  }
  return { kept, excluded };
}
