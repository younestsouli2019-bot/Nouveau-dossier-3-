/**
 * Cron Daemon — scheduled L2 transaction scanning.
 * Runs on a configurable cron schedule (default: every hour).
 */

import cron from 'node-cron';
import { getConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';

export class Daemon {
  constructor(transactionMonitor, notificationService) {
    this.transactionMonitor = transactionMonitor;
    this.notificationService = notificationService;
    this._task = null;
    this._logger = getLogger();
  }

  /**
   * Start the cron daemon.
   */
  start() {
    const config = getConfig();
    const cronExpr = config.daemonCron;

    if (!cron.validate(cronExpr)) {
      throw new Error(`Invalid cron expression: ${cronExpr}`);
    }

    this._logger.info(`[DAEMON] Starting with schedule: ${cronExpr}`);

    this._task = cron.schedule(cronExpr, async () => {
      this._logger.info('[DAEMON] Cron triggered — running scheduled scan');
      try {
        const results = await this.transactionMonitor.scanAll();

        // Build and send notification summary
        const summary = {};
        for (const [key, result] of Object.entries(results)) {
          summary[key] = {
            network: result.transactions?.[0]?.networkName || key,
            transactionsFound: result.transactions?.length || 0,
            inbound: result.transactions?.filter(t => t.direction === 'inbound').length || 0,
            outbound: result.transactions?.filter(t => t.direction === 'outbound').length || 0,
            totalValueEth: result.transactions
              ?.filter(t => t.direction === 'inbound')
              .reduce((s, t) => s + parseFloat(t.valueEth || 0), 0) || 0,
            blocksScanned: result.blocksScanned || 0,
            error: result.error,
          };
        }

        await this.notificationService.notifyScanSummary(summary);
        this._logger.info('[DAEMON] Scheduled scan complete');
      } catch (err) {
        this._logger.error(`[DAEMON] Scheduled scan failed: ${err.message}`);
      }
    });

    this._logger.info('[DAEMON] Running — awaiting next scheduled trigger');
  }

  /**
   * Stop the daemon.
   */
  stop() {
    if (this._task) {
      this._task.stop();
      this._task = null;
      this._logger.info('[DAEMON] Stopped');
    }
  }

  /**
   * Check if daemon is running.
   */
  isRunning() {
    return this._task !== null;
  }
}
