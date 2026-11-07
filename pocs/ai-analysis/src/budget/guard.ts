import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_LIMITS, type BudgetLimits } from '../config/budget.js';
import { MODELS, type ModelConfig, type PriceTier } from '../config/models.js';
import type { AnalysisEntry, BudgetStore, LedgerState, Reservation, UncertainEntry } from './store.js';
import { redactDeep, redactSecrets } from '../security/redact.js';
import { POC_PHASES, PRODUCTION_QUOTAS, type PocPhase, type PocPhaseQuotas, boundExceptionFor, consumedBoundExceptions, phaseModelBaseMax, phaseModelMax, phaseTotalBaseMax, phaseTotalMax, type ProductionQuotas, type QuotaContext } from '../config/quotas.js';
import { parisDay, parisMonth } from '../quota/time.js';

export type RefusalCode =
  | 'unknown-pricing'
  | 'model-not-validated'
  | 'request-too-large'
  | 'daily-limit'
  | 'monthly-operational'
  | 'monthly-hard'
  | 'trial-cap'
  | 'invalid-limits'
  | 'unknown-reservation'
  | 'uncertain-pending'
  | 'duplicate-analysis'
  | 'quota-daily'
  | 'quota-monthly'
  | 'quota-run'
  | 'quota-phase-total'
  | 'quota-phase-model'
  | 'quota-phase-inactive';

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
    this.events.push(redactDeep(e));
  }
}

/** Journal JSON Lines (une ligne par événement). Ne contient ni clé, ni contenu de publication. */
export class JsonlUsageLogger implements UsageLogger {
  constructor(private readonly path: string) {}
  async log(e: UsageEvent) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(redactDeep(e))}\n`);
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
    readonly limits: Readonly<BudgetLimits> = DEFAULT_LIMITS,
    private readonly logger: UsageLogger = new MemoryUsageLogger(),
    private readonly now: () => Date = () => new Date(),
    private readonly models: Record<string, ModelConfig> = MODELS,
    readonly productionQuotas: Readonly<ProductionQuotas> = PRODUCTION_QUOTAS,
    /**
     * Table des phases du POC (ouverture `active` et plafonds de base). Défaut : la configuration versionnée
     * POC_PHASES, où toutes les phases sont FERMÉES depuis le 2026-11-07. Injectable uniquement par code (tests de
     * mécanique des quotas), jamais par une donnée d'entrée, un argument CLI ou une variable d'environnement.
     */
    readonly phases: Readonly<Record<PocPhase, Readonly<PocPhaseQuotas>>> = POC_PHASES,
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
    const inputPrice = tier.inputUsdPerMTok * (tier.worstCaseInputMultiplier ?? 1);
    const usd = (inputTokensUpperBound * inputPrice + maxOutputTokens * tier.outputUsdPerMTok) / 1e6;
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
  async reserve(req: { modelKey: string; inputTokensEstimate: number; maxOutputTokens?: number; scope?: 'trial' | 'operational'; idempotencyKey?: string; quota?: QuotaContext }): Promise<Reservation> {
    const scope = req.quota?.scope ?? req.scope ?? 'trial';
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
        // Arrêt sécurisé : aucune nouvelle dépense tant qu'un coût reste incertain.
        const pending = Object.keys(s.uncertain).length;
        if (L.blockWhenUncertain && pending > 0) {
          throw new BudgetRefusedError('uncertain-pending', `${pending} coût(s) incertain(s) non réconcilié(s) : nouvelles analyses bloquées (resolveUncertain requis)`);
        }
        // Idempotence : une même analyse n'est jamais réservée deux fois (doublons, concurrence, relance, scheduler).
        if (req.idempotencyKey && s.analyses[req.idempotencyKey]) {
          throw new BudgetRefusedError('duplicate-analysis', `Analyse déjà ${s.analyses[req.idempotencyKey].status} : ${req.idempotencyKey}`);
        }
        // Quotas d'appels (vérifiés avec le budget, comptés seulement si la réservation est acceptée).
        const commitQuota = req.quota ? this.checkQuota(s, req.quota, req.modelKey, req.idempotencyKey) : null;
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
        const r: Reservation = { id: randomUUID(), modelKey: req.modelKey, scope, estimatedMaxEur: est, inputTokensEstimate: req.inputTokensEstimate, maxOutputTokens: maxOut, month, day, createdAt: at, idempotencyKey: req.idempotencyKey };
        if (req.idempotencyKey) s.analyses[req.idempotencyKey] = { status: 'in-progress', reservationId: r.id, modelKey: req.modelKey, since: at };
        if (commitQuota) r.quota = commitQuota(r.id);
        s.sequence = (s.sequence ?? 0) + 1;
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

  /**
   * Vérifie les quotas et renvoie une fonction qui les incrémente (appelée seulement si la réservation est acceptée).
   * Production (`operational`) : jour et mois Europe/Paris, exécution. POC (`trial`) : compteurs cumulatifs de la phase.
   */
  private checkQuota(s: LedgerState, q: QuotaContext, modelKey: string, idempotencyKey?: string): (reservationId: string) => NonNullable<Reservation['quota']> {
    const now = this.now();
    const dailyKey = `${q.scope}|${parisDay(now)}`;
    const monthlyKey = `${q.scope}|${parisMonth(now)}`;
    const Q = s.quotas;
    const run = Q.runs[q.runId] ?? 0;
    let exceptionId: string | undefined;
    if (q.scope === 'operational') {
      const P = this.productionQuotas;
      if ((Q.daily[dailyKey] ?? 0) >= P.dailyMax) throw new BudgetRefusedError('quota-daily', `Quota quotidien atteint (${P.dailyMax} appels, jour Europe/Paris ${dailyKey.split('|')[1]})`);
      if ((Q.monthly[monthlyKey] ?? 0) >= P.monthlyMax) throw new BudgetRefusedError('quota-monthly', `Quota mensuel atteint (${P.monthlyMax} appels, ${monthlyKey.split('|')[1]})`);
      if (run >= P.perRunMax) throw new BudgetRefusedError('quota-run', `Quota de l’exécution atteint (${P.perRunMax} appels)`);
    } else {
      const P = this.phases[q.phase];
      if (!P?.active) throw new BudgetRefusedError('quota-phase-inactive', `Phase ${q.phase} inactive : aucune réservation possible avant son activation explicite`);
      const ph = Q.phases[q.phase] ?? { total: 0, perModel: {} };
      // Plafonds cumulatifs = base + exceptions versionnées ; le plafond par exécution reste celui de base.
      const totalMax = phaseTotalMax(q.phase);
      const modelMax = phaseModelMax(q.phase, modelKey);
      const used = Q.exceptionsUsed ?? {};
      // Clé d'idempotence `modèle|publication|version du prompt` → publication visée.
      const publicationId = idempotencyKey?.split('|').slice(1, -1).join('|') ?? '';
      const exc = publicationId ? boundExceptionFor(q.phase, modelKey, publicationId, used, Q.runs, q.runId) : null;
      if (ph.total >= totalMax) throw new BudgetRefusedError('quota-phase-total', `Quota de la phase ${q.phase} atteint (${totalMax} appels au total)`);
      if ((ph.perModel[modelKey] ?? 0) >= modelMax) throw new BudgetRefusedError('quota-phase-model', `Quota de la phase ${q.phase} atteint pour ${modelKey} (${modelMax})`);
      if (exc) {
        // Tentative imputée à l'exception liée (une seule fois, pour cette seule publication).
        exceptionId = exc.id;
      } else {
        // Appels ordinaires : plafond de base, hors tentatives imputées aux exceptions liées.
        const ordinaryModel = (ph.perModel[modelKey] ?? 0) - consumedBoundExceptions(q.phase, used, modelKey);
        const ordinaryTotal = ph.total - consumedBoundExceptions(q.phase, used);
        const baseModel = phaseModelBaseMax(q.phase, modelKey);
        const baseTotal = phaseTotalBaseMax(q.phase);
        if (ordinaryTotal >= baseTotal) throw new BudgetRefusedError('quota-phase-total', `Quota de la phase ${q.phase} atteint (${baseTotal} appels ordinaires ; exceptions réservées à leur publication)`);
        if (ordinaryModel >= baseModel) throw new BudgetRefusedError('quota-phase-model', `Quota de la phase ${q.phase} atteint pour ${modelKey} (${baseModel} appels ordinaires ; exception réservée à sa publication)`);
      }
      if (run >= P.totalMax) throw new BudgetRefusedError('quota-run', `Quota de l’exécution atteint (${P.totalMax} appels)`);
    }
    return (reservationId: string) => {
      Q.daily[dailyKey] = (Q.daily[dailyKey] ?? 0) + 1;
      Q.monthly[monthlyKey] = (Q.monthly[monthlyKey] ?? 0) + 1;
      Q.runs[q.runId] = run + 1;
      if (q.scope === 'trial') {
        const ph = (Q.phases[q.phase] ??= { total: 0, perModel: {} });
        ph.total += 1;
        ph.perModel[modelKey] = (ph.perModel[modelKey] ?? 0) + 1;
        if (exceptionId) (Q.exceptionsUsed ??= {})[exceptionId] = { at: new Date(now).toISOString(), runId: q.runId, reservationId, idempotencyKey: idempotencyKey ?? '' };
      }
      return { context: q, dailyKey, monthlyKey, ...(exceptionId ? { exceptionId } : {}) };
    };
  }

  /** Décompte une tentative de quota (requête certainement NON transmise au fournisseur). */
  private refundQuota(s: LedgerState, r: Reservation) {
    if (!r.quota) return;
    const Q = s.quotas;
    const dec = (o: Record<string, number>, k: string) => {
      if (o[k]) o[k] -= 1;
    };
    dec(Q.daily, r.quota.dailyKey);
    dec(Q.monthly, r.quota.monthlyKey);
    dec(Q.runs, r.quota.context.runId);
    if (r.quota.context.scope === 'trial') {
      const ph = Q.phases[r.quota.context.phase];
      if (ph) {
        ph.total = Math.max(0, ph.total - 1);
        dec(ph.perModel, r.modelKey);
      }
      // Requête jamais transmise : l'exception liée redevient disponible.
      if (r.quota.exceptionId && Q.exceptionsUsed?.[r.quota.exceptionId]?.reservationId === r.id) delete Q.exceptionsUsed[r.quota.exceptionId];
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
      if (r.idempotencyKey && s.analyses[r.idempotencyKey]) s.analyses[r.idempotencyKey] = { ...s.analyses[r.idempotencyKey], status: 'completed', costEur: cost };
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
      const u: UncertainEntry = { id, modelKey: r.modelKey, scope: r.scope, chargedEur: r.estimatedMaxEur, month: r.month, reason: redactSecrets(reason), since: at };
      s.uncertain[id] = u;
      if (r.idempotencyKey && s.analyses[r.idempotencyKey]) s.analyses[r.idempotencyKey] = { ...s.analyses[r.idempotencyKey], status: 'uncertain', costEur: r.estimatedMaxEur };
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

  /**
   * Requête certainement NON FACTURÉE : la réservation financière est libérée.
   * `transmitted` : la requête a-t-elle atteint le fournisseur (ex. refus HTTP 4xx) ? Si oui, la tentative
   * reste comptée dans les quotas ; sinon (refus avant envoi), elle est décomptée.
   */
  async release(id: string, reason: string, opts: { transmitted?: boolean } = {}): Promise<void> {
    const { at } = this.keys();
    const r = await this.store.transaction((s) => {
      const res = this.settle(s, id, 0);
      if (!opts.transmitted) this.refundQuota(s, res);
      // Requête certainement non facturée : l'analyse peut être retentée (nouvelle réservation complète).
      if (res.idempotencyKey && s.analyses[res.idempotencyKey]?.status === 'in-progress') delete s.analyses[res.idempotencyKey];
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

  /** Enregistre le résultat validé d'une analyse déjà soldée (completed / uncertain). */
  async recordResult(idempotencyKey: string, result: unknown): Promise<void> {
    await this.store.transaction((s) => {
      const a = s.analyses[idempotencyKey];
      if (!a) throw new BudgetRefusedError('unknown-reservation', `Analyse inconnue : ${idempotencyKey}`);
      a.result = redactDeep(result);
    });
  }

  async getAnalysis(idempotencyKey: string): Promise<AnalysisEntry | undefined> {
    return (await this.store.read()).analyses[idempotencyKey];
  }

  async snapshot(): Promise<LedgerState> {
    return this.store.read();
  }
}
