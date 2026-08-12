/**
 * src/revenue-engines/applypilot-jobs.mjs — ApplyPilot job placement revenue engine
 *
 * Vendor: https://github.com/ncklrs/ApplyPilot
 *
 * Revenue model:
 *   ApplyPilot is a 6-stage autonomous job application pipeline that discovers
 *   jobs, scores them against the user's resume, and submits applications.
 *   Monetize via placement fees (recruiter model):
 *     - Per-interview fee (e.g., $50 when client gets an interview)
 *     - Per-placement fee (e.g., 10% of first-year salary on hire)
 *     - Subscription for unlimited applications (e.g., $99/month)
 *
 *   This adapter:
 *     1. Reads the ApplyPilot placement ledger (JSONL of application outcomes)
 *     2. For each interview/placement event, computes the fee
 *     3. Emits each as an Earning event
 *
 * Earning trigger: application status transitions to "interview" or "hired".
 *
 * Required env (live mode):
 *   APPLYPILOT_LEDGER_PATH       Path to placement ledger (JSONL)
 *   APPLYPILOT_FEE_SCHEDULE_PATH Path to fee schedule JSON
 *
 * Optional env:
 *   APPLYPILOT_INTERVIEW_FEE_USD  Default $50
 *   APPLYPILOT_PLACEMENT_PCT      Default 0.10 (10% of first-year salary)
 *   APPLYPILOT_SUBSCRIPTION_USD   Default $99/month (recorded monthly)
 */

import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';

class ApplyPilotJobsEngine extends RevenueEngine {
  constructor() {
    super('applypilot-jobs', {
      version: '0.1.0',
      vendor: 'https://github.com/ncklrs/ApplyPilot',
      description: 'ApplyPilot autonomous job applications — placement fee revenue',
      requiredEnv: ['APPLYPILOT_LEDGER_PATH'],
      optionalEnv: ['APPLYPILOT_FEE_SCHEDULE_PATH', 'APPLYPILOT_INTERVIEW_FEE_USD', 'APPLYPILOT_PLACEMENT_PCT', 'APPLYPILOT_SUBSCRIPTION_USD'],
    });
  }

  async _init() {
    this.ledgerPath = process.env.APPLYPILOT_LEDGER_PATH;
    this.feeSchedulePath = process.env.APPLYPILOT_FEE_SCHEDULE_PATH;
    this.interviewFee = Number(process.env.APPLYPILOT_INTERVIEW_FEE_USD || 50);
    this.placementPct = Number(process.env.APPLYPILOT_PLACEMENT_PCT || 0.10);
    this.subscriptionUsd = Number(process.env.APPLYPILOT_SUBSCRIPTION_USD || 99);

    this._feeSchedule = existsSync(this.feeSchedulePath || '__none__')
      ? JSON.parse(await fs.readFile(this.feeSchedulePath, 'utf-8'))
      : {};
    this._lastSeenOffset = 0;
    this._emittedEvents = new Set(); // dedupe by application_id + event_type
  }

  async _discover() {
    if (!existsSync(this.ledgerPath)) {
      if (this.isObserve()) {
        return { opportunities: [{
          id: `stub_interview_${Date.now()}`,
          type: 'interview',
          client_id: 'stub_client',
          application_id: 'app_001',
          job_title: 'Senior Engineer',
          company: 'Acme',
          salary_usd: 150000,
          amount_usd: 50, // default interview fee
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
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (!event.application_id || !event.client_id) continue;
      const eventKey = `${event.application_id}_${event.event_type}`;
      if (this._emittedEvents.has(eventKey)) continue;

      let amount = 0;
      let type = event.event_type;
      if (event.event_type === 'interview') {
        amount = this._feeSchedule.interview_fee || this.interviewFee;
      } else if (event.event_type === 'hired') {
        amount = (event.salary_usd || 0) * (this._feeSchedule.placement_pct || this.placementPct);
      } else if (event.event_type === 'subscription_renewal') {
        amount = this.subscriptionUsd;
      } else continue;

      if (amount <= 0) continue;
      this._emittedEvents.add(eventKey);
      opportunities.push({
        id: `${type}_${event.application_id}`,
        type,
        client_id: event.client_id,
        application_id: event.application_id,
        job_title: event.job_title,
        company: event.company,
        salary_usd: event.salary_usd,
        amount_usd: amount,
        ts: event.ts || Date.now(),
      });
    }
    return { opportunities };
  }

  async _earn(opp) {
    const earningId = `APPLYPILOT_${opp.id}`;
    const emit = await this.emitEarning({
      earningId,
      amount: opp.amount_usd,
      currency: 'USD',
      source: this.name,
      beneficiary: process.env.OWNER_PAYPAL_EMAIL || '',
      metadata: {
        client_id: opp.client_id,
        application_id: opp.application_id,
        job_title: opp.job_title,
        company: opp.company,
        salary_usd: opp.salary_usd,
        type: opp.type,
        ts: opp.ts,
      },
    });
    return {
      earningId,
      amount: opp.amount_usd,
      currency: 'USD',
      client_id: opp.client_id,
      application_id: opp.application_id,
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
      interview_fee_usd: this.interviewFee,
      placement_pct: this.placementPct,
      subscription_usd: this.subscriptionUsd,
      emitted_events: this._emittedEvents.size,
      last_seen_offset: this._lastSeenOffset,
    };
  }
}

register('applypilot-jobs', () => new ApplyPilotJobsEngine(), {
  vendor: 'https://github.com/ncklrs/ApplyPilot',
  revenue_model: 'job placement fees — interview fee + placement % + subscription',
  integration_cost: 'low (read application ledger + apply fee schedule)',
  risk_level: 'low (no direct fund movement; placement fees invoiced on hire)',
  recommended_mode: 'observe',
});

export default ApplyPilotJobsEngine;
