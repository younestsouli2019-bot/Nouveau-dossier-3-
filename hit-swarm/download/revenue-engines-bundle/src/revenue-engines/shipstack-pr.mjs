/**
 * src/revenue-engines/shipstack-pr.mjs — ShipStack autonomous PR revenue engine
 *
 * Vendor: https://github.com/ncklrs/shipstack
 *
 * Revenue model:
 *   ShipStack is an autonomous coding pipeline: task in, reviewed PR out.
 *   Monetize as PR-as-a-service:
 *     - Per-PR billing (e.g., $20-$200 per merged PR based on complexity)
 *     - Monthly retainer for ongoing PR capacity
 *     - Success fee (only bill if PR is merged)
 *
 *   This adapter:
 *     1. Reads the shipstack PR ledger (JSONL of delivered PRs)
 *     2. For each newly-merged PR, computes the billable amount
 *     3. Emits each as an Earning event
 *
 * Earning trigger: each PR with status="merged" that has a client_id.
 *
 * Required env (live mode):
 *   SHIPSTACK_PR_LEDGER_PATH    Path to PR ledger (JSONL)
 *   SHIPSTACK_RATE_CARD_PATH    Path to rate card JSON
 *
 * Optional env:
 *   SHIPSTACK_MIN_PR_USD        Minimum billable (default 20)
 *   SHIPSTACK_SUCCESS_ONLY      "true" — only bill merged PRs (default: true)
 */

import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';

class ShipStackPREngine extends RevenueEngine {
  constructor() {
    super('shipstack-pr', {
      version: '0.1.0',
      vendor: 'https://github.com/ncklrs/shipstack',
      description: 'ShipStack autonomous coding pipeline — PR-as-a-service billing',
      requiredEnv: ['SHIPSTACK_PR_LEDGER_PATH', 'SHIPSTACK_RATE_CARD_PATH'],
      optionalEnv: ['SHIPSTACK_MIN_PR_USD', 'SHIPSTACK_SUCCESS_ONLY'],
    });
  }

  async _init() {
    this.ledgerPath = process.env.SHIPSTACK_PR_LEDGER_PATH;
    this.rateCardPath = process.env.SHIPSTACK_RATE_CARD_PATH;
    this.minPrUsd = Number(process.env.SHIPSTACK_MIN_PR_USD || 20);
    this.successOnly = String(process.env.SHIPSTACK_SUCCESS_ONLY || 'true').toLowerCase() === 'true';

    this._rateCard = existsSync(this.rateCardPath)
      ? JSON.parse(await fs.readFile(this.rateCardPath, 'utf-8'))
      : {};
    this._lastSeenOffset = 0;
  }

  async _discover() {
    if (!existsSync(this.ledgerPath)) {
      if (this.isObserve()) {
        return { opportunities: [{
          id: `stub_pr_${Date.now()}`,
          type: 'autonomous_pr',
          client_id: 'stub_client',
          pr_url: 'https://github.com/example/repo/pull/1',
          status: 'merged',
          complexity: 'medium',
          lines_changed: 247,
          rate_usd: 75, // default rate
          ts: Date.now(),
        }]};
      }
      return { opportunities: [] };
    }

    const stat = await fs.stat(this.ledgerPath);
    if (stat.size < this._lastSeenOffset) this._lastSeenOffset = 0;
    const fh = await fs.open(this.ledgerPath, 'r');
    const buf = Buffer.alloc(stat.size - this._lastSeenOffset);
    await fh.read(buf, 0, buf.length, this._lastSeenOffset);
    await fh.close();
    this._lastSeenOffset = stat.size;

    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
    const opportunities = [];
    for (const line of lines) {
      let pr;
      try { pr = JSON.parse(line); } catch { continue; }
      if (!pr.pr_id || !pr.client_id) continue;
      if (this.successOnly && pr.status !== 'merged') continue;
      const rate = this._rateCard[pr.complexity] || this._rateCard.default || 75;
      if (rate < this.minPrUsd) continue;
      opportunities.push({
        id: `pr_${pr.pr_id}`,
        type: 'autonomous_pr',
        client_id: pr.client_id,
        pr_url: pr.pr_url,
        status: pr.status,
        complexity: pr.complexity || 'medium',
        lines_changed: pr.lines_changed || 0,
        rate_usd: rate,
        ts: pr.merged_at || pr.delivered_at || Date.now(),
      });
    }
    return { opportunities };
  }

  async _earn(opp) {
    const earningId = `SHIPSTACK_${opp.id}`;
    const emit = await this.emitEarning({
      earningId,
      amount: opp.rate_usd,
      currency: 'USD',
      source: this.name,
      beneficiary: process.env.OWNER_PAYPAL_EMAIL || '',
      metadata: {
        client_id: opp.client_id,
        pr_url: opp.pr_url,
        complexity: opp.complexity,
        lines_changed: opp.lines_changed,
        status: opp.status,
        ts: opp.ts,
      },
    });
    return {
      earningId,
      amount: opp.rate_usd,
      currency: 'USD',
      client_id: opp.client_id,
      pr_url: opp.pr_url,
      newly_emitted: emit.emitted,
    };
  }

  async _settle(earning) {
    if (!this.isLive()) return { settlementId: null, gateway_ref: null, status: 'observe_only' };
    return { settlementId: null, gateway_ref: null, status: 'pending_external_confirmation' };
  }

  async _status() {
    return {
      ledger_path: this.ledgerPath,
      rate_card_entries: Object.keys(this._rateCard || {}).length,
      min_pr_usd: this.minPrUsd,
      success_only: this.successOnly,
      last_seen_offset: this._lastSeenOffset,
    };
  }
}

register('shipstack-pr', () => new ShipStackPREngine(), {
  vendor: 'https://github.com/ncklrs/shipstack',
  revenue_model: 'PR-as-a-service — per-PR billing on merge',
  integration_cost: 'low (read PR ledger + apply rate card)',
  risk_level: 'low (no direct fund movement)',
  recommended_mode: 'observe',
});

export default ShipStackPREngine;
