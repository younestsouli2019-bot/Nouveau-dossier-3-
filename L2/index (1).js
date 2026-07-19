#!/usr/bin/env node
/**
 * L2 Ecosystems Monitor — Main Entry Point
 * Initializes all providers, wallet manager, monitor, daemon, and server.
 */

import { getConfig } from './config.js';
import { getLogger } from './utils/logger.js';
import { createAllProviders } from './providers/index.js';
import { WalletManager } from './services/wallet-manager.js';
import { TransactionMonitor } from './services/transaction-monitor.js';
import { NotificationService } from './services/notification-service.js';
import { Daemon } from './daemon.js';
import { startServer } from './server.js';

async function main() {
  const config = getConfig();
  const logger = getLogger(config.logLevel);

  logger.info('═══════════════════════════════════════════════════');
  logger.info('  L2 ECOSYSTEMS MONITOR — Starting Up');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`  Environment:  ${config.nodeEnv}`);
  logger.info(`  Owner Addresses: ${config.ownerAddresses.length}`);
  logger.info(`  Enabled Networks: ${config.enabledNetworkKeys.join(', ') || '(none)'}`);
  logger.info(`  TX Mode: ${config.hasPrivateKeys ? 'ENABLED' : 'MONITOR-ONLY'}`);
  logger.info(`  Daemon Cron: ${config.daemonCron}`);
  logger.info(`  ERC-20 Tracking: ${config.trackErc20}`);
  logger.info('═══════════════════════════════════════════════════');

  // ── Step 1: Initialize Providers ──
  logger.info('[INIT] Connecting to L2 networks...');
  const providers = createAllProviders(config);

  const connectPromises = Object.entries(providers).map(async ([key, provider]) => {
    try {
      const connected = await provider.connect();
      if (connected) {
        logger.info(`[INIT] ✅ ${provider.network.name} connected (chain ${provider.network.chainId})`);
      } else {
        logger.warn(`[INIT] ❌ ${provider.network.name} — all RPC endpoints failed`);
      }
    } catch (err) {
      logger.error(`[INIT] ❌ ${key} connection error: ${err.message}`);
    }
  });

  await Promise.all(connectPromises);

  const connectedCount = Object.values(providers).filter(p => p.connected).length;
  if (connectedCount === 0) {
    logger.error('[INIT] No networks connected — check your .env RPC endpoints');
    logger.error('[INIT] At minimum, configure one of: RPC_ARBITRUM, RPC_OPTIMISM, RPC_BASE, etc.');
    process.exit(1);
  }

  // ── Step 2: Initialize Wallet Manager ──
  logger.info('[INIT] Initializing wallet manager...');
  const walletManager = new WalletManager(providers);
  await walletManager.init();

  // ── Step 3: Initialize Transaction Monitor ──
  logger.info('[INIT] Initializing transaction monitor...');
  const notificationService = new NotificationService();
  const transactionMonitor = new TransactionMonitor(providers, walletManager);

  // ── Step 4: Start Cron Daemon ──
  logger.info('[INIT] Starting cron daemon...');
  const daemon = new Daemon(transactionMonitor, notificationService);
  daemon.start();

  // ── Step 5: Run Initial Scan ──
  logger.info('[INIT] Running initial scan...');
  try {
    const initialResults = await transactionMonitor.scanAll();
    const totalTxs = Object.values(initialResults)
      .reduce((sum, r) => sum + (r.transactions?.length || 0), 0);
    logger.info(`[INIT] Initial scan found ${totalTxs} transactions across ${connectedCount} networks`);
  } catch (err) {
    logger.error(`[INIT] Initial scan failed: ${err.message}`);
  }

  // ── Step 6: Start HTTP Server ──
  logger.info('[INIT] Starting API server...');
  await startServer(providers, walletManager, transactionMonitor, notificationService);

  logger.info('[INIT] ✅ L2 Ecosystems Monitor is fully operational');

  // ── Graceful Shutdown ──
  const shutdown = async (signal) => {
    logger.info(`[SHUTDOWN] Received ${signal} — shutting down gracefully`);

    daemon.stop();

    for (const provider of Object.values(providers)) {
      provider.disconnect();
    }

    logger.info('[SHUTDOWN] All connections closed');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
