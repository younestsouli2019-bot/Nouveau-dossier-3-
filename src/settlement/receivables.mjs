import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const STATE_PATH = path.join(ROOT, 'data', 'settlement', 'receivables.json');
const MISSION_PLAN_PATH = path.join(ROOT, 'data', 'swarm', 'mission-plan.json');

const DEFAULT_REVENUE_TYPES = ['marketing', 'market_research', 'store_setup', 'financial_setup', 'content_creation'];

class ReceivablesEngine {
  constructor() {
    this.state = null;
  }

  async init() {
    mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    if (!existsSync(STATE_PATH)) {
      this.state = { version: 1, receivables: [], settlements: [] };
      await this._persist();
    } else {
      this.state = JSON.parse(await fs.readFile(STATE_PATH, 'utf-8'));
      this.state.receivables = this.state.receivables || [];
      this.state.settlements = this.state.settlements || [];
    }
    return this;
  }

  async _persist() {
    const tmp = STATE_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tmp, STATE_PATH);
  }

  revenueGeneratingTypes() {
    const envTypes = (process.env.RECEIVABLES_REVENUE_TYPES || '').split(',').map(s => s.trim()).filter(Boolean);
    return envTypes.length > 0 ? envTypes : DEFAULT_REVENUE_TYPES;
  }

  _isRevenueGenerating(missionType) {
    return this.revenueGeneratingTypes().includes(missionType);
  }

  classify({ recon, evidence }) {
    if (!recon || recon.status !== 'MATCHED') {
      return { klass: 'C', reason: `recon:${recon ? recon.status : 'missing'}` };
    }
    const ev = evidence || {};
    const missing = [];
    if (!ev.counterpartyAck) missing.push('counterpartyAck');
    if (!ev.gatewayLedger) missing.push('gatewayLedger');
    if (ev.oracleConfirmed !== true) missing.push('oracleConfirmed');
    if (missing.length > 0) {
      return { klass: 'B', reason: `missing_evidence:${missing.join(',')}` };
    }
    return { klass: 'A', reason: 'fully_verified_three_way_match' };
  }

  async registerReceivable({ txId, missionId, amount, currency, agent, recon, evidence }) {
    await this.init();
    const { klass, reason } = this.classify({ recon, evidence });
    const existing = this.state.receivables.find(r => r.txId === txId);
    if (existing) {
      existing.klass = klass;
      existing.reason = reason;
      existing.missionId = missionId || existing.missionId;
      existing.status = klass === 'A' ? 'ELIGIBLE' : 'BLOCKED';
      existing.updatedAt = new Date().toISOString();
      await this._persist();
      return existing;
    }
    const record = {
      receivableId: `AR_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      txId,
      missionId: missionId || null,
      amount: Math.round(Number(amount) * 1e8) / 1e8,
      currency: String(currency || 'MAD').toUpperCase(),
      agent: agent || 'swarm',
      klass,
      reason,
      status: klass === 'A' ? 'ELIGIBLE' : 'BLOCKED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.state.receivables.push(record);
    await this._persist();
    return record;
  }

  async settleReceivable(txId, { batchId, rail }) {
    await this.init();
    const r = this.state.receivables.find(r => r.txId === txId);
    if (!r) throw new Error(`Receivable not found: ${txId}`);
    if (r.klass !== 'A' || r.status !== 'ELIGIBLE') throw new Error(`Receivable ${txId} not Class A / not eligible for settlement`);
    r.status = 'SETTLED';
    r.settledAt = new Date().toISOString();
    this.state.settlements.push({ txId, batchId, rail, settledAt: r.settledAt });
    await this._persist();
    return r;
  }

  requireClassA(txId) {
    const r = this.state?.receivables?.find(r => r.txId === txId);
    if (!r) return { allowed: false, reason: `receivable_not_registered:${txId}` };
    if (r.klass !== 'A') return { allowed: false, reason: `non_class_a:${r.klass}`, klass: r.klass };
    return { allowed: true, klass: r.klass };
  }

  _loadMissionPlan() {
    if (!existsSync(MISSION_PLAN_PATH)) return null;
    try { return JSON.parse(readFileSync(MISSION_PLAN_PATH, 'utf-8')); }
    catch { return null; }
  }

  async auditRevenueMissions() {
    await this.init();
    const plan = this._loadMissionPlan();
    if (!plan || !Array.isArray(plan.missions)) {
      return { status: 'NO_MISSION_PLAN', revenueTypes: this.revenueGeneratingTypes() };
    }
    const revenueTypes = this.revenueGeneratingTypes();
    const missions = plan.missions.filter(m => revenueTypes.includes(m.type));
    const classAReceivables = this.state.receivables.filter(r => r.klass === 'A');
    const violations = [];
    const covered = [];
    for (const mission of missions) {
      const hasClassA = classAReceivables.some(r => r.missionId === mission.id);
      const coveredReceivables = this.state.receivables.filter(r => r.missionId === mission.id);
      const entry = {
        missionId: mission.id,
        title: mission.title,
        type: mission.type,
        status: mission.status,
        classAReceivableCount: classAReceivables.filter(r => r.missionId === mission.id).length,
        receivableCount: coveredReceivables.length,
        covered: hasClassA,
      };
      if (hasClassA) covered.push(entry);
      else violations.push(entry);
    }
    return {
      status: violations.length === 0 ? 'ALL_REVENUE_MISSIONS_COVERED' : 'MISSING_CLASS_A_RECEIVABLES',
      revenueTypes,
      revenueMissions: missions.length,
      coveredMissions: covered.length,
      violations,
    };
  }

  async status() {
    await this.init();
    const byKlass = {};
    const byStatus = {};
    let value = 0;
    for (const r of this.state.receivables) {
      byKlass[r.klass] = (byKlass[r.klass] || 0) + 1;
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      value += r.amount;
    }
    return {
      total: this.state.receivables.length,
      byKlass,
      byStatus,
      value,
      settled: this.state.settlements.length,
    };
  }
}

const receivablesEngine = new ReceivablesEngine();
export default receivablesEngine;
export { ReceivablesEngine };
