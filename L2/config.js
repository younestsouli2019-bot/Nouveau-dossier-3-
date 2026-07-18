/**
 * Configuration loader for L2 Ecosystems Monitor
 * Reads from .env, validates, and exports typed config objects.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env (try .env.local first, then .env)
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ── L2 Network Definitions ──
const L2_NETWORKS = {
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    symbol: 'ETH',
    blockTime: 0.25,
    rpcEnvKey: 'RPC_ARBITRUM',
    fallbackRpcEnvKey: 'FALLBACK_RPC_ARBITRUM',
    explorer: 'https://arbiscan.io',
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    symbol: 'ETH',
    blockTime: 2,
    rpcEnvKey: 'RPC_OPTIMISM',
    fallbackRpcEnvKey: 'FALLBACK_RPC_OPTIMISM',
    explorer: 'https://optimistic.etherscan.io',
  },
  base: {
    name: 'Base',
    chainId: 8453,
    symbol: 'ETH',
    blockTime: 2,
    rpcEnvKey: 'RPC_BASE',
    fallbackRpcEnvKey: 'FALLBACK_RPC_BASE',
    explorer: 'https://basescan.org',
  },
  'polygon-zkevm': {
    name: 'Polygon zkEVM',
    chainId: 1101,
    symbol: 'ETH',
    blockTime: 3,
    rpcEnvKey: 'RPC_POLYGON_ZKEVM',
    fallbackRpcEnvKey: 'FALLBACK_RPC_POLYGON_ZKEVM',
    explorer: 'https://zkevm.polygonscan.com',
  },
  linea: {
    name: 'Linea',
    chainId: 59144,
    symbol: 'ETH',
    blockTime: 4,
    rpcEnvKey: 'RPC_LINEA',
    fallbackRpcEnvKey: 'FALLBACK_RPC_LINEA',
    explorer: 'https://lineascan.build',
  },
  scroll: {
    name: 'Scroll',
    chainId: 534352,
    symbol: 'ETH',
    blockTime: 3,
    rpcEnvKey: 'RPC_SCROLL',
    fallbackRpcEnvKey: 'FALLBACK_RPC_SCROLL',
    explorer: 'https://scrollscan.com',
  },
};

/**
 * Parse a comma-separated env var into an array of trimmed strings.
 */
function parseList(val) {
  if (!val) return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Parse a comma-separated env var into an array of trimmed, lowercased strings.
 */
function parseAddressList(val) {
  return parseList(val).map(a => a.toLowerCase());
}

/**
 * Load and validate configuration.
 */
export function loadConfig() {
  const ownerAddresses = parseAddressList(process.env.OWNER_ADDRESSES);
  const ownerPrivateKeys = parseList(process.env.OWNER_PRIVATE_KEYS);

  if (ownerAddresses.length === 0) {
    console.warn('[CONFIG] No OWNER_ADDRESSES configured — running in demo mode');
  }

  // Build provider configs for each enabled network
  const enabledNetworks = {};
  for (const [key, net] of Object.entries(L2_NETWORKS)) {
    const rpcUrl = process.env[net.rpcEnvKey];
    const fallbackRpcs = parseList(process.env[net.fallbackRpcEnvKey]);

    if (rpcUrl) {
      enabledNetworks[key] = {
        ...net,
        key,
        rpcUrl,
        fallbackRpcs,
        enabled: true,
      };
    } else {
      enabledNetworks[key] = {
        ...net,
        key,
        rpcUrl: null,
        fallbackRpcs,
        enabled: false,
      };
    }
  }

  const enabledCount = Object.values(enabledNetworks).filter(n => n.enabled).length;
  if (enabledCount === 0) {
    console.warn('[CONFIG] No L2 RPC endpoints configured — no networks to monitor');
  }

  return {
    // General
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',

    // Owner accounts
    ownerAddresses,
    ownerPrivateKeys,
    hasPrivateKeys: ownerPrivateKeys.length > 0 && ownerPrivateKeys[0] !== '',

    // Networks
    networks: enabledNetworks,
    enabledNetworkKeys: Object.entries(enabledNetworks)
      .filter(([, n]) => n.enabled)
      .map(([k]) => k),

    // Daemon
    daemonCron: process.env.DAEMON_CRON || '0 * * * *',
    blocksPerScan: parseInt(process.env.BLOCKS_PER_SCAN || '1000', 10),
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '5', 10),
    rpcTimeout: parseInt(process.env.RPC_TIMEOUT || '30000', 10),

    // Transaction filters
    minTxValueEth: parseFloat(process.env.MIN_TX_VALUE_ETH || '0.001'),
    trackErc20: process.env.TRACK_ERC20 !== 'false',
    watchTokens: parseAddressList(process.env.WATCH_TOKENS),

    // Notifications
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',

    // Database
    databaseUrl: process.env.DATABASE_URL || '',

    // API Security
    apiKey: process.env.API_KEY || '',
    jwtSecret: process.env.JWT_SECRET || '',
  };
}

// Singleton config instance
let _config = null;

export function getConfig() {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function resetConfig() {
  _config = null;
}

export { L2_NETWORKS };
