/**
 * src/revenue-engines/base.mjs — ChariBaaS RevenueEngine base interface
 *
 * Every revenue engine in the swarm implements this interface. The base class
 * provides:
 *   - Standard lifecycle: init() -> discover() -> earn() -> settle() -> status()
 *   - Safe-by-default observe mode (no real money moves unless LIVE)
 *   - Earning event emitter into .autonomous-offline-store.json (Earning entity)
 *   - Settlement routing through the existing payout pipeline
 *   - Idempotent runs (each earning has a deterministic id)
 *   - Structured logging + JSON status output
 *
 * Subclasses MUST implement:
 *   - _discover()    -> Promise<{opportunities: Array<Opportunity>}>
 *   - _earn(opp)     -> Promise<{earningId, amount, currency, metadata}>
 *   - _settle(earning) -> Promise<{settlementId, gateway_ref, status}>
 *
 * Subclasses MAY override:
 *   - _init()        -> custom initialization (load secrets, connect, etc.)
 *   - _status()      -> custom status report
 *
 * Env vars (read by base class):
 *   REVENUE_ENGINE_MODE    (optional, default "observe") — "observe" | "live"
 *   SWARM_LIVE             (optional, default "false")   — global swarm live flag
 *   REVENUE_STORE_PATH     (optional, default ".autonomous-offline-store.json")
 *   REVENUE_LOG_LEVEL      (optional, default "info")    — "debug" | "info" | "warn" | "error"
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_STORE_PATH = '.autonomous-offline-store.json';
const DEFAULT_LOG_LEVEL = 'info';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export class RevenueEngine {
  /**
   * @param {string} name        Engine slug, e.g. "haio-solana"
   * @param {object} opts
   * @param {string} [opts.version="0.1.0"]
   * @param {string[]} [opts.requiredEnv=[]]  Env vars that MUST be set in live mode
   * @param {string[]} [opts.optionalEnv=[]]  Env vars that MAY be set
   * @param {string} [opts.vendor]            Upstream repo URL
   * @param {string} [opts.description]
   */
  constructor(name, opts = {}) {
    if (!name) throw new Error('RevenueEngine requires a name');
    this.name = name;
    this.version = opts.version || '0.1.0';
    this.vendor = opts.vendor || '';
    this.description = opts.description || '';
    this.requiredEnv = opts.requiredEnv || [];
    this.optionalEnv = opts.optionalEnv || [];
    this._logLevel = LEVELS[process.env.REVENUE_LOG_LEVEL || DEFAULT_LOG_LEVEL] || LEVELS.info;
    this._mode = this._resolveMode();
    this._storePath = process.env.REVENUE_STORE_PATH || DEFAULT_STORE_PATH;
    this._runId = `RUN_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    this._runDir = process.cwd();
    this._initDone = false;
  }

  // ---- Mode resolution ----

  _resolveMode() {
    const explicit = (process.env.REVENUE_ENGINE_MODE || '').toLowerCase();
    if (explicit === 'live' || explicit === 'observe') return explicit;
    // Fall back to swarm-wide flag
    return String(process.env.SWARM_LIVE || '').toLowerCase() === 'true' ? 'live' : 'observe';
  }

  isLive() { return this._mode === 'live'; }
  isObserve() { return this._mode === 'observe'; }

  // ---- Logging ----

  _log(level, msg, extra) {
    if (LEVELS[level] < this._logLevel) return;
    const ts = new Date().toISOString();
    const line = `[${ts}] [${this.name}] [${level.toUpperCase()}] ${msg}`;
    console.log(line);
    if (extra !== undefined) console.log(JSON.stringify(extra, null, 2));
  }
  debug(msg, extra) { this._log('debug', msg, extra); }
  info(msg, extra)  { this._log('info', msg, extra); }
  warn(msg, extra)  { this._log('warn', msg, extra); }
  error(msg, extra) { this._log('error', msg, extra); }

  // ---- Env validation ----

  validateEnv() {
    const missing = this.requiredEnv.filter(k => !process.env[k]);
    if (this.isLive() && missing.length > 0) {
      return {
        ok: false,
        reason: `live mode requires env vars: ${missing.join(', ')}`,
        missing,
      };
    }
    return { ok: true, missing: [] };
  }

  // ---- Store I/O ----

  async _loadStore() {
    if (!existsSync(this._storePath)) {
      return { entities: { Earning: { records: [] } } };
    }
    try {
      const raw = await fs.readFile(this._storePath, 'utf-8');
      const j = JSON.parse(raw);
      if (!j.entities) j.entities = {};
      if (!j.entities.Earning) j.entities.Earning = { records: [] };
      return j;
    } catch (e) {
      this.warn(`store parse error: ${e.message}; starting fresh`);
      return { entities: { Earning: { records: [] } } };
    }
  }

  async _saveStore(store) {
    const tmp = `${this._storePath}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8');
    await fs.rename(tmp, this._storePath);
  }

  // ---- Earning event emission (idempotent) ----

  /**
   * Emit an earning event into the swarm store. Idempotent: re-emitting the
   * same earningId is a no-op.
   *
   * @param {object} e
   * @param {string} e.earningId    Deterministic unique id (engine-owned)
   * @param {number} e.amount       Positive number
   * @param {string} e.currency     ISO 4217 (USD, MAD, USDT, etc.)
   * @param {string} e.source       Engine name (this.name)
   * @param {string} e.beneficiary  Owner email/address
   * @param {object} [e.metadata]   Free-form metadata
   * @returns {Promise<{emitted: boolean, earningId: string}>}
   */
  async emitEarning(e) {
    if (!e.earningId) throw new Error('emitEarning requires earningId');
    if (!e.amount || !(e.amount > 0)) throw new Error('emitEarning requires positive amount');
    if (!e.currency) throw new Error('emitEarning requires currency');

    const store = await this._loadStore();
    const records = store.entities.Earning.records;
    const existing = records.find(r => r.earning_id === e.earningId);
    if (existing) {
      this.debug(`earning ${e.earningId} already emitted; skipping`);
      return { emitted: false, earningId: e.earningId };
    }

    const now = new Date().toISOString();
    const record = {
      id: `offline_Earning_${e.earningId}`,
      created_date: now,
      updated_date: now,
      earning_id: e.earningId,
      amount: Number(e.amount),
      currency: e.currency,
      occurred_at: now,
      source: e.source || this.name,
      beneficiary: e.beneficiary || '',
      status: this.isLive() ? 'pending_settlement' : 'observe_only',
      settlement_id: null,
      metadata: {
        ...(e.metadata || {}),
        engine: this.name,
        engine_version: this.version,
        run_id: this._runId,
        mode: this._mode,
      },
    };
    records.push(record);
    await this._saveStore(store);
    this.info(`emitted earning ${e.earningId}: ${e.amount} ${e.currency} (${this._mode})`);
    return { emitted: true, earningId: e.earningId };
  }

  /**
   * Mark an earning as settled.
   *
   * @param {string} earningId
   * @param {object} settlement
   * @param {string} settlement.settlementId
   * @param {string} settlement.gateway_ref
   * @param {string} settlement.status       "settled" | "failed" | "pending_external_confirmation"
   */
  async markSettled(earningId, settlement) {
    const store = await this._loadStore();
    const r = store.entities.Earning.records.find(r => r.earning_id === earningId);
    if (!r) {
      this.warn(`markSettled: earning ${earningId} not found`);
      return false;
    }
    r.status = settlement.status || 'settled';
    r.settlement_id = settlement.settlementId || null;
    r.updated_date = new Date().toISOString();
    r.metadata = { ...(r.metadata || {}), settlement };
    await this._saveStore(store);
    this.info(`earning ${earningId} marked ${r.status} (gateway_ref=${settlement.gateway_ref || 'n/a'})`);
    return true;
  }

  // ---- Lifecycle hooks (subclasses override) ----

  async _init() { /* override */ }
  async _discover() { return { opportunities: [] }; }
  async _earn(opp) { return null; }
  async _settle(earning) { return { settlementId: null, gateway_ref: null, status: 'observe_only' }; }
  async _status() { return {}; }

  // ---- Public lifecycle ----

  async init() {
    if (this._initDone) return;
    this.info(`init (mode=${this._mode}, version=${this.version})`);
    if (this.vendor) this.info(`vendor: ${this.vendor}`);
    const envCheck = this.validateEnv();
    if (!envCheck.ok) {
      this.warn(`env check failed: ${envCheck.reason}`);
      this._envOk = false;
    } else {
      this._envOk = true;
    }
    if (this._envOk) await this._init();
    this._initDone = true;
  }

  async run() {
    const result = {
      engine: this.name,
      version: this.version,
      run_id: this._runId,
      mode: this._mode,
      started_at: new Date().toISOString(),
      opportunities: 0,
      earned: 0,
      settled: 0,
      earnings: [],
      errors: [],
    };

    try {
      await this.init();
      if (!this._envOk) {
        result.errors.push({ stage: 'init', error: 'env check failed' });
        result.status = 'env_missing';
        result.ended_at = new Date().toISOString();
        return result;
      }

      // Phase 1: discover opportunities
      const { opportunities = [] } = await this._discover();
      result.opportunities = opportunities.length;
      this.info(`discovered ${opportunities.length} opportunities`);

      // Phase 2: earn (emit earning events)
      for (const opp of opportunities) {
        try {
          const earned = await this._earn(opp);
          if (earned) {
            result.earnings.push(earned);
            result.earned++;
          }
        } catch (e) {
          this.warn(`earn failed: ${e.message}`);
          result.errors.push({ stage: 'earn', opportunity: opp.id || '?', error: e.message });
        }
      }

      // Phase 3: settle (only in live mode)
      if (this.isLive()) {
        for (const earned of result.earnings) {
          try {
            const s = await this._settle(earned);
            if (s) result.settled++;
          } catch (e) {
            this.warn(`settle failed: ${e.message}`);
            result.errors.push({ stage: 'settle', earningId: earned.earningId, error: e.message });
          }
        }
      } else {
        this.info('observe mode — skipping settle phase');
      }

      result.status = result.errors.length === 0 ? 'ok' : 'partial';
    } catch (e) {
      result.status = 'fatal';
      result.errors.push({ stage: 'run', error: e.message, stack: e.stack });
      this.error(`fatal: ${e.message}`);
    }

    result.ended_at = new Date().toISOString();
    return result;
  }

  async status() {
    const base = {
      engine: this.name,
      version: this.version,
      mode: this._mode,
      env_ok: this._envOk,
      run_id: this._runId,
    };
    try {
      const extra = await this._status();
      return { ...base, ...extra };
    } catch (e) {
      return { ...base, error: e.message };
    }
  }
}

export default RevenueEngine;
