/**
 * src/revenue-engines/haio-solana.mjs — HAiO Revenue Engine adapter
 *
 * Vendor: https://github.com/HAiO-labs/HAiO-revenue-engine
 *
 * Revenue model:
 *   On-chain Solana RevenueEngine program. External revenue (USDC) flows into
 *   the agent's wallet from AI service modules. The off-chain worker:
 *     1. Detects inbound USDC transfers to AGENT_WALLET
 *     2. Swaps a portion to ATH (operational cost token) — optional
 *     3. Swaps the remainder to native $HAiO token
 *     4. Burns a configurable portion of $HAiO (deflationary)
 *     5. Transfers net $HAiO to the on-chain Revenue Safe
 *     6. RevenueEngine program triggers transparent distribution
 *
 * Earning trigger: any new USDC inflow to AGENT_WALLET becomes an Earning event.
 *
 * Required env (live mode):
 *   HAIO_AGENT_WALLET          Solana agent wallet pubkey
 *   HAIO_RPC_URL               Solana RPC endpoint
 *   HAIO_REVENUE_SAFE          Revenue Safe pubkey (distribution target)
 *   HAIO_SWAP_PROGRAM          Mock swap program id
 *   HAIO_BURN_PCT              Percentage of $HAiO to burn (e.g. "10")
 *   HAIO_OPERATIONAL_PCT       Percentage to swap to ATH (e.g. "20")
 *   SOLANA_PRIVATE_KEY         Agent wallet signing key
 *
 * Optional env:
 *   HAIO_USDC_MINT             USDC SPL token mint (defaults to mainnet USDC)
 *   HAIO_HAIO_MINT             $HAiO SPL token mint
 *   HAIO_ATH_MINT              ATH SPL token mint
 */

import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';

class HAiOSolanaEngine extends RevenueEngine {
  constructor() {
    super('haio-solana', {
      version: '0.1.0',
      vendor: 'https://github.com/HAiO-labs/HAiO-revenue-engine',
      description: 'HAiO on-chain Solana RevenueEngine: USDC inflow → swap → burn → distribute',
      requiredEnv: [
        'HAIO_AGENT_WALLET',
        'HAIO_RPC_URL',
        'HAIO_REVENUE_SAFE',
      ],
      optionalEnv: [
        'HAIO_SWAP_PROGRAM',
        'HAIO_BURN_PCT',
        'HAIO_OPERATIONAL_PCT',
        'SOLANA_PRIVATE_KEY',
        'HAIO_USDC_MINT',
        'HAIO_HAIO_MINT',
        'HAIO_ATH_MINT',
      ],
    });
  }

  async _init() {
    // In observe mode we just need read access to the RPC
    this.agentWallet = process.env.HAIO_AGENT_WALLET;
    this.rpcUrl = process.env.HAIO_RPC_URL;
    this.revenueSafe = process.env.HAIO_REVENUE_SAFE;
    this.burnPct = Number(process.env.HAIO_BURN_PCT || 10);
    this.opPct = Number(process.env.HAIO_OPERATIONAL_PCT || 20);
    this.usdcMint = process.env.HAIO_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.haioMint = process.env.HAIO_HAIO_MINT;
    this.athMint = process.env.HAIO_ATH_MINT;

    // Try to load @solana/web3.js (optional)
    try {
      const mod = await import('@solana/web3.js');
      this.solana = mod;
      this.connection = new this.solana.Connection(this.rpcUrl, 'confirmed');
      this.info('connected to Solana RPC', { url: this.rpcUrl });
    } catch (e) {
      this.warn('@solana/web3.js not installed — operating in stub mode');
      this.solana = null;
      this.connection = null;
    }

    // Track last-seen signature for incremental scanning
    this._lastSeenSignature = null;
  }

  async _discover() {
    if (!this.connection) {
      // Stub: synthesize one fake opportunity in observe mode
      if (this.isObserve()) {
        return {
          opportunities: [{
            id: `stub_inflow_${Date.now()}`,
            type: 'usdc_inflow',
            amount: 1.0,
            currency: 'USDC',
            signature: 'stub',
            from: 'stub_source',
            block_time: Math.floor(Date.now() / 1000),
          }],
        };
      }
      return { opportunities: [] };
    }

    // Real: fetch recent signatures for the agent wallet
    const sigs = await this.connection.getSignaturesForAddress(
      new this.solana.PublicKey(this.agentWallet),
      { limit: 50 }
    );
    const newSigs = this._lastSeenSignature
      ? sigs.filter(s => s.signature !== this._lastSeenSignature)
      : sigs;
    if (sigs[0]) this._lastSeenSignature = sigs[0].signature;

    // Filter for incoming USDC transfers (parse transaction)
    const opportunities = [];
    for (const sigInfo of newSigs) {
      if (sigInfo.err) continue;
      try {
        const tx = await this.connection.getParsedTransaction(sigInfo.signature, 'confirmed');
        const inflow = this._extractUsdcInflow(tx);
        if (inflow && inflow.amount > 0) {
          opportunities.push({
            id: `inflow_${sigInfo.signature}`,
            type: 'usdc_inflow',
            amount: inflow.amount,
            currency: 'USDC',
            signature: sigInfo.signature,
            from: inflow.from,
            block_time: sigInfo.blockTime,
          });
        }
      } catch (e) {
        this.debug(`skip sig ${sigInfo.signature}: ${e.message}`);
      }
    }
    return { opportunities };
  }

  _extractUsdcInflow(tx) {
    if (!tx || !tx.meta || !tx.transaction) return null;
    const instructions = tx.transaction.message.instructions || [];
    for (const ix of instructions) {
      if (ix.parsed && ix.parsed.type === 'transfer' && ix.parsed.info) {
        const info = ix.parsed.info;
        if (info.destination === this.agentWallet) {
          // Check mint is USDC
          // (In production, also check tokenAmount.uiAmount and mint)
          return {
            amount: Number(info.amount) / 1e6, // USDC has 6 decimals
            from: info.source,
          };
        }
      }
    }
    return null;
  }

  async _earn(opp) {
    const earningId = `HAIO_${opp.id}`;
    const beneficiary = this.revenueSafe || this.agentWallet;
    const emit = await this.emitEarning({
      earningId,
      amount: opp.amount,
      currency: 'USDC',
      source: this.name,
      beneficiary,
      metadata: {
        signature: opp.signature,
        from: opp.from,
        block_time: opp.block_time,
        planned_burn_pct: this.burnPct,
        planned_operational_pct: this.opPct,
      },
    });
    return {
      earningId,
      amount: opp.amount,
      currency: 'USDC',
      signature: opp.signature,
      newly_emitted: emit.emitted,
    };
  }

  async _settle(earning) {
    if (!this.isLive()) {
      return { settlementId: null, gateway_ref: null, status: 'observe_only' };
    }
    if (!this.solana) {
      return { settlementId: null, gateway_ref: null, status: 'failed_solana_sdk_missing' };
    }
    // Real settlement: compose swap + burn + transfer tx, sign, broadcast.
    // This stub refuses to send — wire up the actual program calls here once
    // you have a funded keypair and the on-chain programs deployed.
    this.warn('live settlement not implemented in adapter stub; delegating to on-chain program');
    return {
      settlementId: null,
      gateway_ref: null,
      status: 'failed_live_not_implemented',
    };
  }

  async _status() {
    return {
      agent_wallet: this.agentWallet,
      revenue_safe: this.revenueSafe,
      solana_sdk_loaded: !!this.solana,
      burn_pct: this.burnPct,
      operational_pct: this.opPct,
      last_seen_signature: this._lastSeenSignature,
    };
  }
}

register('haio-solana', () => new HAiOSolanaEngine(), {
  vendor: 'https://github.com/HAiO-labs/HAiO-revenue-engine',
  revenue_model: 'on-chain USDC inflow → swap to $HAiO → burn % → distribute to Revenue Safe',
  integration_cost: 'high (Solana SDK + on-chain program interaction)',
  risk_level: 'high (involves on-chain fund movement)',
  recommended_mode: 'observe',
});

export default HAiOSolanaEngine;
