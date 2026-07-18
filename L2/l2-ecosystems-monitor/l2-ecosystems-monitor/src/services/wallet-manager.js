/**
 * Wallet Manager — manages owner accounts and optional transaction submission.
 * Private keys are loaded from environment and NEVER logged or exposed.
 */

import { ethers } from 'ethers';
import { getConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';

export class WalletManager {
  constructor(providers) {
    this.providers = providers;
    this.wallets = {};
    this.addresses = [];
    this._logger = getLogger();
  }

  /**
   * Initialize wallets from config.
   * In monitor-only mode, only addresses are loaded.
   * In tx mode, private keys create Wallet instances bound to providers.
   */
  async init() {
    const config = getConfig();

    // Load watch addresses
    this.addresses = config.ownerAddresses;
    this._logger.info(`[WALLET] Loaded ${this.addresses.length} owner addresses`);

    if (!config.hasPrivateKeys) {
      this._logger.info('[WALLET] Running in MONITOR-ONLY mode (no private keys)');
      return;
    }

    // Create wallets for each network where we have providers
    for (const [networkKey, provider] of Object.entries(this.providers)) {
      if (!provider.connected) continue;

      this.wallets[networkKey] = [];
      for (let i = 0; i < config.ownerPrivateKeys.length; i++) {
        try {
          const wallet = new ethers.Wallet(config.ownerPrivateKeys[i], provider.provider);
          this.wallets[networkKey].push({
            address: wallet.address,
            wallet,
            networkKey,
            index: i,
          });
          this._logger.info(
            `[WALLET] Wallet ${i} connected on ${networkKey}: ${wallet.address.substring(0, 10)}...`
          );
        } catch (err) {
          this._logger.error(`[WALLET] Failed to create wallet ${i} on ${networkKey}: ${err.message}`);
        }
      }
    }

    const totalWallets = Object.values(this.wallets).reduce((sum, w) => sum + w.length, 0);
    this._logger.info(`[WALLET] Initialized ${totalWallets} wallets across ${Object.keys(this.wallets).length} networks`);
  }

  /**
   * Get all watch addresses (lowercased).
   */
  getWatchAddresses() {
    return this.addresses;
  }

  /**
   * Get balances for all owner addresses across all connected networks.
   */
  async getBalances() {
    const balances = {};

    for (const [networkKey, provider] of Object.entries(this.providers)) {
      if (!provider.connected) continue;

      balances[networkKey] = {
        network: provider.network.name,
        chainId: provider.network.chainId,
        accounts: [],
      };

      for (const addr of this.addresses) {
        try {
          const balance = await provider.getBalance(addr);
          balances[networkKey].accounts.push({
            address: addr,
            balanceWei: balance.toString(),
            balanceEth: ethers.formatEther(balance),
          });
        } catch (err) {
          this._logger.error(`[WALLET] Balance check failed for ${addr} on ${networkKey}: ${err.message}`);
          balances[networkKey].accounts.push({
            address: addr,
            error: err.message,
          });
        }
      }
    }

    return balances;
  }

  /**
   * Submit a transaction on a given network (requires private keys).
   */
  async sendTransaction(networkKey, walletIndex, txRequest) {
    const networkWallets = this.wallets[networkKey];
    if (!networkWallets || !networkWallets[walletIndex]) {
      throw new Error(`No wallet available on ${networkKey} at index ${walletIndex}`);
    }

    const { wallet } = networkWallets[walletIndex];
    this._logger.info(`[WALLET] Sending tx on ${networkKey} from ${wallet.address.substring(0, 10)}...`);

    const tx = await wallet.sendTransaction(txRequest);
    this._logger.info(`[WALLET] TX submitted: ${tx.hash} on ${networkKey}`);

    return {
      hash: tx.hash,
      network: networkKey,
      from: wallet.address,
      nonce: tx.nonce,
      explorerUrl: `${this.providers[networkKey].network.explorer}/tx/${tx.hash}`,
    };
  }
}
