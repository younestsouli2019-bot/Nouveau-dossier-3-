/**
 * src/revenue-engines/foreman-coding.mjs — Foreman agentic coding revenue engine
 *
 * Vendor: https://github.com/ncklrs/foreman
 *
 * Revenue model:
 *   Foreman is a model-agnostic agentic coding runtime that orchestrates AI
 *   agents to execute software engineering tasks autonomously (bug fixes,
 *   feature implementations, refactors). Monetize by selling coding capacity
 *   as a service:
 *     - Per-task billing (e.g., $5-$50 per resolved task based on complexity)
 *     - Retainer contracts (monthly hours)
 *     - Bug-bounty-style success fees
 *
 *   This adapter:
 *     1. Reads the foreman task ledger (JSONL of completed tasks)
 *     2. For each newly-completed task, computes the billable amount
 *     3. Emits each as an Earning event
 *     4. Optionally generates a Stripe invoice / PayPal request
 *
 * Earning trigger: each completed foreman task with status="merged" or
 * "delivered" that has a client_id.
 *
 * Required env (live mode):
 *   FOREMAN_TASK_LEDGER_PATH   Path to foreman task ledger (JSONL)
 *   FOREMAN_RATE_CARD_PATH     Path to rate card JSON (task_type -> price)
 *
 * Optional env:
 *   FOREMAN_MIN_TASK_USD       Minimum billable amount (default 1.00)
 *   FOREMAN_INVOICE_AUTO       "true" to auto-generate Stripe invoices
 *   STRIPE_SECRET_KEY          For live invoice generation
 */

import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';

class ForemanCodingEngine extends RevenueEngine {
  constructor() {
    super('foreman-coding', {
      version: '0.1.0',
      vendor: 'https://github.com/ncklrs/foreman',
      description: 'Foreman agentic coding runtime — sell dev capacity as a service',
      requiredEnv: ['FOREMAN_TASK_LEDGER_PATH', 'FOREMAN_RATE_CARD_PATH'],
      optionalEnv: ['FOREMAN_MIN_TASK_USD', 'FOREMAN_INVOICE_AUTO', 'STRIPE_SECRET_KEY'],
    });
  }

  async _init() {
    this.ledgerPath = process.env.FOREMAN_TASK_LEDGER_PATH;
    this.rateCardPath = process.env.FOREMAN_RATE_CARD_PATH;
    this.minTaskUsd = Number(process.env.FOREMAN_MIN_TASK_USD || 1.00);
    this.invoiceAuto = String(process.env.FOREMAN_INVOICE_AUTO || '').toLowerCase() === 'true';

    if (!existsSync(this.rateCardPath)) {
      this.warn(`rate card not found: ${this.rateCardPath}`);
      this._rateCard = {};
    } else {
      this._rateCard = JSON.parse(await fs.readFile(this.rateCardPath, 'utf-8'));
    }
    this._lastSeenOffset = 0;
  }

  async _discover() {
    if (!existsSync(this.ledgerPath)) {
      if (this.isObserve()) {
        return { opportunities: [{
          id: `stub_task_${Date.now()}`,
          type: 'coding_task',
          task_type: 'bug_fix',
          client_id: 'stub_client',
          status: 'merged',
          pr_url: 'https://github.com/example/repo/pull/1',
          complexity: 'medium',
          rate_usd: 25, // default rate
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
      let task;
      try { task = JSON.parse(line); } catch { continue; }
      if (!task.task_id || !task.client_id) continue;
      if (task.status !== 'merged' && task.status !== 'delivered') continue;
      const rate = this._rateCard[task.task_type] || this._rateCard.default || 25;
      if (rate < this.minTaskUsd) continue;
      opportunities.push({
        id: `task_${task.task_id}`,
        type: 'coding_task',
        task_type: task.task_type,
        client_id: task.client_id,
        status: task.status,
        pr_url: task.pr_url,
        complexity: task.complexity || 'medium',
        rate_usd: rate,
        ts: task.completed_at || Date.now(),
      });
    }
    return { opportunities };
  }

  async _earn(opp) {
    const earningId = `FOREMAN_${opp.id}`;
    const emit = await this.emitEarning({
      earningId,
      amount: opp.rate_usd,
      currency: 'USD',
      source: this.name,
      beneficiary: process.env.OWNER_PAYPAL_EMAIL || '',
      metadata: {
        client_id: opp.client_id,
        task_type: opp.task_type,
        pr_url: opp.pr_url,
        complexity: opp.complexity,
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
    if (!this.invoiceAuto || !process.env.STRIPE_SECRET_KEY) {
      return { settlementId: null, gateway_ref: null, status: 'pending_external_confirmation' };
    }
    // Real: create Stripe invoice for the client
    this.warn('live Stripe invoice generation not implemented in adapter stub');
    return { settlementId: null, gateway_ref: null, status: 'pending_external_confirmation' };
  }

  async _status() {
    return {
      ledger_path: this.ledgerPath,
      rate_card_entries: Object.keys(this._rateCard || {}).length,
      min_task_usd: this.minTaskUsd,
      invoice_auto: this.invoiceAuto,
      last_seen_offset: this._lastSeenOffset,
    };
  }
}

register('foreman-coding', () => new ForemanCodingEngine(), {
  vendor: 'https://github.com/ncklrs/foreman',
  revenue_model: 'agentic coding capacity sold per-task (bug fix, feature, refactor)',
  integration_cost: 'low (read task ledger + apply rate card)',
  risk_level: 'low (no direct fund movement; invoice via Stripe)',
  recommended_mode: 'observe',
});

export default ForemanCodingEngine;
