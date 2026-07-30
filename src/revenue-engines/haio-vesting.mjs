import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';

class HAiOVestingEngine extends RevenueEngine {
  constructor() { super('haio-vesting', { version: '0.1.0', vendor: 'https://github.com/HAiO-labs/HAiO-vesting-program', description: 'HAiO Vesting: claimable token tranches as recurring revenue', requiredEnv: ['HAIO_VESTING_PROGRAM', 'HAIO_RPC_URL', 'HAIO_VESTING_RECIPIENT'], optionalEnv: ['HAIO_VESTING_MINT', 'HAIO_VESTING_CRANK', 'SOLANA_PRIVATE_KEY'] }); }

  async _init() {
    this.programId = process.env.HAIO_VESTING_PROGRAM; this.rpcUrl = process.env.HAIO_RPC_URL; this.recipient = process.env.HAIO_VESTING_RECIPIENT;
    this.mintFilter = process.env.HAIO_VESTING_MINT; this.doCrank = String(process.env.HAIO_VESTING_CRANK || '').toLowerCase() === 'true';
    try { const mod = await import('@solana/web3.js'); this.solana = mod; this.connection = new this.solana.Connection(this.rpcUrl, 'confirmed'); }
    catch { this.warn('@solana/web3.js not installed — stub mode'); this.solana = null; this.connection = null; }
    this._processedTranches = new Set();
  }

  async _discover() {
    if (!this.connection) { if (this.isObserve()) return { opportunities: [{ id: `stub_vesting_${Date.now()}`, type: 'vesting_release', schedule_id: 'sched_001', amount: 1000, currency: this.mintFilter || 'HAIO', claimable_since: Math.floor(Date.now() / 1000), recipient: this.recipient }] }; return { opportunities: [] }; }
    const scheduleAccounts = await this.connection.getProgramAccounts(new this.solana.PublicKey(this.programId), { filters: [{ memcmp: { offset: 8, bytes: this.recipient } }] });
    const opportunities = []; const now = Math.floor(Date.now() / 1000);
    for (const acc of scheduleAccounts) {
      const schedule = this._decodeSchedule(acc.account.data); if (!schedule) continue;
      if (this.mintFilter && schedule.mint !== this.mintFilter) continue;
      const elapsed = now - schedule.start_time; if (elapsed < schedule.cliff_duration) continue;
      const vestedDuration = Math.min(elapsed, schedule.total_duration);
      const vestedAmount = Math.floor(schedule.total_amount * vestedDuration / schedule.total_duration);
      const claimable = vestedAmount - schedule.released_amount; if (claimable <= 0) continue;
      const trancheId = `${schedule.schedule_id}_${vestedDuration}`;
      if (this._processedTranches.has(trancheId)) continue;
      opportunities.push({ id: `vest_${trancheId}`, type: 'vesting_release', schedule_id: schedule.schedule_id, amount: claimable / 1e6, currency: schedule.mint_symbol || 'UNKNOWN', claimable_since: schedule.start_time + vestedDuration, recipient: this.recipient });
      this._processedTranches.add(trancheId);
    }
    return { opportunities };
  }

  _decodeSchedule(data) {
    if (!data || data.length < 100) return null;
    try { return { schedule_id: data.slice(8, 32).toString('hex'), recipient: new this.solana.PublicKey(data.slice(32, 64)).toString(), mint: new this.solana.PublicKey(data.slice(64, 96)).toString(), mint_symbol: 'UNKNOWN', total_amount: Number(data.readBigUInt64LE(96)), released_amount: Number(data.readBigUInt64LE(104)), start_time: Number(data.readBigUInt64LE(112)), cliff_duration: Number(data.readBigUInt64LE(120)), total_duration: Number(data.readBigUInt64LE(128)) }; }
    catch { return null; }
  }

  async _earn(opp) { const earningId = `HAIO_VEST_${opp.id}`; const emit = await this.emitEarning({ earningId, amount: opp.amount, currency: opp.currency, source: this.name, beneficiary: opp.recipient, metadata: { schedule_id: opp.schedule_id, claimable_since: opp.claimable_since } }); return { earningId, amount: opp.amount, currency: opp.currency, newly_emitted: emit.emitted }; }
  async _settle(earning) { return { settlementId: null, gateway_ref: null, status: this.isLive() ? 'pending_external_confirmation' : 'observe_only' }; }
  async _status() { return { program_id: this.programId, recipient: this.recipient, solana_sdk_loaded: !!this.solana, mint_filter: this.mintFilter, crank_enabled: this.doCrank, processed_tranches: this._processedTranches.size }; }
}

register('haio-vesting', () => new HAiOVestingEngine(), { vendor: 'https://github.com/HAiO-labs/HAiO-vesting-program', revenue_model: 'permissionless crank releases vested tokens on schedule', integration_cost: 'medium', risk_level: 'low', recommended_mode: 'observe' });
export default HAiOVestingEngine;
