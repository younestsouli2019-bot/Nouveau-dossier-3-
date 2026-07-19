/**
 * Transaction Monitor — core scanning engine.
 * Orchestrates block scanning across all enabled L2 networks.
 */

import { ethers } from 'ethers';
import { getConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';
import {
  getLastScannedBlock,
  setLastScannedBlock,
  saveTransactions,
  saveDailySummary,
} from '../utils/store.js';

export class TransactionMonitor {
  constructor(providers, walletManager) {
    this.providers = providers;
    this.walletManager = walletManager;
    this._logger = getLogger();
    this._running = false;
    this._lastScanResults = {};
  }

  /**
   * Run a full scan across all enabled networks.
   */
  async scanAll() {
    if (this._running) {
      this._logger.warn('[MONITOR] Scan already in progress — skipping');
      return this._lastScanResults;
    }

    this._running = true;
    const config = getConfig();
    const watchAddresses = this.walletManager.getWatchAddresses();
    const results = {};
    const today = new Date().toISOString().split('T')[0];

    this._logger.info(`[MONITOR] Starting full scan for ${watchAddresses.length} addresses across ${config.enabledNetworkKeys.length} networks`);

    try {
      for (const networkKey of config.enabledNetworkKeys) {
        const provider = this.providers[networkKey];
        if (!provider || !provider.connected) {
          this._logger.warn(`[MONITOR] Skipping ${networkKey} — not connected`);
          continue;
        }

        try {
          const result = await this._scanNetwork(provider, watchAddresses, config);
          results[networkKey] = result;

          // Save transactions
          if (result.transactions.length > 0) {
            await saveTransactions(networkKey, today, result.transactions);
          }
        } catch (err) {
          this._logger.error(`[MONITOR] Scan failed for ${networkKey}: ${err.message}`);
          results[networkKey] = { error: err.message, transactions: [] };
        }
      }

      // Save daily summary
      const summary = {};
      for (const [key, result] of Object.entries(results)) {
        summary[key] = {
          network: this.providers[key].network.name,
          blocksScanned: result.blocksScanned || 0,
          transactionsFound: result.transactions?.length || 0,
          inbound: result.transactions?.filter(t => t.direction === 'inbound').length || 0,
          outbound: result.transactions?.filter(t => t.direction === 'outbound').length || 0,
          totalValueEth: result.transactions
            ?.filter(t => t.direction === 'inbound')
            .reduce((sum, t) => sum + parseFloat(t.valueEth || 0), 0) || 0,
        };
      }
      await saveDailySummary(today, summary);

      this._lastScanResults = results;
      this._logger.info(`[MONITOR] Full scan complete — ${Object.keys(results).length} networks processed`);
    } finally {
      this._running = false;
    }

    return results;
  }

  /**
   * Scan a single network for transactions.
   */
  async _scanNetwork(provider, watchAddresses, config) {
    const networkKey = provider.network.key;
    const transactions = [];
    let blocksScanned = 0;

    // Determine block range
    const currentBlock = await provider.getBlockNumber();
    const lastScanned = await getLastScannedBlock(networkKey);

    let fromBlock;
    if (lastScanned > 0 && lastScanned < currentBlock) {
      fromBlock = lastScanned + 1;
    } else if (config.blocksPerScan > 0) {
      fromBlock = Math.max(0, currentBlock - config.blocksPerScan);
    } else {
      fromBlock = currentBlock - 1000; // Default: last 1000 blocks
    }

    const toBlock = currentBlock;

    if (fromBlock > toBlock) {
      this._logger.info(`[${networkKey}] Already up to date (block ${currentBlock})`);
      return { transactions: [], blocksScanned: 0, fromBlock, toBlock };
    }

    this._logger.info(`[${networkKey}] Scanning blocks ${fromBlock} → ${toBlock} (${toBlock - fromBlock + 1} blocks)`);

    // Scan native ETH transactions
    try {
      const ethTxs = await provider.scanBlocks(fromBlock, toBlock, watchAddresses);

      // Filter by minimum value
      const filtered = ethTxs.filter(tx => {
        const val = parseFloat(tx.valueEth || 0);
        return val >= config.minTxValueEth;
      });

      transactions.push(...filtered);
    } catch (err) {
      this._logger.error(`[${networkKey}] ETH scan error: ${err.message}`);
    }

    // Scan ERC-20 transfers if enabled
    if (config.trackErc20) {
      try {
        const erc20Transfers = await provider.scanERC20Transfers(fromBlock, toBlock, watchAddresses);
        transactions.push(...erc20Transfers);
      } catch (err) {
        this._logger.error(`[${networkKey}] ERC-20 scan error: ${err.message}`);
      }
    }

    // Update last scanned block
    await setLastScannedBlock(networkKey, toBlock);
    blocksScanned = toBlock - fromBlock + 1;

    this._logger.info(
      `[${networkKey}] Scan complete: ${transactions.length} txs found in ${blocksScanned} blocks`
    );

    return { transactions, blocksScanned, fromBlock, toBlock };
  }

  /**
   * Scan a single network on demand.
   */
  async scanNetwork(networkKey, blockRange = null) {
    const provider = this.providers[networkKey];
    if (!provider || !provider.connected) {
      throw new Error(`Network ${networkKey} is not connected`);
    }

    const config = getConfig();
    const watchAddresses = this.walletManager.getWatchAddresses();

    if (blockRange) {
      const { from, to } = blockRange;
      const txs = await provider.scanBlocks(from, to, watchAddresses);
      return { transactions: txs, fromBlock: from, toBlock: to };
    }

    return await this._scanNetwork(provider, watchAddresses, config);
  }

  /**
   * Get the last scan results.
   */
  getLastResults() {
    return this._lastScanResults;
  }

  /**
   * Check if a scan is currently running.
   */
  isRunning() {
    return this._running;
  }
}
