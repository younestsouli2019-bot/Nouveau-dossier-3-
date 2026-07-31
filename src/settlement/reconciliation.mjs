import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const STATE_PATH = path.join(ROOT, 'data', 'settlement', 'reconciliation-state.json');
const QUARANTINE_PATH = path.join(ROOT, 'data', 'settlement', 'quarantine.json');

class ReconciliationEngine {
  constructor() {
    this.state = null;
  }

  async init() {
    mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    if (!existsSync(STATE_PATH)) {
      this.state = { matches: [], mismatches: [], quarantine: [] };
      await this._persist();
    } else {
      this.state = JSON.parse(await fs.readFile(STATE_PATH, 'utf-8'));
      this.state.quarantine = this.state.quarantine || [];
    }
    return this;
  }

  async _persist() {
    const tmp = STATE_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tmp, STATE_PATH);
  }

  async _persistQuarantine() {
    const tmp = QUARANTINE_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state.quarantine, null, 2), 'utf-8');
    await fs.rename(tmp, QUARANTINE_PATH);
  }

  normalizeAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`Non-numeric amount: ${value}`);
    return Math.round(n * 1e8) / 1e8;
  }

  async threeWayMatch({ internalTrigger, counterpartyAck, gatewayLedger, stateVars = {} }) {
    const sources = { internalTrigger, counterpartyAck, gatewayLedger };
    const missing = Object.entries(sources).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      return { matched: false, status: 'INCOMPLETE', missing, reason: `Missing source legs: ${missing.join(', ')}` };
    }

    const amounts = Object.fromEntries(
      Object.entries(sources).map(([k, v]) => [k, this.normalizeAmount(v.amount)])
    );
    const currencies = Object.fromEntries(
      Object.entries(sources).map(([k, v]) => [k, String(v.currency || '').toUpperCase()])
    );

    const deviations = {};
    const base = amounts.internalTrigger;
    let maxDeviationPct = 0;
    for (const [k, v] of Object.entries(amounts)) {
      const devPct = base === 0 ? (v === 0 ? 0 : 100) : Math.abs(v - base) / base * 100;
      deviations[k] = Number(devPct.toFixed(6));
      if (devPct > maxDeviationPct) maxDeviationPct = devPct;
    }

    const currencyMismatch = new Set(Object.values(currencies)).size > 1;
    const stateVarDeviations = {};
    for (const [key, val] of Object.entries(stateVars)) {
      if (val && val.expected !== undefined && val.actual !== undefined) {
        const dev = val.expected === 0 ? (val.actual === 0 ? 0 : 100) : Math.abs(val.actual - val.expected) / Math.abs(val.expected) * 100;
        stateVarDeviations[key] = Number(dev.toFixed(6));
      }
    }

    const threshold = Number(process.env.RECON_THRESHOLD_PCT || 0.0);
    const anyStateVarDeviation = Object.values(stateVarDeviations).some(d => d > threshold);
    const pass = maxDeviationPct <= threshold && !currencyMismatch && !anyStateVarDeviation;

    const result = {
      matched: pass,
      status: pass ? 'MATCHED' : 'MISMATCH',
      txId: internalTrigger.txId || counterpartyAck.txId || gatewayLedger.txId || null,
      amounts,
      currencies,
      deviations,
      maxDeviationPct,
      currencyMismatch,
      stateVarDeviations,
      threshold,
      timestamp: new Date().toISOString(),
    };
    this.state.matches.push({ ...result, type: result.status });
    this.state.mismatches = this.state.mismatches.filter(m => m.txId !== result.txId);
    if (result.status === 'MISMATCH') this.state.mismatches.push(result);
    await this._persist();
    return result;
  }

  async quarantine(item, reason = 'unverified_revenue') {
    await this.init();
    const entry = {
      quarantinedAt: new Date().toISOString(),
      reason,
      original: item,
      holdingAccount: 'ESCROW_HOLDING_QUARANTINE',
      status: 'quarantined',
    };
    this.state.quarantine.push(entry);
    await this._persist();
    await this._persistQuarantine();
    return entry;
  }

  async releaseFromQuarantine(quarantineId, approvedBy) {
    const entry = this.state.quarantine.find(q => q.quarantinedAt === quarantineId);
    if (!entry) throw new Error(`Quarantine entry not found: ${quarantineId}`);
    entry.status = 'released';
    entry.releasedAt = new Date().toISOString();
    entry.approvedBy = approvedBy;
    await this._persist();
    await this._persistQuarantine();
    return entry;
  }

  async status() {
    return {
      totalMatches: this.state.matches.length,
      openMismatches: this.state.mismatches.length,
      quarantined: this.state.quarantine.filter(q => q.status === 'quarantined').length,
      lastMatch: this.state.matches[this.state.matches.length - 1] || null,
    };
  }
}

const reconciliationEngine = new ReconciliationEngine();
export default reconciliationEngine;
export { ReconciliationEngine };
