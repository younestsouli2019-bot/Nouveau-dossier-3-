/**
 * src/revenue-engines/haio-tx-gateway.mjs — HAiO Transaction Gateway adapter
 *
 * Vendor: https://github.com/HAiO-labs/HAiO-solana-programs
 *   (Program 5: "Transaction Gateway Program — managing membership payments
 *   and deposits with multi-token support")
 *
 * Revenue model:
 *   The Transaction Gateway is a Solana program that accepts membership
 *   payments and deposits in multiple SPL tokens. This adapter:
 *     1. Monitors the gateway program's event stream for new payment events
 *     2. Emits each payment as an Earning event
 *     3. Routes settlement to the owner via the existing payout pipeline
 *
 * Earning trigger: any new membership payment or deposit event from the
 * Transaction Gateway program.
 *
 * Required env (live mode):
 *   HAIO_TX_GATEWAY_PROGRAM  Solana program id of the Transaction Gateway
 *   HAIO_RPC_URL             Solana RPC endpoint
 *   HAIO_TREASURY_WALLET     Treasury wallet that receives the payments
 *   SOLANA_PRIVATE_KEY       (only if withdrawing from treasury)
 *
 * Optional env:
 *   HAIO_SUPPORTED_MINTS     Comma-separated list of accepted SPL mints
 *   HAIO_MIN_PAYMENT_USD     Minimum payment to record (default 0.01)
 */

import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';

class HAiOTxGatewayEngine extends RevenueEngine {
  constructor() {
    super('haio-tx-gateway', {
      version: '0.1.0',
      vendor: 'https://github.com/HAiO-labs/HAiO-solana-programs',
      description: 'HAiO Transaction Gateway: membership payments + deposits (multi-token)',
      requiredEnv: ['HAIO_TX_GATEWAY_PROGRAM', 'HAIO_RPC_URL', 'HAIO_TREASURY_WALLET'],
      optionalEnv: ['HAIO_SUPPORTED_MINTS', 'HAIO_MIN_PAYMENT_USD', 'SOLANA_PRIVATE_KEY'],
    });
  }

  async _init() {
    this.programId = process.env.HAIO_TX_GATEWAY_PROGRAM;
    this.rpcUrl = process.env.HAIO_RPC_URL;
    this.treasury = process.env.HAIO_TREASURY_WALLET;
    this.supportedMints = (process.env.HAIO_SUPPORTED_MINTS || '').split(',').filter(Boolean);
    this.minPaymentUsd = Number(process.env.HAIO_MIN_PAYMENT_USD || 0.01);

    try {
      const mod = await import('@solana/web3.js');
      this.solana = mod;
      this.connection = new this.solana.Connection(this.rpcUrl, 'confirmed');
      this.info('connected to Solana RPC', { url: this.rpcUrl });
    } catch {
      this.warn('@solana/web3.js not installed — operating in stub mode');
      this.solana = null;
      this.connection = null;
    }
    this._lastSeenSignature = null;
  }

  async _discover() {
    if (!this.connection) {
      if (this.isObserve()) {
        return { opportunities: [{
          id: `stub_membership_${Date.now()}`,
          type: 'membership_payment',
          amount: 9.99,
          currency: 'USDC',
          tier: 'pro_monthly',
          signature: 'stub',
          payer: 'stub_payer',
        }]};
      }
      return { opportunities: [] };
    }

    // Real: get all signatures referencing the program id, parse events
    const sigs = await this.connection.getSignaturesForAddress(
      new this.solana.PublicKey(this.programId),
      { limit: 50 }
    );
    const newSigs = this._lastSeenSignature
      ? sigs.filter(s => s.signature !== this._lastSeenSignature)
      : sigs;
    if (sigs[0]) this._lastSeenSignature = sigs[0].signature;

    const opportunities = [];
    for (const sigInfo of newSigs) {
      if (sigInfo.err) continue;
      try {
        const tx = await this.connection.getParsedTransaction(sigInfo.signature, 'confirmed');
        const events = this._extractGatewayEvents(tx);
        for (const ev of events) {
          opportunities.push({
            id: `gw_${sigInfo.signature}_${ev.idx}`,
            type: ev.type,
            amount: ev.amount,
            currency: ev.currency,
            tier: ev.tier,
            signature: sigInfo.signature,
            payer: ev.payer,
            block_time: sigInfo.blockTime,
          });
        }
      } catch (e) {
        this.debug(`skip sig ${sigInfo.signature}: ${e.message}`);
      }
    }
    return { opportunities };
  }

  _extractGatewayEvents(tx) {
    // Parse logs for membership/deposit events. Real implementation would
    // decode the program's event format.
    const events = [];
    const logs = tx?.meta?.logMessages || [];
    logs.forEach((log, idx) => {
      const m = log.match(/Membership=(\d+)\s+tier=(\w+)/);
      if (m) {
        events.push({
          idx,
          type: 'membership_payment',
          amount: Number(m[1]) / 1e6,
          currency: 'USDC',
          tier: m[2],
          payer: tx?.transaction?.message?.accountKeys?.[0]?.toString() || '',
        });
      }
      const d = log.match(/Deposit=(\d+)\s+mint=(\w+)/);
      if (d) {
        events.push({
          idx,
          type: 'deposit',
          amount: Number(d[1]) / 1e6,
          currency: d[2],
          tier: 'deposit',
          payer: tx?.transaction?.message?.accountKeys?.[0]?.toString() || '',
        });
      }
    });
    return events;
  }

  async _earn(opp) {
    const earningId = `HAIO_GW_${opp.id}`;
    const emit = await this.emitEarning({
      earningId,
      amount: opp.amount,
      currency: opp.currency,
      source: this.name,
      beneficiary: this.treasury,
      metadata: {
        signature: opp.signature,
        payer: opp.payer,
        tier: opp.tier,
        type: opp.type,
        block_time: opp.block_time,
      },
    });
    return {
      earningId,
      amount: opp.amount,
      currency: opp.currency,
      signature: opp.signature,
      tier: opp.tier,
      newly_emitted: emit.emitted,
    };
  }

  async _settle(earning) {
    if (!this.isLive()) return { settlementId: null, gateway_ref: null, status: 'observe_only' };
    // Funds already arrived at treasury on-chain. Settlement here would be
    // a treasury->owner sweep via the existing payout pipeline.
    return { settlementId: null, gateway_ref: null, status: 'pending_external_confirmation' };
  }

  async _status() {
    return {
      program_id: this.programId,
      treasury: this.treasury,
      solana_sdk_loaded: !!this.solana,
      supported_mints: this.supportedMints,
      min_payment_usd: this.minPaymentUsd,
      last_seen_signature: this._lastSeenSignature,
    };
  }
}

register('haio-tx-gateway', () => new HAiOTxGatewayEngine(), {
  vendor: 'https://github.com/HAiO-labs/HAiO-solana-programs',
  revenue_model: 'membership payments + deposits (multi-token) on Solana',
  integration_cost: 'medium (Solana SDK + event log parsing)',
  risk_level: 'low (read-only payment detection; settlement reuses existing rails)',
  recommended_mode: 'observe',
});

export default HAiOTxGatewayEngine;
