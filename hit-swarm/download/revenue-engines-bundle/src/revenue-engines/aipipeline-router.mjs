/**
 * src/revenue-engines/aipipeline-router.mjs — AI Pipeline LLM router revenue engine
 *
 * Vendor: https://github.com/ncklrs/ai-pipeline
 *
 * Revenue model:
 *   ai-pipeline is an intelligent LLM routing API that classifies prompts and
 *   routes them to the optimal model across multiple providers (Anthropic,
 *   OpenAI, etc.). Monetize as a paid API gateway:
 *     - Per-request billing (e.g., $0.001 per routed request)
 *     - Tiered subscriptions (free / pro / enterprise)
 *     - Markup on upstream LLM costs (e.g., 15% margin)
 *
 *   This adapter:
 *     1. Reads the ai-pipeline usage log (CSV or JSONL)
 *     2. For each new request since last run, computes the margin earned
 *        (price charged to client - upstream LLM cost)
 *     3. Emits each margin as an Earning event
 *
 * Earning trigger: each completed routed request with a positive margin.
 *
 * Required env (live mode):
 *   AIPROFILE_USAGE_LOG_PATH     Path to usage log file (CSV or JSONL)
 *   AIPROFILE_PRICING_TABLE_PATH Path to pricing table JSON
 *   AIPROLINE_UPSTREAM_COST_KEY  Env var name holding upstream cost map (or path)
 *
 * Optional env:
 *   AIPROFILE_MIN_MARGIN_USD     Minimum margin to record (default 0.0001)
 *   AIPROFILE_AGGREGATE          "true" to aggregate by hour (default: per-request)
 */

import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

class AIPipelineRouterEngine extends RevenueEngine {
  constructor() {
    super('aipipeline-router', {
      version: '0.1.0',
      vendor: 'https://github.com/ncklrs/ai-pipeline',
      description: 'LLM routing API gateway — per-request margin billing',
      requiredEnv: ['AIPROFILE_USAGE_LOG_PATH', 'AIPROFILE_PRICING_TABLE_PATH'],
      optionalEnv: ['AIPROFILE_MIN_MARGIN_USD', 'AIPROFILE_AGGREGATE'],
    });
  }

  async _init() {
    this.usageLogPath = process.env.AIPROFILE_USAGE_LOG_PATH;
    this.pricingTablePath = process.env.AIPROFILE_PRICING_TABLE_PATH;
    this.minMargin = Number(process.env.AIPROFILE_MIN_MARGIN_USD || 0.0001);
    this.aggregate = String(process.env.AIPROFILE_AGGREGATE || '').toLowerCase() === 'true';

    if (!existsSync(this.pricingTablePath)) {
      this.warn(`pricing table not found: ${this.pricingTablePath}`);
      this._pricing = {};
    } else {
      const raw = await fs.readFile(this.pricingTablePath, 'utf-8');
      this._pricing = JSON.parse(raw);
    }
    this._lastSeenOffset = 0;
  }

  async _discover() {
    if (!existsSync(this.usageLogPath)) {
      if (this.isObserve()) {
        return { opportunities: [{
          id: `stub_request_${Date.now()}`,
          type: 'routed_request',
          client_id: 'stub_client',
          model: 'claude-sonnet-4',
          input_tokens: 1000,
          output_tokens: 500,
          upstream_cost_usd: 0.015,
          price_charged_usd: 0.020,
          margin_usd: 0.005, // = price_charged - upstream_cost
          ts: Date.now(),
        }]};
      }
      return { opportunities: [] };
    }

    // Real: read new lines from usage log since last offset
    const stat = await fs.stat(this.usageLogPath);
    if (stat.size < this._lastSeenOffset) this._lastSeenOffset = 0; // log rotated
    const fh = await fs.open(this.usageLogPath, 'r');
    const buf = Buffer.alloc(stat.size - this._lastSeenOffset);
    await fh.read(buf, 0, buf.length, this._lastSeenOffset);
    await fh.close();
    this._lastSeenOffset = stat.size;

    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
    const opportunities = [];
    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry.request_id || !entry.model) continue;
      const upstream = Number(entry.upstream_cost_usd || 0);
      const charged = Number(entry.price_charged_usd || 0);
      const margin = charged - upstream;
      if (margin < this.minMargin) continue;
      opportunities.push({
        id: `req_${entry.request_id}`,
        type: 'routed_request',
        client_id: entry.client_id || 'unknown',
        model: entry.model,
        input_tokens: entry.input_tokens || 0,
        output_tokens: entry.output_tokens || 0,
        upstream_cost_usd: upstream,
        price_charged_usd: charged,
        margin_usd: margin,
        ts: entry.ts || Date.now(),
      });
    }

    if (this.aggregate) {
      // Group by hour
      const byHour = {};
      for (const opp of opportunities) {
        const hour = Math.floor(opp.ts / 3600000) * 3600000;
        const key = `${opp.client_id}_${hour}`;
        if (!byHour[key]) {
          byHour[key] = { ...opp, id: `agg_${key}`, amount: 0, count: 0 };
        }
        byHour[key].margin_usd += opp.margin_usd;
        byHour[key].count += 1;
      }
      return { opportunities: Object.values(byHour).map(o => ({ ...o, amount: o.margin_usd })) };
    }
    return { opportunities };
  }

  async _earn(opp) {
    const earningId = `AIPROF_${opp.id}`;
    const emit = await this.emitEarning({
      earningId,
      amount: opp.margin_usd || opp.amount,
      currency: 'USD',
      source: this.name,
      beneficiary: process.env.OWNER_PAYPAL_EMAIL || '',
      metadata: {
        client_id: opp.client_id,
        model: opp.model,
        input_tokens: opp.input_tokens,
        output_tokens: opp.output_tokens,
        upstream_cost_usd: opp.upstream_cost_usd,
        price_charged_usd: opp.price_charged_usd,
        type: opp.type,
        ts: opp.ts,
      },
    });
    return {
      earningId,
      amount: opp.margin_usd || opp.amount,
      currency: 'USD',
      client_id: opp.client_id,
      newly_emitted: emit.emitted,
    };
  }

  async _settle(earning) {
    if (!this.isLive()) return { settlementId: null, gateway_ref: null, status: 'observe_only' };
    // Margins accumulate in owner's payment account; settle via PayPal Payouts
    // once daily threshold reached (handled by the swarm's existing payout cycle).
    return { settlementId: null, gateway_ref: null, status: 'pending_external_confirmation' };
  }

  async _status() {
    return {
      usage_log_path: this.usageLogPath,
      pricing_table_loaded: Object.keys(this._pricing || {}).length > 0,
      min_margin_usd: this.minMargin,
      aggregate_mode: this.aggregate,
      last_seen_offset: this._lastSeenOffset,
    };
  }
}

register('aipipeline-router', () => new AIPipelineRouterEngine(), {
  vendor: 'https://github.com/ncklrs/ai-pipeline',
  revenue_model: 'LLM routing API — per-request margin (price charged - upstream cost)',
  integration_cost: 'low (read usage log + compute margin)',
  risk_level: 'low (no direct fund movement; settlement via existing PayPal cycle)',
  recommended_mode: 'observe',
});

export default AIPipelineRouterEngine;
