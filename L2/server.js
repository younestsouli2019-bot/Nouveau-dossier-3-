/**
 * Express HTTP Server — serves the REST API.
 */

import { createServer } from './routes/api.js';
import { getConfig } from './config.js';
import { getLogger } from './utils/logger.js';

export async function startServer(providers, walletManager, transactionMonitor, notificationService) {
  const config = getConfig();
  const logger = getLogger();

  const app = createServer(providers, walletManager, transactionMonitor, notificationService);

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, () => {
      logger.info(`[SERVER] L2 Ecosystems Monitor API running on port ${config.port}`);
      logger.info(`[SERVER] Health check: http://localhost:${config.port}/health`);
      logger.info(`[SERVER] API base: http://localhost:${config.port}/api/`);
      resolve(server);
    });

    server.on('error', (err) => {
      logger.error(`[SERVER] Failed to start: ${err.message}`);
      reject(err);
    });
  });
}
