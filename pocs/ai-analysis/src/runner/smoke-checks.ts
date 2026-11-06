/**
 * Vérifications automatiques d'un smoke test (après exécution réelle, en phase B.1).
 * Les contrôles de résumé sont INDICATIFS ; la revue manuelle reste obligatoire.
 */
import { autoCheckSummary } from '../evaluation/summary-checks.js';
import type { AnalysisRecord, PublicationInput } from '../types.js';

export interface SmokeGroundTruth {
  themes: string[];
  types: string[];
  relevance: 'high' | 'medium' | 'low';
  novelty: [number, number];
  sections: string[];
  referenceFacts?: string[];
  forbiddenClaims?: string[];
}

export interface SmokeCheck {
  check: string;
  ok: boolean | null;
  detail: string;
}

const BANDS = { high: [70, 100], medium: [40, 69], low: [0, 39] } as const;

export function smokeChecks(rec: AnalysisRecord, pub: PublicationInput, gt: SmokeGroundTruth, reservedMaxEur: number): SmokeCheck[] {
  const c: SmokeCheck[] = [];
  const raw = (rec.usage?.raw ?? {}) as Record<string, any>;
  c.push({ check: 'Authentification et appel', ok: rec.status !== 'provider-error' || !/auth|401|403/.test(rec.error ?? ''), detail: rec.error ?? 'aucune erreur' });
  c.push({ check: 'Schéma JSON valide', ok: rec.status === 'analyzed', detail: rec.status });
  const a = rec.analysis;
  if (a) {
    const [lo, hi] = BANDS[gt.relevance];
    c.push({ check: 'Thématiques', ok: gt.themes.every((t) => a.themes.includes(t as never)), detail: a.themes.join(', ') });
    c.push({ check: 'Type', ok: gt.types.includes(a.type), detail: a.type });
    c.push({ check: 'Pertinence', ok: a.relevance >= lo && a.relevance <= hi, detail: `${a.relevance} (attendu ${gt.relevance})` });
    c.push({ check: 'Nouveauté', ok: a.novelty >= gt.novelty[0] && a.novelty <= gt.novelty[1], detail: `${a.novelty} (attendu ${gt.novelty.join('–')})` });
    c.push({ check: 'Rubrique', ok: gt.sections.includes(rec.section), detail: rec.section });
    for (const s of autoCheckSummary({ summary: a.summary, keyPoints: a.keyPoints, sourceText: pub.text ?? null, title: pub.title, summaryExpected: true, kept: true, excerptLimited: false, referenceFacts: gt.referenceFacts, forbiddenClaims: gt.forbiddenClaims })) {
      c.push({ check: `Résumé — ${s.criterion}${s.indicative ? ' (indicatif)' : ''}`, ok: s.verdict === 'n/a' ? null : s.verdict === 'pass', detail: s.detail });
    }
  }
  const b = rec.usage?.billable;
  c.push({ check: 'Tokens facturés relevés', ok: !!b, detail: b ? `entrée ${b.inputTokens}, sortie ${b.outputTokens}, raisonnement ${b.reasoningTokens ?? 'n/d'}` : 'usage absent' });
  const cacheWrites = (raw.cache_creation_input_tokens ?? 0) + (raw.input_tokens_details?.cache_write_tokens ?? 0);
  c.push({ check: 'Aucun coût d’écriture en cache', ok: cacheWrites === 0, detail: `écritures en cache : ${cacheWrites}` });
  c.push({ check: 'Coût réel ≤ maximum réservé', ok: rec.costEur !== null && !rec.costUncertain && rec.costEur <= reservedMaxEur, detail: `${rec.costEur} € / ${reservedMaxEur} €${rec.costUncertain ? ' (INCERTAIN)' : ''}` });
  return c;
}
