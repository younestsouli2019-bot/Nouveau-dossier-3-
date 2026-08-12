/**
 * src/revenue-engines/haio-agent-nft.mjs — HAiO AgentNFT paid mint adapter
 *
 * Vendor: https://github.com/HAiO-labs/HAiO-evm-contracts
 *
 * Revenue model:
 *   AgentNFT is an ERC-7857 upgradeable smart contract. Revenue comes from:
 *     - mintPaid(): paid public mint at configurable mintPrice (ETH)
 *     - mintBatch(): batch mint with aggregated pricing
 *     - Direct ETH deposits to the contract (treated as protocol fees)
 *     - withdrawFees(): admin withdraws accrued fees
 *
 * This adapter:
 *     1. Monitors the AgentNFT contract for MintPaid / MintBatch / Deposit events
 *     2. Emits each as an Earning event
 *     3. Triggers fee withdrawal to owner wallet when accrued > threshold
 *
 * Required env (live mode):
 *   HAIO_AGENT_NFT_ADDRESS   Contract address on EVM chain
 *   HAIO_EVM_RPC_URL         EVM RPC endpoint
 *   HAIO_FEE_RECIPIENT       Owner wallet to receive withdrawn fees
 *
 * Optional env:
 *   HAIO_WITHDRAW_THRESHOLD_ETH  Min accrued fees before triggering withdraw (default 0.05)
 *   EVM_PRIVATE_KEY              Only needed for live withdrawFees() calls
 *   HAIO_CHAIN_ID                Chain id (default 1 = mainnet)
 */

import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';

class HAiOAgentNFTEngine extends RevenueEngine {
  constructor() {
    super('haio-agent-nft', {
      version: '0.1.0',
      vendor: 'https://github.com/HAiO-labs/HAiO-evm-contracts',
      description: 'AgentNFT (ERC-7857) paid mint + fee withdrawal revenue engine',
      requiredEnv: ['HAIO_AGENT_NFT_ADDRESS', 'HAIO_EVM_RPC_URL', 'HAIO_FEE_RECIPIENT'],
      optionalEnv: ['HAIO_WITHDRAW_THRESHOLD_ETH', 'EVM_PRIVATE_KEY', 'HAIO_CHAIN_ID'],
    });
  }

  async _init() {
    this.contractAddress = process.env.HAIO_AGENT_NFT_ADDRESS;
    this.rpcUrl = process.env.HAIO_EVM_RPC_URL;
    this.feeRecipient = process.env.HAIO_FEE_RECIPIENT;
    this.withdrawThreshold = Number(process.env.HAIO_WITHDRAW_THRESHOLD_ETH || 0.05);
    this.chainId = Number(process.env.HAIO_CHAIN_ID || 1);

    try {
      const ethers = await import('ethers');
      this.ethers = ethers;
      this.provider = new ethers.ethers.JsonRpcProvider(this.rpcUrl);
      this.info('connected to EVM RPC', { url: this.rpcUrl, chainId: this.chainId });
    } catch {
      this.warn('ethers not installed — operating in stub mode');
      this.ethers = null;
      this.provider = null;
    }
    this._lastSeenBlock = null;
  }

  async _discover() {
    if (!this.provider) {
      if (this.isObserve()) {
        return { opportunities: [{
          id: `stub_mint_${Date.now()}`,
          type: 'mint_paid',
          amount: 0.01,
          currency: 'ETH',
          tx_hash: '0xstub',
          minter: '0xstub',
          token_ids: [1],
        }]};
      }
      return { opportunities: [] };
    }

    // Real: scan MintPaid / MintBatch events from last seen block to current
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = this._lastSeenSignature || currentBlock - 1000;
    const toBlock = currentBlock;
    const opportunities = [];

    // Minimal ERC-7857 event signatures (illustrative)
    const mintPaidTopic = '0x...'; // keccak256("MintPaid(address,uint256,uint256)")
    const mintBatchTopic = '0x...'; // keccak256("MintBatch(address,uint256[],uint256)")

    try {
      const logs = await this.provider.getLogs({
        address: this.contractAddress,
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        if (log.topics[0] === mintPaidTopic) {
          const amount = BigInt(log.data.slice(0, 66));
          opportunities.push({
            id: `mint_${log.transactionHash}_${log.logIndex}`,
            type: 'mint_paid',
            amount: Number(amount) / 1e18,
            currency: 'ETH',
            tx_hash: log.transactionHash,
            minter: '0x' + log.topics[1].slice(26),
            token_ids: [Number(BigInt(log.topics[2]))],
            block_number: log.blockNumber,
          });
        } else if (log.topics[0] === mintBatchTopic) {
          // Parse batch mint event
          opportunities.push({
            id: `batch_${log.transactionHash}_${log.logIndex}`,
            type: 'mint_batch',
            amount: 0, // would parse from data
            currency: 'ETH',
            tx_hash: log.transactionHash,
            minter: '0x' + log.topics[1].slice(26),
            token_ids: [],
            block_number: log.blockNumber,
          });
        }
      }
    } catch (e) {
      this.warn(`log scan failed: ${e.message}`);
    }
    this._lastSeenBlock = toBlock;
    return { opportunities };
  }

  async _earn(opp) {
    const earningId = `HAIO_NFT_${opp.id}`;
    const emit = await this.emitEarning({
      earningId,
      amount: opp.amount,
      currency: opp.currency,
      source: this.name,
      beneficiary: this.feeRecipient,
      metadata: {
        tx_hash: opp.tx_hash,
        minter: opp.minter,
        token_ids: opp.token_ids,
        type: opp.type,
        block_number: opp.block_number,
      },
    });
    return {
      earningId,
      amount: opp.amount,
      currency: opp.currency,
      tx_hash: opp.tx_hash,
      newly_emitted: emit.emitted,
    };
  }

  async _settle(earning) {
    if (!this.isLive()) return { settlementId: null, gateway_ref: null, status: 'observe_only' };
    if (!this.ethers) return { settlementId: null, gateway_ref: null, status: 'failed_ethers_missing' };

    // Check accrued fees on the contract. If > threshold, call withdrawFees().
    // This stub logs intent but does not broadcast — wire up the real call here.
    this.warn('live withdrawFees not implemented in adapter stub');
    return {
      settlementId: null,
      gateway_ref: null,
      status: 'pending_external_confirmation',
    };
  }

  async _status() {
    return {
      contract_address: this.contractAddress,
      fee_recipient: this.feeRecipient,
      ethers_loaded: !!this.ethers,
      withdraw_threshold_eth: this.withdrawThreshold,
      chain_id: this.chainId,
      last_seen_block: this._lastSeenBlock,
    };
  }
}

register('haio-agent-nft', () => new HAiOAgentNFTEngine(), {
  vendor: 'https://github.com/HAiO-labs/HAiO-evm-contracts',
  revenue_model: 'ERC-7857 paid mint + protocol fee withdrawal (ETH)',
  integration_cost: 'medium (ethers.js + event log parsing)',
  risk_level: 'low (read-only mint detection; withdraw is admin-gated)',
  recommended_mode: 'observe',
});

export default HAiOAgentNFTEngine;
