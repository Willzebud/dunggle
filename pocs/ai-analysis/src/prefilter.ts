/**
 * Préfiltrage déterministe LÉGER, en mode observation uniquement.
 * Il réutilise la grille éditoriale du POC 1.2 (pocs/veille-feasibility/src/poc-1-2/editorial-grid.ts).
 * Il n'exclut JAMAIS : il produit une indication `wouldSkip` dont on mesure les faux positifs et les
 * faux négatifs contre la vérité terrain avant toute décision d'activation (PREFILTER_ENABLED = false).
 */
import { gradePublication, SOURCE_DOMAIN_PRIOR, type Verdict } from '../../veille-feasibility/src/poc-1-2/editorial-grid.js';
import type { PublicationInput } from './types.js';

export const PREFILTER_ENABLED = false as const;

export interface PrefilterHint {
  verdict: Verdict;
  wouldSkip: boolean;
  domains: string[];
  note: string;
}

const SKIP_VERDICTS: Verdict[] = ['FINANCE_STARTUP', 'PROMO', 'HORS_SUJET'];

export function prefilterHint(pub: PublicationInput): PrefilterHint {
  const g = gradePublication(pub.title, null, {
    releaseSource: pub.sourceType === 'github-releases',
    sourceDomains: SOURCE_DOMAIN_PRIOR[pub.sourceId],
  });
  return { verdict: g.verdict, wouldSkip: SKIP_VERDICTS.includes(g.verdict), domains: g.domains, note: g.note };
}

export interface PrefilterEvaluation {
  total: number;
  truePositives: number; // bien écartée (vérité terrain : exclue)
  falsePositives: number; // gardée à tort (vérité terrain : exclue, préfiltre : garder)
  falseNegatives: number; // écartée à tort (vérité terrain : à garder) — le cas grave
  trueNegatives: number;
  falseNegativeIds: string[];
  falsePositiveIds: string[];
}

export function evaluatePrefilter(items: { id: string; hint: PrefilterHint; expectedExcluded: boolean }[]): PrefilterEvaluation {
  const r: PrefilterEvaluation = { total: items.length, truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0, falseNegativeIds: [], falsePositiveIds: [] };
  for (const it of items) {
    if (it.hint.wouldSkip && it.expectedExcluded) r.truePositives++;
    else if (!it.hint.wouldSkip && it.expectedExcluded) {
      r.falsePositives++;
      r.falsePositiveIds.push(it.id);
    } else if (it.hint.wouldSkip && !it.expectedExcluded) {
      r.falseNegatives++;
      r.falseNegativeIds.push(it.id);
    } else r.trueNegatives++;
  }
  return r;
}
