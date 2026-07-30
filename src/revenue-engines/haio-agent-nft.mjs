import RevenueEngine from './base.mjs';
import { register } from './registry.mjs';

class HAiOAgentNFTEngine extends RevenueEngine {
  constructor() { super('haio-agent-nft', { version: '0.1.0', vendor: 'https://github.com/HAiO-labs/HAiO-evm-contracts', description: 'AgentNFT (ERC-7857) paid mint + fee withdrawal', requiredEnv: ['HAIO_AGENT_NFT_ADDRESS', 'HAIO_EVM_RPC_URL', 'HAIO_FEE_RECIPIENT'], optionalEnv: ['HAIO_WITHDRAW_THRESHOLD_ETH', 'EVM_PRIVATE_KEY', 'HAIO_CHAIN_ID'] }); }

  async _init() {
    this.contractAddress = process.env.HAIO_AGENT_NFT_ADDRESS; this.rpcUrl = process.env.HAIO_EVM_RPC_URL; this.feeRecipient = process.env.HAIO_FEE_RECIPIENT;
    this.withdrawThreshold = Number(process.env.HAIO_WITHDRAW_THRESHOLD_ETH || 0.05); this.chainId = Number(process.env.HAIO_CHAIN_ID || 1);
    try { const ethers = await import('ethers'); this.ethers = ethers; this.provider = new ethers.ethers.JsonRpcProvider(this.rpcUrl); this.info('connected to EVM RPC', { chainId: this.chainId }); }
    catch { this.warn('ethers not installed — stub mode'); this.ethers = null; this.provider = null; }
    this._lastSeenBlock = null;
  }

  async _discover() {
    if (!this.provider) { if (this.isObserve()) return { opportunities: [{ id: `stub_mint_${Date.now()}`, type: 'mint_paid', amount: 0.01, currency: 'ETH', tx_hash: '0xstub', minter: '0xstub', token_ids: [1] }] }; return { opportunities: [] }; }
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = this._lastSeenBlock || currentBlock - 1000;
    this._lastSeenBlock = currentBlock;
    try {
      const logs = await this.provider.getLogs({ address: this.contractAddress, fromBlock, toBlock: currentBlock });
      const mintPaidTopic = '0x' + require('crypto').createHash('keccak256').update('MintPaid(address,uint256,uint256)').digest('hex').substring(0, 66);
      const opportunities = logs.filter(l => l.topics[0] === mintPaidTopic).map(l => ({ id: `mint_${l.transactionHash}_${l.logIndex}`, type: 'mint_paid', amount: Number(BigInt(l.data.slice(0, 66))) / 1e18, currency: 'ETH', tx_hash: l.transactionHash, minter: '0x' + l.topics[1].slice(26), token_ids: [Number(BigInt(l.topics[2]))] }));
      return { opportunities };
    } catch (e) { this.warn(`log scan failed: ${e.message}`); return { opportunities: [] }; }
  }

  async _earn(opp) { const earningId = `HAIO_NFT_${opp.id}`; const emit = await this.emitEarning({ earningId, amount: opp.amount, currency: opp.currency, source: this.name, beneficiary: this.feeRecipient, metadata: { tx_hash: opp.tx_hash, minter: opp.minter, token_ids: opp.token_ids, type: opp.type } }); return { earningId, amount: opp.amount, currency: opp.currency, newly_emitted: emit.emitted }; }
  async _settle(earning) { return { settlementId: null, gateway_ref: null, status: this.isLive() ? 'pending_external_confirmation' : 'observe_only' }; }
  async _status() { return { contract_address: this.contractAddress, fee_recipient: this.feeRecipient, ethers_loaded: !!this.ethers, withdraw_threshold_eth: this.withdrawThreshold, last_seen_block: this._lastSeenBlock }; }
}

register('haio-agent-nft', () => new HAiOAgentNFTEngine(), { vendor: 'https://github.com/HAiO-labs/HAiO-evm-contracts', revenue_model: 'ERC-7857 paid mint + protocol fee withdrawal (ETH)', integration_cost: 'medium', risk_level: 'low', recommended_mode: 'observe' });
export default HAiOAgentNFTEngine;
