import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';

class HAiOTxGatewayEngine extends RevenueEngine {
  constructor() {
    super('haio-tx-gateway', { version: '0.1.0', vendor: 'https://github.com/HAiO-labs/HAiO-solana-programs', description: 'HAiO Transaction Gateway: membership payments + deposits (multi-token)', requiredEnv: ['HAIO_TX_GATEWAY_PROGRAM', 'HAIO_RPC_URL', 'HAIO_TREASURY_WALLET'], optionalEnv: ['HAIO_SUPPORTED_MINTS', 'HAIO_MIN_PAYMENT_USD', 'SOLANA_PRIVATE_KEY'] });
  }

  async _init() {
    this.programId = process.env.HAIO_TX_GATEWAY_PROGRAM; this.rpcUrl = process.env.HAIO_RPC_URL; this.treasury = process.env.HAIO_TREASURY_WALLET;
    this.supportedMints = (process.env.HAIO_SUPPORTED_MINTS || '').split(',').filter(Boolean); this.minPaymentUsd = Number(process.env.HAIO_MIN_PAYMENT_USD || 0.01);
    try { const mod = await import('@solana/web3.js'); this.solana = mod; this.connection = new this.solana.Connection(this.rpcUrl, 'confirmed'); this.info('connected to Solana RPC'); }
    catch { this.warn('@solana/web3.js not installed — stub mode'); this.solana = null; this.connection = null; }
    this._lastSeenSignature = null;
  }

  async _discover() {
    if (!this.connection) { if (this.isObserve()) return { opportunities: [{ id: `stub_membership_${Date.now()}`, type: 'membership_payment', amount: 9.99, currency: 'USDC', tier: 'pro_monthly', signature: 'stub', payer: 'stub_payer' }] }; return { opportunities: [] }; }
    const sigs = await this.connection.getSignaturesForAddress(new this.solana.PublicKey(this.programId), { limit: 50 });
    const newSigs = this._lastSeenSignature ? sigs.filter(s => s.signature !== this._lastSeenSignature) : sigs;
    if (sigs[0]) this._lastSeenSignature = sigs[0].signature;
    const opportunities = [];
    for (const sigInfo of newSigs) {
      if (sigInfo.err) continue;
      try {
        const tx = await this.connection.getParsedTransaction(sigInfo.signature, 'confirmed');
        for (const log of tx?.meta?.logMessages || []) {
          const m = log.match(/Membership=(\d+)\s+tier=(\w+)/); if (m) opportunities.push({ id: `gw_${sigInfo.signature}`, type: 'membership_payment', amount: Number(m[1]) / 1e6, currency: 'USDC', tier: m[2], signature: sigInfo.signature, payer: tx?.transaction?.message?.accountKeys?.[0]?.toString() || '', block_time: sigInfo.blockTime });
        }
      } catch {}
    }
    return { opportunities };
  }

  async _earn(opp) { const earningId = `HAIO_GW_${opp.id}`; const emit = await this.emitEarning({ earningId, amount: opp.amount, currency: opp.currency, source: this.name, beneficiary: this.treasury, metadata: { signature: opp.signature, payer: opp.payer, tier: opp.tier, type: opp.type } }); return { earningId, amount: opp.amount, currency: opp.currency, newly_emitted: emit.emitted }; }
  async _settle(earning) { return { settlementId: null, gateway_ref: null, status: this.isLive() ? 'pending_external_confirmation' : 'observe_only' }; }
  async _status() { return { program_id: this.programId, treasury: this.treasury, solana_sdk_loaded: !!this.solana }; }
}

register('haio-tx-gateway', () => new HAiOTxGatewayEngine(), { missionId: '68c73bbe3efa5daf0a6709aa', vendor: 'https://github.com/HAiO-labs/HAiO-solana-programs', revenue_model: 'membership payments + deposits (multi-token) on Solana', integration_cost: 'medium', risk_level: 'low', recommended_mode: 'observe' });
export default HAiOTxGatewayEngine;
