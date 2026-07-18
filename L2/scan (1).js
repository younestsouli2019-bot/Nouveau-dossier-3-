#!/usr/bin/env node
/**
 * CLI: One-shot scan — run a single scan and output results.
 * Usage: node src/cli/scan.js [--network arbitrum] [--from BLOCK] [--to BLOCK]
 */

import { getConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';
import { createAllProviders } from '../providers/index.js';
import { WalletManager } from '../services/wallet-manager.js';
import { TransactionMonitor } from '../services/transaction-monitor.js';

const args = process.argv.slice(2);
const networkArg = args.find(a => a.startsWith('--network'))?.split('=')[1] || args[args.indexOf('--network') + 1];
const fromArg = args.find(a => a.startsWith('--from'))?.split('=')[1] || args[args.indexOf('--from') + 1];
const toArg = args.find(a => a.startsWith('--to'))?.split('=')[1] || args[args.indexOf('--to') + 1];

async function run() {
  const config = getConfig();
  const logger = getLogger('info');

  logger.info('[CLI] One-shot scan starting...');

  const providers = createAllProviders(config);
  await Promise.all(Object.values(providers).map(p => p.connect().catch(() => {})));

  const walletManager = new WalletManager(providers);
  await walletManager.init();

  const monitor = new TransactionMonitor(providers, walletManager);

  let results;

  if (networkArg) {
    const blockRange = (fromArg && toArg) ? { from: parseInt(fromArg), to: parseInt(toArg) } : null;
    results = await monitor.scanNetwork(networkArg, blockRange);
    console.log(JSON.stringify(results, null, 2));
  } else {
    results = await monitor.scanAll();
    const totalTxs = Object.values(results).reduce((sum, r) => sum + (r.transactions?.length || 0), 0);
    console.log(JSON.stringify({ totalTransactions: totalTxs, results }, null, 2));
  }

  for (const p of Object.values(providers)) {
    p.disconnect();
  }
}

run().catch(err => {
  console.error('Scan failed:', err);
  process.exit(1);
});
