import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_LIMITS, type BudgetLimits } from '../config/budget.js';
import { MODELS, type ModelConfig, type PriceTier } from '../config/models.js';
import type { BudgetStore, LedgerState, Reservation, UncertainEntry } from './store.js';

export type RefusalCode =
  | 'unknown-pricing'
  | 'model-not-validated'
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
  event: 'reserved' | 'refused' | 'reconciled' | 'uncertain' | 'uncertain-resolved' | 'released' | 'expired' | 'warning';
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
 * Garde budgétaire : estimation maximale → réservation atomique → réconciliation.
 * La comptabilité interne est une estimation prudente : elle ne garantit pas la facture du fournisseur
 * (voir reports/budget-audit.md pour les limites et les protections à configurer chez les fournisseurs).
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

  /**
   * Coût MAXIMAL d'une requête : borne haute d'entrée + sortie au plafond (réflexion comprise),
   * au palier tarifaire le plus cher applicable, × marge, × taux EUR.
   */
  estimateMaxCostEur(modelKey: string, inputTokensUpperBound: number, maxOutputTokens = this.limits.maxOutputTokensPerRequest): number {
    const model = this.models[modelKey];
    if (!model || !model.pricing || !model.verifiedAt) throw new BudgetRefusedError('unknown-pricing', `Tarif inconnu ou non vérifié pour « ${modelKey} » : appel refusé`);
    if (model.validation.status === 'not-validated') {
      throw new BudgetRefusedError('model-not-validated', `Configuration de « ${modelKey} » non validée : ${model.validation.blockers.join(' ; ') || 'voir reports/models-pricing.md'}`);
    }
    if (inputTokensUpperBound > this.limits.maxInputTokensPerRequest) {
      throw new BudgetRefusedError('request-too-large', `Entrée (borne haute) ${inputTokensUpperBound} tokens > plafond ${this.limits.maxInputTokensPerRequest}`);
    }
    if (maxOutputTokens > this.limits.maxOutputTokensPerRequest) {
      throw new BudgetRefusedError('request-too-large', `Sortie demandée ${maxOutputTokens} tokens > plafond ${this.limits.maxOutputTokensPerRequest}`);
    }
    const tier = priceTier(model, inputTokensUpperBound);
    if (!tier) throw new BudgetRefusedError('unknown-pricing', `Aucun palier tarifaire vérifié pour ${inputTokensUpperBound} tokens d’entrée (${modelKey})`);
    const usd = (inputTokensUpperBound * tier.inputUsdPerMTok + maxOutputTokens * tier.outputUsdPerMTok) / 1e6;
    return round6(usd * this.limits.safetyMultiplier * this.limits.eurPerUsd);
  }

  /** Coût réel (sans marge) à partir de l'usage facturable normalisé par l'adaptateur. */
  actualCostEur(modelKey: string, inputTokens: number, outputTokens: number): number {
    const model = this.models[modelKey];
    const tier = model ? priceTier(model, inputTokens) : null;
    if (!tier) throw new BudgetRefusedError('unknown-pricing', `Tarif inconnu pour réconcilier « ${modelKey} »`);
    return round6(((inputTokens * tier.inputUsdPerMTok + outputTokens * tier.outputUsdPerMTok) / 1e6) * this.limits.eurPerUsd);
  }

  /** Mois et jour civils en UTC (les fournisseurs facturent en UTC ; à confirmer sur leur console). */
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
        // spent inclut les coûts incertains (comptés au maximum) et les dépassements constatés (dette).
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

  /** Retire une réservation ouverte et impute `chargeEur` au mois de la réservation. */
  private settle(s: LedgerState, id: string, chargeEur: number): Reservation {
    const r = s.reservations[id];
    if (!r) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
    const m = (s.months[r.month] ??= { spentEur: 0, reservedEur: 0, uncertainEur: 0 });
    m.reservedEur = round6(Math.max(0, m.reservedEur - r.estimatedMaxEur));
    m.spentEur = round6(m.spentEur + chargeEur);
    if (chargeEur > r.estimatedMaxEur) m.overrunEur = round6((m.overrunEur ?? 0) + chargeEur - r.estimatedMaxEur);
    if (r.scope === 'trial') {
      s.trial.reservedEur = round6(Math.max(0, s.trial.reservedEur - r.estimatedMaxEur));
      s.trial.spentEur = round6(s.trial.spentEur + chargeEur);
    }
    delete s.reservations[id];
    return r;
  }

  private async warnIfOverCaps(month: string) {
    const s = await this.store.read();
    const m = s.months[month];
    const { at } = this.keys();
    if (m && m.spentEur > this.limits.monthlyOperationalCapEur) {
      await this.logger.log({ at, event: 'warning', code: 'operational-cap-exceeded', detail: `Dépense comptée ${m.spentEur} € > budget opérationnel : nouvelles analyses bloquées` });
    }
    if (s.trial.spentEur > this.limits.trialTotalCapEur) {
      await this.logger.log({ at, event: 'warning', code: 'trial-cap-exceeded', detail: `Dépense d’essai ${s.trial.spentEur} € > ${this.limits.trialTotalCapEur} € : nouvelles analyses d’essai bloquées` });
    }
  }

  /**
   * Réconciliation avec l'usage réel. Un coût réel supérieur à l'estimation est intégralement
   * enregistré (dette) : les réservations suivantes en tiennent compte et sont refusées si nécessaire.
   */
  async reconcile(id: string, usage: { inputTokens: number; outputTokens: number }): Promise<number> {
    const { at } = this.keys();
    let r!: Reservation;
    const actual = await this.store.transaction((s) => {
      const res = s.reservations[id];
      if (!res) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
      const cost = this.actualCostEur(res.modelKey, usage.inputTokens, usage.outputTokens);
      r = this.settle(s, id, cost);
      return cost;
    });
    await this.logger.log({ at, event: 'reconciled', reservationId: id, modelKey: r.modelKey, actualEur: actual, estimatedMaxEur: r.estimatedMaxEur, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    if (actual > r.estimatedMaxEur) {
      await this.logger.log({ at, event: 'warning', reservationId: id, code: 'actual-exceeds-estimate', detail: `Coût réel ${actual} € > estimation ${r.estimatedMaxEur} € (dette ${round6(actual - r.estimatedMaxEur)} €)` });
      await this.warnIfOverCaps(r.month);
    }
    return actual;
  }

  /**
   * Appel envoyé dont l'usage est inconnu : la réservation n'est PAS libérée. Elle devient une entrée
   * « incertaine », comptée au maximum réservé, qui ne peut être soldée que par resolveUncertain().
   */
  async markUncertain(id: string, reason: string): Promise<number> {
    const { at } = this.keys();
    const entry = await this.store.transaction((s) => {
      const r = s.reservations[id];
      if (!r) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
      this.settle(s, id, r.estimatedMaxEur);
      const m = s.months[r.month];
      m.uncertainEur = round6(m.uncertainEur + r.estimatedMaxEur);
      const u: UncertainEntry = { id, modelKey: r.modelKey, scope: r.scope, chargedEur: r.estimatedMaxEur, month: r.month, reason, since: at };
      s.uncertain[id] = u;
      return u;
    });
    await this.logger.log({ at, event: 'uncertain', reservationId: id, modelKey: entry.modelKey, actualEur: entry.chargedEur, detail: reason });
    return entry.chargedEur;
  }

  /**
   * Solde un coût incertain lorsque l'usage réel est connu (par ex. relevé dans la console du fournisseur).
   * La différence (positive ou négative) est imputée au mois d'origine ; un excédent est enregistré comme dette.
   */
  async resolveUncertain(id: string, usage: { inputTokens: number; outputTokens: number }): Promise<number> {
    const { at } = this.keys();
    let u!: UncertainEntry;
    const actual = await this.store.transaction((s) => {
      const e = s.uncertain[id];
      if (!e) throw new BudgetRefusedError('unknown-reservation', `Coût incertain inconnu ou déjà soldé : ${id}`);
      u = e;
      const cost = this.actualCostEur(e.modelKey, usage.inputTokens, usage.outputTokens);
      const m = (s.months[e.month] ??= { spentEur: 0, reservedEur: 0, uncertainEur: 0 });
      m.spentEur = round6(m.spentEur - e.chargedEur + cost);
      m.uncertainEur = round6(Math.max(0, m.uncertainEur - e.chargedEur));
      if (cost > e.chargedEur) m.overrunEur = round6((m.overrunEur ?? 0) + cost - e.chargedEur);
      if (e.scope === 'trial') s.trial.spentEur = round6(s.trial.spentEur - e.chargedEur + cost);
      delete s.uncertain[id];
      return cost;
    });
    await this.logger.log({ at, event: 'uncertain-resolved', reservationId: id, modelKey: u.modelKey, actualEur: actual, estimatedMaxEur: u.chargedEur });
    if (actual > u.chargedEur) await this.warnIfOverCaps(u.month);
    return actual;
  }

  /** Requête CERTAINEMENT non envoyée (erreur avant transmission) : seule libération sans frais possible. */
  async release(id: string, reason: string): Promise<void> {
    const { at } = this.keys();
    const r = await this.store.transaction((s) => {
      const res = this.settle(s, id, 0);
      const dd = s.days[res.day];
      if (dd) dd.analyses = Math.max(0, dd.analyses - 1);
      return res;
    });
    await this.logger.log({ at, event: 'released', reservationId: id, modelKey: r.modelKey, detail: reason });
  }

  /** Réservations orphelines (processus interrompu) : converties en coûts incertains (jamais libérées). */
  async expireStale(maxAgeMs: number): Promise<string[]> {
    const nowMs = this.now().getTime();
    const stale = Object.values((await this.store.read()).reservations).filter((r) => nowMs - Date.parse(r.createdAt) > maxAgeMs);
    const done: string[] = [];
    for (const r of stale) {
      try {
        await this.markUncertain(r.id, 'réservation orpheline (processus interrompu ?)');
        done.push(r.id);
      } catch (e) {
        if (!(e instanceof BudgetRefusedError && e.code === 'unknown-reservation')) throw e; // soldée entre-temps
      }
    }
    const { at } = this.keys();
    for (const id of done) await this.logger.log({ at, event: 'expired', reservationId: id, detail: 'convertie en coût incertain' });
    return done;
  }

  async snapshot(): Promise<LedgerState> {
    return this.store.read();
  }
}
