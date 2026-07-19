/**
 * Base L2 Provider class — all network providers extend this.
 * Handles RPC connection, block scanning, and transaction parsing.
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';

export class BaseL2Provider extends EventEmitter {
  /**
   * @param {object} networkConfig - From config.networks[key]
   * @param {object} options - { maxConcurrent, timeout }
   */
  constructor(networkConfig, options = {}) {
    super();
    this.network = networkConfig;
    this.maxConcurrent = options.maxConcurrent || 5;
    this.timeout = options.timeout || 30000;
    this.provider = null;
    this.connected = false;
    this._retryCount = 0;
    this._maxRetries = 3;
  }

  /**
   * Initialize the JSON-RPC provider with fallback support.
   */
  async connect() {
    const rpcUrls = [this.network.rpcUrl, ...this.network.fallbackRpcs].filter(Boolean);

    for (const url of rpcUrls) {
      try {
        const provider = new ethers.JsonRpcProvider(url, undefined, {
          staticNetwork: true,
          batchMaxCount: 10,
          batchStallTime: 10,
        });

        // Verify connection by getting network
        const net = await provider.getNetwork();
        if (Number(net.chainId) === this.network.chainId) {
          this.provider = provider;
          this.connected = true;
          this._retryCount = 0;
          this.emit('connected', { network: this.network.key, chainId: this.network.chainId });
          return true;
        } else {
          console.warn(
            `[${this.network.key}] Chain ID mismatch: expected ${this.network.chainId}, got ${Number(net.chainId)}`
          );
        }
      } catch (err) {
        console.warn(`[${this.network.key}] Failed to connect to ${url}: ${err.message}`);
      }
    }

    this.connected = false;
    this.emit('error', { network: this.network.key, error: 'All RPC endpoints failed' });
    return false;
  }

  /**
   * Ensure provider is connected, reconnect if needed.
   */
  async ensureConnected() {
    if (!this.connected || !this.provider) {
      await this.connect();
    }
    return this.connected;
  }

  /**
   * Get the current block number.
   */
  async getBlockNumber() {
    await this.ensureConnected();
    return this.provider.getBlockNumber();
  }

  /**
   * Get a block with transactions by number.
   */
  async getBlockWithTxs(blockNumber) {
    await this.ensureConnected();
    const block = await this.provider.getBlock(blockNumber, true);
    return block;
  }

  /**
   * Get a transaction receipt.
   */
  async getTransactionReceipt(txHash) {
    await this.ensureConnected();
    return this.provider.getTransactionReceipt(txHash);
  }

  /**
   * Get ETH balance for an address.
   */
  async getBalance(address, blockTag = 'latest') {
    await this.ensureConnected();
    return this.provider.getBalance(address, blockTag);
  }

  /**
   * Scan a range of blocks for transactions involving the given addresses.
   * Returns an array of transaction objects.
   */
  async scanBlocks(fromBlock, toBlock, watchAddresses = []) {
    await this.ensureConnected();

    const addressSet = new Set(watchAddresses.map(a => a.toLowerCase()));
    const transactions = [];
    const totalBlocks = toBlock - fromBlock + 1;

    this.emit('scan:start', {
      network: this.network.key,
      fromBlock,
      toBlock,
      totalBlocks,
    });

    // Process blocks in batches to respect rate limits
    const BATCH_SIZE = 50;
    for (let batchStart = fromBlock; batchStart <= toBlock; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, toBlock);

      // Fetch blocks concurrently within the batch
      const promises = [];
      for (let bn = batchStart; bn <= batchEnd; bn++) {
        promises.push(
          this.provider.getBlock(bn, true).catch(err => {
            this.emit('scan:error', { block: bn, error: err.message });
            return null;
          })
        );
      }

      const blocks = await Promise.all(promises);

      for (const block of blocks) {
        if (!block || !block.prefetchedTransactions) continue;

        for (const tx of block.prefetchedTransactions) {
          const from = (tx.from || '').toLowerCase();
          const to = (tx.to || '').toLowerCase();

          if (addressSet.has(from) || addressSet.has(to)) {
            transactions.push({
              networkKey: this.network.key,
              networkName: this.network.name,
              chainId: this.network.chainId,
              hash: tx.hash,
              from: tx.from,
              to: tx.to || null,
              value: tx.value.toString(),
              valueEth: ethers.formatEther(tx.value),
              gasPrice: tx.gasPrice?.toString() || '0',
              gasLimit: tx.gasLimit?.toString() || '0',
              blockNumber: tx.blockNumber,
              blockTimestamp: block.timestamp,
              nonce: tx.nonce,
              data: tx.data,
              // Computed fields
              direction: addressSet.has(to) ? 'inbound' : (addressSet.has(from) ? 'outbound' : 'unknown'),
              explorerUrl: `${this.network.explorer}/tx/${tx.hash}`,
            });
          }
        }
      }

      this.emit('scan:progress', {
        network: this.network.key,
        scanned: Math.min(batchEnd - fromBlock + 1, totalBlocks),
        total: totalBlocks,
        found: transactions.length,
      });
    }

    this.emit('scan:complete', {
      network: this.network.key,
      fromBlock,
      toBlock,
      transactionsFound: transactions.length,
    });

    return transactions;
  }

  /**
   * Detect ERC-20 transfers in logs for given addresses.
   */
  async scanERC20Transfers(fromBlock, toBlock, watchAddresses = []) {
    await this.ensureConnected();

    const addressSet = new Set(watchAddresses.map(a => a.toLowerCase()));
    const transfers = [];

    // ERC20 Transfer event signature
    const transferTopic = ethers.id('Transfer(address,address,uint256)');

    const BATCH_SIZE = 10000;
    for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, toBlock);

      try {
        const logs = await this.provider.getLogs({
          fromBlock: start,
          toBlock: end,
          topics: [transferTopic],
        });

        for (const log of logs) {
          if (log.topics.length < 3) continue;

          const from = '0x' + log.topics[1].slice(26);
          const to = '0x' + log.topics[2].slice(26);

          if (addressSet.has(from.toLowerCase()) || addressSet.has(to.toLowerCase())) {
            transfers.push({
              networkKey: this.network.key,
              networkName: this.network.name,
              chainId: this.network.chainId,
              tokenContract: log.address,
              from,
              to,
              amount: log.data,
              transactionHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.index,
              direction: addressSet.has(to.toLowerCase()) ? 'inbound' : 'outbound',
              explorerUrl: `${this.network.explorer}/tx/${log.transactionHash}`,
            });
          }
        }
      } catch (err) {
        this.emit('scan:error', { range: `${start}-${end}`, error: err.message });
      }
    }

    return transfers;
  }

  /**
   * Disconnect and clean up.
   */
  disconnect() {
    this.provider = null;
    this.connected = false;
    this.emit('disconnected', { network: this.network.key });
  }
}
