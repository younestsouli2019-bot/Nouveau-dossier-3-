import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';

class ApplyPilotJobsEngine extends RevenueEngine {
  constructor() {
    super('applypilot-jobs', { version: '0.1.0', vendor: 'https://github.com/ncklrs/ApplyPilot', description: 'ApplyPilot autonomous job applications — placement fee revenue', requiredEnv: ['APPLYPILOT_LEDGER_PATH'], optionalEnv: ['APPLYPILOT_FEE_SCHEDULE_PATH', 'APPLYPILOT_INTERVIEW_FEE_USD', 'APPLYPILOT_PLACEMENT_PCT', 'APPLYPILOT_SUBSCRIPTION_USD'] });
    this._emittedEvents = new Set();
    this._lastSeenOffset = 0;
  }

  async _init() {
    this.ledgerPath = process.env.APPLYPILOT_LEDGER_PATH; this.feeSchedulePath = process.env.APPLYPILOT_FEE_SCHEDULE_PATH;
    this.interviewFee = Number(process.env.APPLYPILOT_INTERVIEW_FEE_USD || 50); this.placementPct = Number(process.env.APPLYPILOT_PLACEMENT_PCT || 0.10); this.subscriptionUsd = Number(process.env.APPLYPILOT_SUBSCRIPTION_USD || 99);
    this._feeSchedule = (this.feeSchedulePath && existsSync(this.feeSchedulePath)) ? JSON.parse(await fs.readFile(this.feeSchedulePath, 'utf-8')) : {};
  }

  async _discover() {
    if (!this.ledgerPath || !existsSync(this.ledgerPath)) { if (this.isObserve()) return { opportunities: [{ id: `stub_interview_${Date.now()}`, type: 'interview', client_id: 'stub_client', application_id: 'app_001', job_title: 'Senior Engineer', company: 'Acme', salary_usd: 150000, amount_usd: 50, ts: Date.now() }] }; return { opportunities: [] }; }
    const stat = await fs.stat(this.ledgerPath); if (stat.size < this._lastSeenOffset) this._lastSeenOffset = 0;
    const fh = await fs.open(this.ledgerPath, 'r'); const buf = Buffer.alloc(stat.size - this._lastSeenOffset); await fh.read(buf, 0, buf.length, this._lastSeenOffset); await fh.close();
    this._lastSeenOffset = stat.size;
    const opportunities = [];
    for (const line of buf.toString('utf-8').split('\n').filter(Boolean)) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (!event.application_id || !event.client_id) continue;
      const eventKey = `${event.application_id}_${event.event_type}`; if (this._emittedEvents.has(eventKey)) continue;
      let amount = 0;
      if (event.event_type === 'interview') amount = this._feeSchedule.interview_fee || this.interviewFee;
      else if (event.event_type === 'hired') amount = (event.salary_usd || 0) * (this._feeSchedule.placement_pct || this.placementPct);
      else if (event.event_type === 'subscription_renewal') amount = this.subscriptionUsd;
      else continue;
      if (amount <= 0) continue;
      this._emittedEvents.add(eventKey);
      opportunities.push({ id: `${event.event_type}_${event.application_id}`, type: event.event_type, client_id: event.client_id, application_id: event.application_id, job_title: event.job_title, company: event.company, salary_usd: event.salary_usd, amount_usd: amount, ts: event.ts || Date.now() });
    }
    return { opportunities };
  }

  async _earn(opp) { const earningId = `APPLYPILOT_${opp.id}`; const emit = await this.emitEarning({ earningId, amount: opp.amount_usd, currency: 'USD', source: this.name, beneficiary: process.env.OWNER_PAYPAL_EMAIL || '', metadata: { client_id: opp.client_id, application_id: opp.application_id, job_title: opp.job_title, company: opp.company, type: opp.type } }); return { earningId, amount: opp.amount_usd, currency: 'USD', newly_emitted: emit.emitted }; }
  async _settle(earning) { return { settlementId: null, gateway_ref: null, status: this.isLive() ? 'pending_external_confirmation' : 'observe_only' }; }
  async _status() { return { ledger_path: this.ledgerPath, interview_fee_usd: this.interviewFee, placement_pct: this.placementPct, subscription_usd: this.subscriptionUsd, emitted_events: this._emittedEvents.size, last_seen_offset: this._lastSeenOffset }; }
}

register('applypilot-jobs', () => new ApplyPilotJobsEngine(), { missionId: '68c73bbe3efa5daf0a6709aa', vendor: 'https://github.com/ncklrs/ApplyPilot', revenue_model: 'job placement fees — interview fee + placement % + subscription', integration_cost: 'low', risk_level: 'low', recommended_mode: 'observe' });
export default ApplyPilotJobsEngine;
