import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';

class ForemanCodingEngine extends RevenueEngine {
  constructor() { super('foreman-coding', { version: '0.1.0', vendor: 'https://github.com/ncklrs/foreman', description: 'Foreman agentic coding runtime — sell dev capacity as a service', requiredEnv: ['FOREMAN_TASK_LEDGER_PATH', 'FOREMAN_RATE_CARD_PATH'], optionalEnv: ['FOREMAN_MIN_TASK_USD', 'FOREMAN_INVOICE_AUTO', 'STRIPE_SECRET_KEY'] }); }

  async _init() {
    this.ledgerPath = process.env.FOREMAN_TASK_LEDGER_PATH; this.rateCardPath = process.env.FOREMAN_RATE_CARD_PATH;
    this.minTaskUsd = Number(process.env.FOREMAN_MIN_TASK_USD || 1.00); this.invoiceAuto = String(process.env.FOREMAN_INVOICE_AUTO || '').toLowerCase() === 'true';
    if (!existsSync(this.rateCardPath)) { this.warn(`rate card not found: ${this.rateCardPath}`); this._rateCard = {}; }
    else { this._rateCard = JSON.parse(await fs.readFile(this.rateCardPath, 'utf-8')); }
    this._lastSeenOffset = 0;
  }

  async _discover() {
    if (!existsSync(this.ledgerPath)) { if (this.isObserve()) return { opportunities: [{ id: `stub_task_${Date.now()}`, type: 'coding_task', task_type: 'bug_fix', client_id: 'stub_client', status: 'merged', complexity: 'medium', rate_usd: 25, ts: Date.now() }] }; return { opportunities: [] }; }
    const stat = await fs.stat(this.ledgerPath); if (stat.size < this._lastSeenOffset) this._lastSeenOffset = 0;
    const fh = await fs.open(this.ledgerPath, 'r'); const buf = Buffer.alloc(stat.size - this._lastSeenOffset); await fh.read(buf, 0, buf.length, this._lastSeenOffset); await fh.close();
    this._lastSeenOffset = stat.size;
    const opportunities = [];
    for (const line of buf.toString('utf-8').split('\n').filter(Boolean)) {
      let task; try { task = JSON.parse(line); } catch { continue; }
      if (!task.task_id || !task.client_id || (task.status !== 'merged' && task.status !== 'delivered')) continue;
      const rate = this._rateCard[task.task_type] || this._rateCard.default || 25;
      if (rate < this.minTaskUsd) continue;
      opportunities.push({ id: `task_${task.task_id}`, type: 'coding_task', task_type: task.task_type, client_id: task.client_id, status: task.status, pr_url: task.pr_url, complexity: task.complexity || 'medium', rate_usd: rate, ts: task.completed_at || Date.now() });
    }
    return { opportunities };
  }

  async _earn(opp) { const earningId = `FOREMAN_${opp.id}`; const emit = await this.emitEarning({ earningId, amount: opp.rate_usd, currency: 'USD', source: this.name, beneficiary: process.env.OWNER_PAYPAL_EMAIL || '', metadata: { client_id: opp.client_id, task_type: opp.task_type, pr_url: opp.pr_url, complexity: opp.complexity } }); return { earningId, amount: opp.rate_usd, currency: 'USD', newly_emitted: emit.emitted }; }
  async _settle(earning) { return { settlementId: null, gateway_ref: null, status: this.isLive() ? 'pending_external_confirmation' : 'observe_only' }; }
  async _status() { return { ledger_path: this.ledgerPath, rate_card_entries: Object.keys(this._rateCard || {}).length, min_task_usd: this.minTaskUsd, invoice_auto: this.invoiceAuto, last_seen_offset: this._lastSeenOffset }; }
}

register('foreman-coding', () => new ForemanCodingEngine(), { vendor: 'https://github.com/ncklrs/foreman', revenue_model: 'agentic coding capacity sold per-task', integration_cost: 'low', risk_level: 'low', recommended_mode: 'observe' });
export default ForemanCodingEngine;
