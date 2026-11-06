import { resolveInput } from '../content-policy.js';
import type { PublicationInput } from '../types.js';

export type EditorialDecision = 'must_keep' | 'must_exclude' | 'ambiguous';
export const DECISIONS: EditorialDecision[] = ['must_keep', 'must_exclude', 'ambiguous'];

/**
 * Règle UNIQUE d'éligibilité à l'IA, partagée par les rapports et les tests :
 * ni source bloquée, ni exclusion éditoriale déterministe.
 */
export function isEligible(pub: PublicationInput): boolean {
  return resolveInput(pub).mode !== 'none' && pub.editorial?.action !== 'excluded';
}

export function decisionCounts(items: { editorialDecision: EditorialDecision }[]): Record<EditorialDecision, number> {
  const c: Record<EditorialDecision, number> = { must_keep: 0, must_exclude: 0, ambiguous: 0 };
  for (const i of items) c[i.editorialDecision]++;
  return c;
}

/** Vérifie qu'un sous-ensemble est cohérent avec l'ensemble : effectifs ≤ et sommes exactes. */
export function subsetConsistencyErrors(
  all: Record<EditorialDecision, number>,
  subset: Record<EditorialDecision, number>,
  sizes: { all: number; subset: number },
): string[] {
  const e: string[] = [];
  for (const d of DECISIONS) if (subset[d] > all[d]) e.push(`${d} : ${subset[d]} éligibles > ${all[d]} au total`);
  const sum = (c: Record<EditorialDecision, number>) => DECISIONS.reduce((s, d) => s + c[d], 0);
  if (sum(all) !== sizes.all) e.push(`somme globale ${sum(all)} ≠ ${sizes.all}`);
  if (sum(subset) !== sizes.subset) e.push(`somme éligible ${sum(subset)} ≠ ${sizes.subset}`);
  if (sizes.subset > sizes.all) e.push('sous-ensemble plus grand que l’ensemble');
  return e;
}
