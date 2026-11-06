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

export type EditorialDecision = 'must_keep' | 'must_exclude' | 'ambiguous';

/**
 * Évaluation du préfiltre contre la décision éditoriale EXPLICITE de la vérité terrain :
 * - faux négatif : publication `must_keep` que le préfiltre aurait écartée (le cas grave) ;
 * - faux positif : publication `must_exclude` que le préfiltre aurait conservée ;
 * - `ambiguous` : comptés à part (écartés / conservés), sans être des erreurs.
 */
export interface PrefilterEvaluation {
  total: number;
  mustKeep: { total: number; kept: number; falseNegatives: number; falseNegativeIds: string[] };
  mustExclude: { total: number; skipped: number; falsePositives: number; falsePositiveIds: string[] };
  ambiguous: { total: number; skipped: number; kept: number; skippedIds: string[] };
  /** Rappel sur must_keep (part conservée) et précision sur must_exclude (part écartée), ou null si vide. */
  keepRecall: number | null;
  excludeRecall: number | null;
}

export function evaluatePrefilter(items: { id: string; hint: PrefilterHint; decision: EditorialDecision }[]): PrefilterEvaluation {
  const r: PrefilterEvaluation = {
    total: items.length,
    mustKeep: { total: 0, kept: 0, falseNegatives: 0, falseNegativeIds: [] },
    mustExclude: { total: 0, skipped: 0, falsePositives: 0, falsePositiveIds: [] },
    ambiguous: { total: 0, skipped: 0, kept: 0, skippedIds: [] },
    keepRecall: null,
    excludeRecall: null,
  };
  for (const it of items) {
    if (it.decision === 'must_keep') {
      r.mustKeep.total++;
      if (it.hint.wouldSkip) {
        r.mustKeep.falseNegatives++;
        r.mustKeep.falseNegativeIds.push(it.id);
      } else r.mustKeep.kept++;
    } else if (it.decision === 'must_exclude') {
      r.mustExclude.total++;
      if (it.hint.wouldSkip) r.mustExclude.skipped++;
      else {
        r.mustExclude.falsePositives++;
        r.mustExclude.falsePositiveIds.push(it.id);
      }
    } else {
      r.ambiguous.total++;
      if (it.hint.wouldSkip) {
        r.ambiguous.skipped++;
        r.ambiguous.skippedIds.push(it.id);
      } else r.ambiguous.kept++;
    }
  }
  r.keepRecall = r.mustKeep.total ? r.mustKeep.kept / r.mustKeep.total : null;
  r.excludeRecall = r.mustExclude.total ? r.mustExclude.skipped / r.mustExclude.total : null;
  return r;
}
