import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');

const DECIMALS = 1e6;

export const CHAINS = {
  ethereum: {
    label: 'Ethereum L1',
    rpc: 'https://ethereum-rpc.publicnode.com',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  bsc: {
    label: 'BNB Chain (BEP20)',
    rpc: 'https://bsc-rpc.publicnode.com',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  },
  arbitrum: {
    label: 'Arbitrum One',
    rpc: 'https://arbitrum-one-rpc.publicnode.com',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  optimism: {
    label: 'Optimism',
    rpc: 'https://optimism-rpc.publicnode.com',
    usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  base: {
    label: 'Base',
    rpc: 'https://base-rpc.publicnode.com',
    usdt: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  polygon: {
    label: 'Polygon PoS',
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
};

function balanceOfData(address) {
  return '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
}

async function readJSON(filepath) {
  try { return JSON.parse(await fs.readFile(filepath, 'utf-8')); } catch { return null; }
}

async function resolveOwnerAddress() {
  const fromEnv = process.env.TRUST_WALLET_ADDRESS
    || process.env.OWNER_CRYPTO_ERC20
    || process.env.OWNER_CRYPTO_BEP20;
  if (fromEnv) return fromEnv;
  const truth = await readJSON(TRUTH_PATH);
  return truth?.paymentDestinations?.crypto?.erc20
    || truth?.paymentDestinations?.crypto?.bep20
    || null;
}

async function queryBalance(rpc, contract, address, timeoutMs = 10000) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to: contract, data: balanceOfData(address) }, 'latest'],
  });
  const resp = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'rpc_error');
  if (!data.result || data.result === '0x' || data.result === '0x0') return 0;
  return Number(BigInt(data.result)) / DECIMALS;
}

export class ChainWalletMonitor {
  constructor({ address, chains = CHAINS, timeoutMs = 10000 } = {}) {
    this.address = address || null;
    this.chains = chains;
    this.timeoutMs = timeoutMs;
    this.lastRun = null;
  }

  async checkAll() {
    const address = this.address || (await resolveOwnerAddress());
    if (!address) {
      return {
        ok: false,
        reason: 'no owner crypto address configured (owner-truth.json crypto or TRUST_WALLET_ADDRESS)',
        address: null,
        chains: [],
        totalUSDT: 0,
        totalUSDC: 0,
      };
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return { ok: false, reason: `invalid address: ${address}`, address, chains: [], totalUSDT: 0, totalUSDC: 0 };
    }

    const checks = Object.entries(this.chains).map(async ([key, cfg]) => {
      const entry = { chain: key, label: cfg.label, rpc: cfg.rpc, usdt: null, usdc: null, error: null };
      const [usdtRes, usdcRes] = await Promise.allSettled([
        queryBalance(cfg.rpc, cfg.usdt, address, this.timeoutMs),
        queryBalance(cfg.rpc, cfg.usdc, address, this.timeoutMs),
      ]);
      if (usdtRes.status === 'fulfilled') entry.usdt = round(usdtRes.value);
      else entry.usdtError = usdtRes.reason?.message || 'error';
      if (usdcRes.status === 'fulfilled') entry.usdc = round(usdcRes.value);
      else entry.usdcError = usdcRes.reason?.message || 'error';
      if (entry.usdt === null && entry.usdc === null) entry.error = entry.usdtError || entry.usdcError;
      return entry;
    });

    const results = await Promise.all(checks);
    this.lastRun = new Date().toISOString();

    return {
      ok: true,
      address,
      checkedAt: this.lastRun,
      chains: results,
      totalUSDT: round(results.reduce((s, c) => s + (c.usdt || 0), 0)),
      totalUSDC: round(results.reduce((s, c) => s + (c.usdc || 0), 0)),
    };
  }
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

export async function checkAllChains(options) {
  const monitor = new ChainWalletMonitor(options);
  return monitor.checkAll();
}

export const chainWalletMonitor = new ChainWalletMonitor();
