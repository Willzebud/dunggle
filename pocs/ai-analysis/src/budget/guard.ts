import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_LIMITS, type BudgetLimits } from '../config/budget.js';
import { MODELS, type ModelConfig, type PriceTier } from '../config/models.js';
import type { BudgetStore, LedgerState, Reservation } from './store.js';

export type RefusalCode =
  | 'unknown-pricing'
  | 'request-too-large'
  | 'daily-limit'
  | 'monthly-operational'
  | 'monthly-hard'
  | 'trial-cap'
  | 'invalid-limits'
  | 'unknown-reservation';

export class BudgetRefusedError extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'BudgetRefusedError';
  }
}

export interface UsageEvent {
  at: string;
  event: 'reserved' | 'refused' | 'reconciled' | 'uncertain' | 'released' | 'expired' | 'warning';
  reservationId?: string;
  modelKey?: string;
  scope?: string;
  estimatedMaxEur?: number;
  actualEur?: number;
  inputTokens?: number;
  outputTokens?: number;
  code?: string;
  detail?: string;
}

export interface UsageLogger {
  log(e: UsageEvent): Promise<void>;
}

export class MemoryUsageLogger implements UsageLogger {
  readonly events: UsageEvent[] = [];
  async log(e: UsageEvent) {
    this.events.push(e);
  }
}

/** Journal JSON Lines (une ligne par événement). Ne contient ni clé, ni contenu de publication. */
export class JsonlUsageLogger implements UsageLogger {
  constructor(private readonly path: string) {}
  async log(e: UsageEvent) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(e)}\n`);
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function priceTier(model: ModelConfig, inputTokens: number): PriceTier | null {
  if (!model.pricing) return null;
  return model.pricing.find((t) => t.maxInputTokens === null || inputTokens <= t.maxInputTokens) ?? null;
}

export function validateLimits(l: BudgetLimits): string[] {
  const e: string[] = [];
  if (!(l.monthlyOperationalCapEur > 0 && l.monthlyOperationalCapEur <= l.monthlyHardCapEur)) e.push('Le budget opérationnel doit être > 0 et ≤ au maximum absolu');
  if (!(l.trialTotalCapEur >= 0 && l.trialTotalCapEur <= l.monthlyOperationalCapEur)) e.push('Le budget d’essai doit être ≤ au budget opérationnel');
  if (!(l.safetyMultiplier >= 1)) e.push('La marge de sécurité doit être ≥ 1');
  if (!(l.eurPerUsd > 0)) e.push('Le taux EUR/USD doit être > 0');
  if (!(Number.isInteger(l.dailyMaxAnalyses) && l.dailyMaxAnalyses >= 0)) e.push('Le quota quotidien doit être un entier ≥ 0');
  if (!(l.maxInputTokensPerRequest > 0 && l.maxOutputTokensPerRequest > 0)) e.push('Les plafonds de tokens doivent être > 0');
  return e;
}

/**
 * Garde budgétaire : estimation prudente → réservation atomique → réconciliation.
 * La comptabilité interne est une estimation prudente : elle ne garantit pas la facture du fournisseur.
 */
export class BudgetGuard {
  constructor(
    private readonly store: BudgetStore,
    readonly limits: BudgetLimits = DEFAULT_LIMITS,
    private readonly logger: UsageLogger = new MemoryUsageLogger(),
    private readonly now: () => Date = () => new Date(),
    private readonly models: Record<string, ModelConfig> = MODELS,
  ) {
    const errors = validateLimits(limits);
    if (errors.length) throw new BudgetRefusedError('invalid-limits', errors.join(' ; '));
  }

  /** Coût MAXIMAL prudent d'une requête : entrée estimée + sortie au plafond, × marge, × taux EUR. */
  estimateMaxCostEur(modelKey: string, inputTokensEstimate: number, maxOutputTokens = this.limits.maxOutputTokensPerRequest): number {
    const model = this.models[modelKey];
    if (!model || !model.pricing || !model.verifiedAt) throw new BudgetRefusedError('unknown-pricing', `Tarif inconnu ou non vérifié pour « ${modelKey} » : appel refusé`);
    if (inputTokensEstimate > this.limits.maxInputTokensPerRequest) {
      throw new BudgetRefusedError('request-too-large', `Entrée estimée ${inputTokensEstimate} tokens > plafond ${this.limits.maxInputTokensPerRequest}`);
    }
    if (maxOutputTokens > this.limits.maxOutputTokensPerRequest) {
      throw new BudgetRefusedError('request-too-large', `Sortie demandée ${maxOutputTokens} tokens > plafond ${this.limits.maxOutputTokensPerRequest}`);
    }
    const tier = priceTier(model, inputTokensEstimate);
    if (!tier) throw new BudgetRefusedError('unknown-pricing', `Aucun palier tarifaire vérifié pour ${inputTokensEstimate} tokens d’entrée (${modelKey})`);
    const usd = (inputTokensEstimate * tier.inputUsdPerMTok + maxOutputTokens * tier.outputUsdPerMTok) / 1e6;
    return round6(usd * this.limits.safetyMultiplier * this.limits.eurPerUsd);
  }

  actualCostEur(modelKey: string, inputTokens: number, outputTokens: number): number {
    const model = this.models[modelKey];
    const tier = model ? priceTier(model, inputTokens) : null;
    if (!tier) throw new BudgetRefusedError('unknown-pricing', `Tarif inconnu pour réconcilier « ${modelKey} »`);
    return round6(((inputTokens * tier.inputUsdPerMTok + outputTokens * tier.outputUsdPerMTok) / 1e6) * this.limits.eurPerUsd);
  }

  private keys() {
    const d = this.now().toISOString();
    return { month: d.slice(0, 7), day: d.slice(0, 10), at: d };
  }

  /** Réserve le coût maximal AVANT tout appel. Refuse (sans rien réserver) si un plafond serait dépassé. */
  async reserve(req: { modelKey: string; inputTokensEstimate: number; maxOutputTokens?: number; scope?: 'trial' | 'operational' }): Promise<Reservation> {
    const scope = req.scope ?? 'trial';
    const maxOut = req.maxOutputTokens ?? this.limits.maxOutputTokensPerRequest;
    const { month, day, at } = this.keys();
    let est: number;
    try {
      est = this.estimateMaxCostEur(req.modelKey, req.inputTokensEstimate, maxOut);
    } catch (e) {
      if (e instanceof BudgetRefusedError) await this.logger.log({ at, event: 'refused', modelKey: req.modelKey, scope, code: e.code, detail: e.message });
      throw e;
    }
    const L = this.limits;
    try {
      const res = await this.store.transaction((s) => {
        const m = (s.months[month] ??= { spentEur: 0, reservedEur: 0, uncertainEur: 0 });
        const dd = (s.days[day] ??= { analyses: 0 });
        if (dd.analyses >= L.dailyMaxAnalyses) throw new BudgetRefusedError('daily-limit', `Quota quotidien atteint (${L.dailyMaxAnalyses} analyses)`);
        const monthAfter = m.spentEur + m.reservedEur + est;
        if (monthAfter > L.monthlyHardCapEur) throw new BudgetRefusedError('monthly-hard', `Maximum absolu mensuel (${L.monthlyHardCapEur} €) serait dépassé`);
        if (monthAfter > L.monthlyOperationalCapEur) throw new BudgetRefusedError('monthly-operational', `Budget opérationnel mensuel (${L.monthlyOperationalCapEur} €) serait dépassé`);
        if (scope === 'trial' && s.trial.spentEur + s.trial.reservedEur + est > L.trialTotalCapEur) {
          throw new BudgetRefusedError('trial-cap', `Budget d’essai du POC (${L.trialTotalCapEur} €) serait dépassé`);
        }
        const r: Reservation = { id: randomUUID(), modelKey: req.modelKey, scope, estimatedMaxEur: est, inputTokensEstimate: req.inputTokensEstimate, maxOutputTokens: maxOut, month, day, createdAt: at };
        m.reservedEur = round6(m.reservedEur + est);
        if (scope === 'trial') s.trial.reservedEur = round6(s.trial.reservedEur + est);
        dd.analyses += 1;
        s.reservations[r.id] = r;
        return r;
      });
      await this.logger.log({ at, event: 'reserved', reservationId: res.id, modelKey: res.modelKey, scope, estimatedMaxEur: est });
      return res;
    } catch (e) {
      if (e instanceof BudgetRefusedError) await this.logger.log({ at, event: 'refused', modelKey: req.modelKey, scope, estimatedMaxEur: est, code: e.code, detail: e.message });
      throw e;
    }
  }

  private settle(s: LedgerState, id: string, chargeEur: number, uncertain: boolean): Reservation {
    const r = s.reservations[id];
    if (!r) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
    const m = (s.months[r.month] ??= { spentEur: 0, reservedEur: 0, uncertainEur: 0 });
    m.reservedEur = round6(Math.max(0, m.reservedEur - r.estimatedMaxEur));
    m.spentEur = round6(m.spentEur + chargeEur);
    if (uncertain) m.uncertainEur = round6(m.uncertainEur + chargeEur);
    if (r.scope === 'trial') {
      s.trial.reservedEur = round6(Math.max(0, s.trial.reservedEur - r.estimatedMaxEur));
      s.trial.spentEur = round6(s.trial.spentEur + chargeEur);
    }
    delete s.reservations[id];
    return r;
  }

  /** Réconciliation avec l'usage réel renvoyé par le fournisseur. */
  async reconcile(id: string, usage: { inputTokens: number; outputTokens: number }): Promise<number> {
    const { at } = this.keys();
    let modelKey = '';
    let estimated = 0;
    const actual = await this.store.transaction((s) => {
      const r = s.reservations[id];
      if (!r) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
      modelKey = r.modelKey;
      estimated = r.estimatedMaxEur;
      const cost = this.actualCostEur(r.modelKey, usage.inputTokens, usage.outputTokens);
      this.settle(s, id, cost, false);
      return cost;
    });
    await this.logger.log({ at, event: 'reconciled', reservationId: id, modelKey, actualEur: actual, estimatedMaxEur: estimated, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    if (actual > estimated) await this.logger.log({ at, event: 'warning', reservationId: id, code: 'actual-exceeds-estimate', detail: `Coût réel ${actual} € > estimation ${estimated} €` });
    return actual;
  }

  /** Erreur fournisseur dont l'usage est inconnu : on facture le maximum réservé, marqué « incertain ». */
  async markUncertain(id: string, reason: string): Promise<number> {
    const { at } = this.keys();
    const r = await this.store.transaction((s) => {
      const res = s.reservations[id];
      if (!res) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
      return this.settle(s, id, res.estimatedMaxEur, true);
    });
    await this.logger.log({ at, event: 'uncertain', reservationId: id, modelKey: r.modelKey, actualEur: r.estimatedMaxEur, detail: reason });
    return r.estimatedMaxEur;
  }

  /** Requête certainement non envoyée (erreur avant transmission) : la réservation est libérée sans frais. */
  async release(id: string, reason: string): Promise<void> {
    const { at } = this.keys();
    const r = await this.store.transaction((s) => {
      const res = this.settle(s, id, 0, false);
      const dd = s.days[res.day];
      if (dd) dd.analyses = Math.max(0, dd.analyses - 1);
      return res;
    });
    await this.logger.log({ at, event: 'released', reservationId: id, modelKey: r.modelKey, detail: reason });
  }

  /** Réservations orphelines (processus interrompu) : facturées au maximum, marquées incertaines. */
  async expireStale(maxAgeMs: number): Promise<string[]> {
    const { at } = this.keys();
    const nowMs = this.now().getTime();
    const ids = await this.store.transaction((s) => {
      const stale = Object.values(s.reservations).filter((r) => nowMs - Date.parse(r.createdAt) > maxAgeMs);
      for (const r of stale) this.settle(s, r.id, r.estimatedMaxEur, true);
      return stale.map((r) => r.id);
    });
    for (const id of ids) await this.logger.log({ at, event: 'expired', reservationId: id, detail: 'réservation orpheline facturée au maximum' });
    return ids;
  }

  async snapshot(): Promise<LedgerState> {
    return this.store.read();
  }
}
