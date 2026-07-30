import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';

class AIPipelineRouterEngine extends RevenueEngine {
  constructor() { super('aipipeline-router', { version: '0.1.0', vendor: 'https://github.com/ncklrs/ai-pipeline', description: 'LLM routing API — per-request margin billing', requiredEnv: ['AIPROFILE_USAGE_LOG_PATH', 'AIPROFILE_PRICING_TABLE_PATH'], optionalEnv: ['AIPROFILE_MIN_MARGIN_USD', 'AIPROFILE_AGGREGATE'] }); }

  async _init() {
    this.usageLogPath = process.env.AIPROFILE_USAGE_LOG_PATH; this.pricingTablePath = process.env.AIPROFILE_PRICING_TABLE_PATH;
    this.minMargin = Number(process.env.AIPROFILE_MIN_MARGIN_USD || 0.0001); this.aggregate = String(process.env.AIPROFILE_AGGREGATE || '').toLowerCase() === 'true';
    if (!existsSync(this.pricingTablePath)) { this.warn(`pricing table not found: ${this.pricingTablePath}`); this._pricing = {}; }
    else { this._pricing = JSON.parse(await fs.readFile(this.pricingTablePath, 'utf-8')); }
    this._lastSeenOffset = 0;
  }

  async _discover() {
    if (!existsSync(this.usageLogPath)) { if (this.isObserve()) return { opportunities: [{ id: `stub_request_${Date.now()}`, type: 'routed_request', client_id: 'stub_client', model: 'claude-sonnet-4', input_tokens: 1000, output_tokens: 500, upstream_cost_usd: 0.015, price_charged_usd: 0.020, margin_usd: 0.005, ts: Date.now() }] }; return { opportunities: [] }; }
    const stat = await fs.stat(this.usageLogPath); if (stat.size < this._lastSeenOffset) this._lastSeenOffset = 0;
    const fh = await fs.open(this.usageLogPath, 'r'); const buf = Buffer.alloc(stat.size - this._lastSeenOffset); await fh.read(buf, 0, buf.length, this._lastSeenOffset); await fh.close();
    this._lastSeenOffset = stat.size;
    const opportunities = [];
    for (const line of buf.toString('utf-8').split('\n').filter(Boolean)) {
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      if (!entry.request_id || !entry.model) continue;
      const margin = Number(entry.price_charged_usd || 0) - Number(entry.upstream_cost_usd || 0);
      if (margin < this.minMargin) continue;
      opportunities.push({ id: `req_${entry.request_id}`, type: 'routed_request', client_id: entry.client_id || 'unknown', model: entry.model, margin_usd: margin, ts: entry.ts || Date.now() });
    }
    return { opportunities };
  }

  async _earn(opp) { const earningId = `AIPROF_${opp.id}`; const emit = await this.emitEarning({ earningId, amount: opp.margin_usd, currency: 'USD', source: this.name, beneficiary: process.env.OWNER_PAYPAL_EMAIL || '', metadata: { client_id: opp.client_id, model: opp.model } }); return { earningId, amount: opp.margin_usd, currency: 'USD', newly_emitted: emit.emitted }; }
  async _settle(earning) { return { settlementId: null, gateway_ref: null, status: this.isLive() ? 'pending_external_confirmation' : 'observe_only' }; }
  async _status() { return { usage_log_path: this.usageLogPath, pricing_table_loaded: Object.keys(this._pricing || {}).length > 0, min_margin_usd: this.minMargin, aggregate_mode: this.aggregate }; }
}

register('aipipeline-router', () => new AIPipelineRouterEngine(), { vendor: 'https://github.com/ncklrs/ai-pipeline', revenue_model: 'LLM routing API — per-request margin', integration_cost: 'low', risk_level: 'low', recommended_mode: 'observe' });
export default AIPipelineRouterEngine;
