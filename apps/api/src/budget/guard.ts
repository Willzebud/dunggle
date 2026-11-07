/**
 * Garde budgétaire : estimation maximale → réservation atomique → réconciliation.
 * Copiée du POC 2 (validée par les phases B.1 à B3), réduite au périmètre opérationnel : le budget d'essai, les phases
 * et les exceptions de quota du POC sont supprimés. Le contexte de quota ET la clé d'idempotence sont obligatoires.
 * La comptabilité interne est une estimation prudente : elle ne garantit pas la facture du fournisseur (plafonds à
 * configurer aussi dans la console). Facturation incertaine : voir docs/backend-design.md § 7.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_LIMITS, PRODUCTION_QUOTAS, type BudgetLimits, type ProductionQuotas, type QuotaContext } from '../config/limits.js';
import { MODELS, type ModelConfig, type PriceTier } from '../config/model.js';
import type { AnalysisEntry, BudgetStore, LedgerState, Reservation, UncertainEntry } from './store.js';
import { redactDeep, redactSecrets } from '../security/redact.js';
import { parisDay, parisMonth } from './time.js';

export type RefusalCode =
  | 'unknown-pricing'
  | 'model-not-validated'
  | 'request-too-large'
  | 'daily-limit'
  | 'monthly-operational'
  | 'monthly-hard'
  | 'invalid-limits'
  | 'unknown-reservation'
  | 'uncertain-pending'
  | 'duplicate-analysis'
  | 'quota-daily'
  | 'quota-monthly'
  | 'quota-run'
  | 'missing-context';

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
  estimatedMaxEur?: number;
  actualEur?: number;
  inputTokens?: number;
  outputTokens?: number;
  code?: string;
  detail?: string;
}

/** Journal d'usage (audit) : il ne déclenche jamais de dépense ; le registre fait foi pour l'argent. */
export interface UsageLogger {
  log(e: UsageEvent): Promise<void>;
}

export class MemoryUsageLogger implements UsageLogger {
  readonly events: UsageEvent[] = [];
  async log(e: UsageEvent) {
    this.events.push(redactDeep(e));
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
  if (!(l.safetyMultiplier >= 1)) e.push('La marge de sécurité doit être ≥ 1');
  if (!(l.eurPerUsd > 0)) e.push('Le taux EUR/USD doit être > 0');
  if (!(Number.isInteger(l.dailyMaxAnalyses) && l.dailyMaxAnalyses >= 0)) e.push('Le quota quotidien doit être un entier ≥ 0');
  if (!(l.maxInputTokensPerRequest > 0 && l.maxOutputTokensPerRequest > 0)) e.push('Les plafonds de tokens doivent être > 0');
  return e;
}

export function validateQuotas(q: ProductionQuotas): string[] {
  const e: string[] = [];
  for (const [k, v] of Object.entries(q)) if (!(Number.isInteger(v) && v >= 0)) e.push(`Quota ${k} : entier ≥ 0 attendu`);
  if (q.perRunMax > q.dailyMax || q.dailyMax > q.monthlyMax) e.push('Quotas incohérents : exécution ≤ jour ≤ mois attendu');
  return e;
}

export interface ReserveRequest {
  modelKey: string;
  inputTokensEstimate: number;
  maxOutputTokens?: number;
  /** Une analyse = une clé : elle ne peut être réservée qu'une seule fois (doublons, concurrence, relance). */
  idempotencyKey: string;
  /** Aucun appel hors quotas. */
  quota: QuotaContext;
}

export class BudgetGuard {
  constructor(
    private readonly store: BudgetStore,
    readonly limits: Readonly<BudgetLimits> = DEFAULT_LIMITS,
    private readonly logger: UsageLogger = new MemoryUsageLogger(),
    private readonly now: () => Date = () => new Date(),
    private readonly models: Record<string, ModelConfig> = MODELS,
    readonly productionQuotas: Readonly<ProductionQuotas> = PRODUCTION_QUOTAS,
  ) {
    const errors = [...validateLimits(limits), ...validateQuotas(productionQuotas)];
    if (errors.length) throw new BudgetRefusedError('invalid-limits', errors.join(' ; '));
  }

  /**
   * Coût MAXIMAL d'une requête : borne haute d'entrée + sortie au plafond (raisonnement compris),
   * au palier tarifaire le plus cher applicable, × marge, × taux EUR.
   */
  estimateMaxCostEur(modelKey: string, inputTokensUpperBound: number, maxOutputTokens = this.limits.maxOutputTokensPerRequest): number {
    const model = this.models[modelKey];
    if (!model || !model.pricing || !model.verifiedAt) throw new BudgetRefusedError('unknown-pricing', `Tarif inconnu ou non vérifié pour « ${modelKey} » : appel refusé`);
    if (model.validation.status === 'not-validated') {
      throw new BudgetRefusedError('model-not-validated', `Configuration de « ${modelKey} » non validée : ${model.validation.blockers.join(' ; ') || 'voir config/model.ts'}`);
    }
    if (inputTokensUpperBound > this.limits.maxInputTokensPerRequest) {
      throw new BudgetRefusedError('request-too-large', `Entrée (borne haute) ${inputTokensUpperBound} tokens > plafond ${this.limits.maxInputTokensPerRequest}`);
    }
    if (maxOutputTokens > this.limits.maxOutputTokensPerRequest) {
      throw new BudgetRefusedError('request-too-large', `Sortie demandée ${maxOutputTokens} tokens > plafond ${this.limits.maxOutputTokensPerRequest}`);
    }
    const tier = priceTier(model, inputTokensUpperBound);
    if (!tier) throw new BudgetRefusedError('unknown-pricing', `Aucun palier tarifaire pour ${inputTokensUpperBound} tokens`);
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

  /** Mois et jour civils en UTC pour le budget (les fournisseurs facturent en UTC). */
  private keys() {
    const d = this.now().toISOString();
    return { month: d.slice(0, 7), day: d.slice(0, 10), at: d };
  }

  /** Réserve le coût maximal AVANT tout appel. Refuse (sans rien réserver) si un plafond ou un quota serait dépassé. */
  async reserve(req: ReserveRequest): Promise<Reservation> {
    const maxOut = req.maxOutputTokens ?? this.limits.maxOutputTokensPerRequest;
    const { month, day, at } = this.keys();
    let est: number;
    try {
      if (!req.idempotencyKey || !req.quota?.runId) throw new BudgetRefusedError('missing-context', 'Clé d’idempotence et contexte de quota obligatoires : appel refusé');
      est = this.estimateMaxCostEur(req.modelKey, req.inputTokensEstimate, maxOut);
    } catch (e) {
      if (e instanceof BudgetRefusedError) await this.logger.log({ at, event: 'refused', modelKey: req.modelKey, code: e.code, detail: e.message });
      throw e;
    }
    const L = this.limits;
    try {
      const res = await this.store.transaction((s) => {
        // Arrêt sécurisé : aucune nouvelle dépense tant qu'un coût reste incertain.
        const pending = Object.keys(s.uncertain).length;
        if (L.blockWhenUncertain && pending > 0) {
          throw new BudgetRefusedError('uncertain-pending', `${pending} coût(s) incertain(s) non réconcilié(s) : nouvelles analyses bloquées (rapprochement requis)`);
        }
        // Idempotence : une même analyse n'est jamais réservée deux fois (doublons, concurrence, relance, planificateur).
        if (s.analyses[req.idempotencyKey]) {
          throw new BudgetRefusedError('duplicate-analysis', `Analyse déjà ${s.analyses[req.idempotencyKey].status} : ${req.idempotencyKey}`);
        }
        // Quotas d'appels (vérifiés avec le budget, comptés seulement si la réservation est acceptée).
        const commitQuota = this.checkQuota(s, req.quota);
        const m = (s.months[month] ??= { spentEur: 0, reservedEur: 0, uncertainEur: 0 });
        const dd = (s.days[day] ??= { analyses: 0 });
        if (dd.analyses >= L.dailyMaxAnalyses) throw new BudgetRefusedError('daily-limit', `Quota quotidien atteint (${L.dailyMaxAnalyses} analyses)`);
        // spent inclut les coûts incertains (comptés au maximum) et les dépassements constatés (dette).
        const monthAfter = m.spentEur + m.reservedEur + est;
        if (monthAfter > L.monthlyHardCapEur) throw new BudgetRefusedError('monthly-hard', `Maximum absolu mensuel (${L.monthlyHardCapEur} €) serait dépassé`);
        if (monthAfter > L.monthlyOperationalCapEur) throw new BudgetRefusedError('monthly-operational', `Budget opérationnel mensuel (${L.monthlyOperationalCapEur} €) serait dépassé`);
        const id = randomUUID();
        const r: Reservation = { id, modelKey: req.modelKey, estimatedMaxEur: est, inputTokensEstimate: req.inputTokensEstimate, maxOutputTokens: maxOut, month, day, createdAt: at, idempotencyKey: req.idempotencyKey, quota: commitQuota() };
        s.analyses[req.idempotencyKey] = { status: 'in-progress', reservationId: r.id, modelKey: req.modelKey, since: at };
        s.sequence = (s.sequence ?? 0) + 1;
        m.reservedEur = round6(m.reservedEur + est);
        dd.analyses += 1;
        s.reservations[r.id] = r;
        return r;
      });
      await this.logger.log({ at, event: 'reserved', reservationId: res.id, modelKey: res.modelKey, estimatedMaxEur: est });
      return res;
    } catch (e) {
      if (e instanceof BudgetRefusedError) await this.logger.log({ at, event: 'refused', modelKey: req.modelKey, estimatedMaxEur: est, code: e.code, detail: e.message });
      throw e;
    }
  }

  /** Vérifie les quotas (jour et mois Europe/Paris, exécution) et renvoie une fonction qui les incrémente. */
  private checkQuota(s: LedgerState, q: QuotaContext): () => Reservation['quota'] {
    const now = this.now();
    const dailyKey = parisDay(now);
    const monthlyKey = parisMonth(now);
    const Q = s.quotas;
    const P = this.productionQuotas;
    const run = Q.runs[q.runId] ?? 0;
    if ((Q.daily[dailyKey] ?? 0) >= P.dailyMax) throw new BudgetRefusedError('quota-daily', `Quota quotidien atteint (${P.dailyMax} appels, jour Europe/Paris ${dailyKey})`);
    if ((Q.monthly[monthlyKey] ?? 0) >= P.monthlyMax) throw new BudgetRefusedError('quota-monthly', `Quota mensuel atteint (${P.monthlyMax} appels, ${monthlyKey})`);
    if (run >= P.perRunMax) throw new BudgetRefusedError('quota-run', `Quota de l’exécution atteint (${P.perRunMax} appels)`);
    return () => {
      Q.daily[dailyKey] = (Q.daily[dailyKey] ?? 0) + 1;
      Q.monthly[monthlyKey] = (Q.monthly[monthlyKey] ?? 0) + 1;
      Q.runs[q.runId] = run + 1;
      return { context: { runId: q.runId }, dailyKey, monthlyKey };
    };
  }

  /** Décompte une tentative de quota (requête certainement NON transmise au fournisseur). */
  private refundQuota(s: LedgerState, r: Reservation) {
    const Q = s.quotas;
    const dec = (o: Record<string, number>, k: string) => {
      if (o[k]) o[k] -= 1;
    };
    dec(Q.daily, r.quota.dailyKey);
    dec(Q.monthly, r.quota.monthlyKey);
    dec(Q.runs, r.quota.context.runId);
  }

  /** Retire une réservation ouverte et impute `chargeEur` au mois de la réservation. */
  private settle(s: LedgerState, id: string, chargeEur: number): Reservation {
    const r = s.reservations[id];
    if (!r) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
    const m = (s.months[r.month] ??= { spentEur: 0, reservedEur: 0, uncertainEur: 0 });
    m.reservedEur = round6(Math.max(0, m.reservedEur - r.estimatedMaxEur));
    m.spentEur = round6(m.spentEur + chargeEur);
    if (chargeEur > r.estimatedMaxEur) m.overrunEur = round6((m.overrunEur ?? 0) + chargeEur - r.estimatedMaxEur);
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
      if (s.analyses[r.idempotencyKey]) s.analyses[r.idempotencyKey] = { ...s.analyses[r.idempotencyKey], status: 'completed', costEur: cost };
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
   * Appel dont la facturation est INCERTAINE (5xx, délai dépassé, coupure réseau, réponse sans usage, réservation
   * orpheline) : la réservation n'est PAS libérée. Elle devient une entrée « incertaine », comptée au maximum réservé,
   * qui bloque toute nouvelle dépense jusqu'au rapprochement explicite (resolveUncertain).
   */
  async markUncertain(id: string, reason: string): Promise<number> {
    const { at } = this.keys();
    const entry = await this.store.transaction((s) => {
      const r = s.reservations[id];
      if (!r) throw new BudgetRefusedError('unknown-reservation', `Réservation inconnue ou déjà soldée : ${id}`);
      this.settle(s, id, r.estimatedMaxEur);
      const m = s.months[r.month];
      m.uncertainEur = round6(m.uncertainEur + r.estimatedMaxEur);
      const u: UncertainEntry = { id, modelKey: r.modelKey, chargedEur: r.estimatedMaxEur, month: r.month, reason: redactSecrets(reason), since: at };
      s.uncertain[id] = u;
      if (s.analyses[r.idempotencyKey]) s.analyses[r.idempotencyKey] = { ...s.analyses[r.idempotencyKey], status: 'uncertain', costEur: r.estimatedMaxEur };
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
      delete s.uncertain[id];
      return cost;
    });
    await this.logger.log({ at, event: 'uncertain-resolved', reservationId: id, modelKey: u.modelKey, actualEur: actual, estimatedMaxEur: u.chargedEur });
    if (actual > u.chargedEur) await this.warnIfOverCaps(u.month);
    return actual;
  }

  /**
   * Requête CERTAINEMENT NON FACTURÉE (refus avant envoi, ou refus HTTP 4xx du fournisseur) : la réservation
   * financière est libérée. `transmitted` : la requête a-t-elle atteint le fournisseur ? Si oui, la tentative reste
   * comptée dans les quotas ; sinon (refus avant envoi), elle est décomptée. En cas de doute : markUncertain.
   */
  async release(id: string, reason: string, opts: { transmitted?: boolean } = {}): Promise<void> {
    const { at } = this.keys();
    const r = await this.store.transaction((s) => {
      const res = this.settle(s, id, 0);
      if (!opts.transmitted) this.refundQuota(s, res);
      // Requête certainement non facturée : l'analyse peut être retentée (nouvelle réservation complète).
      if (s.analyses[res.idempotencyKey]?.status === 'in-progress') delete s.analyses[res.idempotencyKey];
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
