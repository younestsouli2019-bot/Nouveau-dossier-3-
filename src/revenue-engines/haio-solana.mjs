import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';

class HAiOSolanaEngine extends RevenueEngine {
  constructor() {
    super('haio-solana', {
      version: '0.1.0',
      vendor: 'https://github.com/HAiO-labs/HAiO-revenue-engine',
      description: 'HAiO on-chain Solana RevenueEngine: USDC inflow → swap → burn → distribute',
      requiredEnv: ['HAIO_AGENT_WALLET', 'HAIO_RPC_URL', 'HAIO_REVENUE_SAFE'],
      optionalEnv: ['HAIO_SWAP_PROGRAM', 'HAIO_BURN_PCT', 'HAIO_OPERATIONAL_PCT', 'SOLANA_PRIVATE_KEY', 'HAIO_USDC_MINT', 'HAIO_HAIO_MINT', 'HAIO_ATH_MINT'],
    });
  }

  async _init() {
    this.agentWallet = process.env.HAIO_AGENT_WALLET;
    this.rpcUrl = process.env.HAIO_RPC_URL;
    this.revenueSafe = process.env.HAIO_REVENUE_SAFE;
    this.burnPct = Number(process.env.HAIO_BURN_PCT || 10);
    this.opPct = Number(process.env.HAIO_OPERATIONAL_PCT || 20);
    this.usdcMint = process.env.HAIO_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.haioMint = process.env.HAIO_HAIO_MINT;
    this.athMint = process.env.HAIO_ATH_MINT;
    try {
      const mod = await import('@solana/web3.js');
      this.solana = mod; this.connection = new this.solana.Connection(this.rpcUrl, 'confirmed');
      this.info('connected to Solana RPC', { url: this.rpcUrl });
    } catch { this.warn('@solana/web3.js not installed — operating in stub mode'); this.solana = null; this.connection = null; }
    this._lastSeenSignature = null;
  }

  async _discover() {
    if (!this.connection) {
      if (this.isObserve()) return { opportunities: [{ id: `stub_inflow_${Date.now()}`, type: 'usdc_inflow', amount: 1.0, currency: 'USDC', signature: 'stub', from: 'stub_source', block_time: Math.floor(Date.now() / 1000) }] };
      return { opportunities: [] };
    }
    const sigs = await this.connection.getSignaturesForAddress(new this.solana.PublicKey(this.agentWallet), { limit: 50 });
    const newSigs = this._lastSeenSignature ? sigs.filter(s => s.signature !== this._lastSeenSignature) : sigs;
    if (sigs[0]) this._lastSeenSignature = sigs[0].signature;
    const opportunities = [];
    for (const sigInfo of newSigs) {
      if (sigInfo.err) continue;
      try {
        const tx = await this.connection.getParsedTransaction(sigInfo.signature, 'confirmed');
        const inflow = this._extractUsdcInflow(tx);
        if (inflow && inflow.amount > 0) opportunities.push({ id: `inflow_${sigInfo.signature}`, type: 'usdc_inflow', amount: inflow.amount, currency: 'USDC', signature: sigInfo.signature, from: inflow.from, block_time: sigInfo.blockTime });
      } catch {}
    }
    return { opportunities };
  }

  _extractUsdcInflow(tx) {
    if (!tx || !tx.meta || !tx.transaction) return null;
    for (const ix of tx.transaction.message.instructions || []) {
      if (ix.parsed && ix.parsed.type === 'transfer' && ix.parsed.info && ix.parsed.info.destination === this.agentWallet) {
        return { amount: Number(ix.parsed.info.amount) / 1e6, from: ix.parsed.info.source };
      }
    }
    return null;
  }

  async _earn(opp) {
    const earningId = `HAIO_${opp.id}`;
    const emit = await this.emitEarning({ earningId, amount: opp.amount, currency: 'USDC', source: this.name, beneficiary: this.revenueSafe || this.agentWallet, metadata: { signature: opp.signature, from: opp.from, block_time: opp.block_time, planned_burn_pct: this.burnPct, planned_operational_pct: this.opPct } });
    return { earningId, amount: opp.amount, currency: 'USDC', signature: opp.signature, newly_emitted: emit.emitted };
  }

  async _settle(earning) {
    if (!this.isLive()) return { settlementId: null, gateway_ref: null, status: 'observe_only' };
    return { settlementId: null, gateway_ref: null, status: 'pending_external_confirmation' };
  }

  async _status() {
    return { agent_wallet: this.agentWallet, revenue_safe: this.revenueSafe, solana_sdk_loaded: !!this.solana, burn_pct: this.burnPct, operational_pct: this.opPct, last_seen_signature: this._lastSeenSignature };
  }
}

register('haio-solana', () => new HAiOSolanaEngine(), { vendor: 'https://github.com/HAiO-labs/HAiO-revenue-engine', revenue_model: 'on-chain USDC inflow → swap to $HAiO → burn % → distribute', integration_cost: 'high', risk_level: 'high', recommended_mode: 'observe' });
export default HAiOSolanaEngine;
