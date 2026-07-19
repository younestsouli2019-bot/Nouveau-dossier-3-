/**
 * Express REST API server for L2 Ecosystems Monitor.
 * Provides endpoints for scan status, transactions, balances, and manual triggers.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { getConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';
import { apiKeyAuth } from '../middleware/auth.js';
import {
  loadTransactions,
  loadDailySummary,
  listTransactionFiles,
  listSummaryFiles,
  getLastScannedBlock,
} from '../utils/store.js';

export function createServer(providers, walletManager, transactionMonitor, notificationService) {
  const app = express();
  const config = getConfig();
  const logger = getLogger();

  // ── Middleware ──
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Apply API key auth to all /api routes
  app.use('/api', apiKeyAuth);

  // ── Health Check ──
  app.get('/health', (req, res) => {
    const connectedNetworks = Object.entries(providers)
      .filter(([, p]) => p.connected)
      .map(([key]) => key);

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      networks: connectedNetworks.length,
      scanRunning: transactionMonitor.isRunning(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Network Status ──
  app.get('/api/networks', (req, res) => {
    const networks = {};
    for (const [key, provider] of Object.entries(providers)) {
      networks[key] = {
        name: provider.network.name,
        chainId: provider.network.chainId,
        connected: provider.connected,
        rpcUrl: provider.network.rpcUrl ? '(configured)' : '(not set)',
        explorer: provider.network.explorer,
      };
    }
    res.json({ networks });
  });

  // ── Balances ──
  app.get('/api/balances', async (req, res) => {
    try {
      const balances = await walletManager.getBalances();
      res.json({ balances });
    } catch (err) {
      logger.error(`[API] Balance fetch error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Scan Status ──
  app.get('/api/scan/status', async (req, res) => {
    try {
      const scanState = {};
      for (const key of config.enabledNetworkKeys) {
        const lastBlock = await getLastScannedBlock(key);
        scanState[key] = {
          lastScannedBlock: lastBlock,
          networkName: providers[key]?.network.name || key,
        };
      }
      res.json({
        running: transactionMonitor.isRunning(),
        lastResults: transactionMonitor.getLastResults(),
        scanState,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Trigger Manual Scan ──
  app.post('/api/scan/trigger', async (req, res) => {
    try {
      if (transactionMonitor.isRunning()) {
        return res.status(409).json({ error: 'Scan already in progress' });
      }

      const { networkKey, blockRange } = req.body || {};

      if (networkKey) {
        const result = await transactionMonitor.scanNetwork(networkKey, blockRange);
        res.json({ message: `Scan complete for ${networkKey}`, result });
      } else {
        // Full scan — run async
        transactionMonitor.scanAll().then(results => {
          notificationService.notifyScanSummary(
            Object.fromEntries(
              Object.entries(results).map(([k, v]) => [k, {
                network: providers[k]?.network.name || k,
                transactionsFound: v.transactions?.length || 0,
                inbound: v.transactions?.filter(t => t.direction === 'inbound').length || 0,
                outbound: v.transactions?.filter(t => t.direction === 'outbound').length || 0,
                totalValueEth: v.transactions
                  ?.filter(t => t.direction === 'inbound')
                  .reduce((s, t) => s + parseFloat(t.valueEth || 0), 0) || 0,
                blocksScanned: v.blocksScanned || 0,
                error: v.error,
              }])
            )
          );
        });

        res.json({ message: 'Full scan triggered', status: 'running' });
      }
    } catch (err) {
      logger.error(`[API] Scan trigger error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Get Transactions ──
  app.get('/api/transactions/:networkKey/:date', async (req, res) => {
    try {
      const { networkKey, date } = req.params;
      const data = await loadTransactions(networkKey, date);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── List Transaction Files ──
  app.get('/api/transactions', async (req, res) => {
    try {
      const files = await listTransactionFiles();
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Daily Summary ──
  app.get('/api/summary/:date', async (req, res) => {
    try {
      const summary = await loadDailySummary(req.params.date);
      if (!summary) {
        return res.status(404).json({ error: 'No summary found for that date' });
      }
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── List Summaries ──
  app.get('/api/summaries', async (req, res) => {
    try {
      const files = await listSummaryFiles();
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Watch Addresses ──
  app.get('/api/addresses', (req, res) => {
    res.json({
      addresses: walletManager.getWatchAddresses(),
      count: walletManager.getWatchAddresses().length,
      txMode: walletManager.addresses.length > 0 && Object.keys(walletManager.wallets).length > 0,
    });
  });

  // ── Error handler ──
  app.use((err, req, res, _next) => {
    logger.error(`[API] Unhandled error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
