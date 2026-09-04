#!/usr/bin/env node
/**
 * binance-rail.mjs  (AUTONOMOUS · non-custodial · fail-closed)
 *
 * Direct Binance API integration for balance check + USDT withdrawal
 * to the Trust Wallet address via cheapest chain (BSC BEP20 preferred).
 *
 *   node scripts/binance-rail.mjs --action balance
 *   node scripts/binance-rail.mjs --action withdraw --amount 5 --network bsc
 *   node scripts/binance-rail.mjs --action networks
 *
 * Fail-closed: without --confirm, emits dry-run plan. Never sends with amount=0.
 * Never fabricates tx hashes.
 */
import 'dotenv/config';
import crypto from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const BASE = 'https://api.binance.com';
const TO_ADDRESS = process.env.TRUST_WALLET_ADDRESS;

if (!API_KEY || !API_SECRET) { console.error(JSON.stringify({ ok: false, error: 'BINANCE_API_KEY or BINANCE_API_SECRET not set' })); process.exit(2); }
if (!TO_ADDRESS) { console.error(JSON.stringify({ ok: false, error: 'TRUST_WALLET_ADDRESS not set' })); process.exit(2); }

// ── Binance signing ──────────────────────────────────────────────────────
function sign(queryString) {
  return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

async function binanceGet(path, params = {}) {
  const timestamp = Date.now();
  const qs = new URLSearchParams({ ...params, timestamp, recvWindow: 10000 }).toString();
  const signature = sign(qs);
  const r = await fetch(`${BASE}${path}?${qs}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': API_KEY },
  });
  return { status: r.status, data: await r.json() };
}

async function binancePost(path, params = {}) {
  const timestamp = Date.now();
  const body = new URLSearchParams({ ...params, timestamp, recvWindow: 10000 }).toString();
  const signature = sign(body);
  const r = await fetch(`${BASE}${path}?signature=${signature}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return { status: r.status, data: await r.json() };
}

// ── Network config (Binance coin names → chain details) ──────────────────
const NETWORKS = {
  bsc:    { binance: 'BSC',    chain: 'BNB Smart Chain', nativeSymbol: 'BNB',  explorer: 'https://bscscan.com', priority: 1 },
  eth:    { binance: 'ETH',    chain: 'Ethereum',        nativeSymbol: 'ETH',  explorer: 'https://etherscan.io', priority: 2 },
  arbitrum: { binance: 'ARBITRUM', chain: 'Arbitrum One', nativeSymbol: 'ETH', explorer: 'https://arbiscan.io', priority: 3 },
  optimism: { binance: 'OPTIMISM', chain: 'Optimism',    nativeSymbol: 'ETH',  explorer: 'https://optimistic.etherscan.io', priority: 4 },
  polygon:  { binance: 'MATIC', chain: 'Polygon PoS',    nativeSymbol: 'MATIC', explorer: 'https://polygonscan.com', priority: 5 },
  base:   { binance: 'BASE',   chain: 'Base',            nativeSymbol: 'ETH',  explorer: 'https://basescan.org', priority: 6 },
};

// ── Actions ──────────────────────────────────────────────────────────────
async function checkBalance() {
  console.log('Checking Binance balance...');
  const { status, data } = await binanceGet('/api/v3/account');

  if (status !== 200 || data.code) {
    console.log(JSON.stringify({
      ok: false,
      status,
      error: data.code || data.msg || 'unknown',
      message: data.msg || 'API key may be invalid. Regenerate in Binance > API Management.',
      hint: 'Set BINANCE_API_KEY + BINANCE_API_SECRET in .env. Key needs: no IP whitelist, Enable Withdrawals, Enable Spot & Margin Trading.',
    }));
    return;
  }

  const assets = (data.balances || []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  const usdt = data.balances?.find(b => b.asset === 'USDT');
  const bnb = data.balances?.find(b => b.asset === 'BNB');

  console.log(JSON.stringify({
    ok: true,
    totalAssets: assets.length,
    USDT: usdt ? { free: usdt.free, locked: usdt.locked } : null,
    BNB: bnb ? { free: bnb.free, locked: bnb.locked } : null,
    topAssets: assets.slice(0, 10).map(a => `${a.asset}: ${a.free}`),
  }, null, 2));
}

async function checkNetworks() {
  console.log('Checking Binance withdrawal networks for USDT...');
  const { status, data } = await binanceGet('/sapi/v1/capital/config/getall');

  if (status !== 200 || data.code) {
    console.log(JSON.stringify({ ok: false, error: data.code || data.msg }));
    return;
  }

  // Find USDT networks
  const usdt = (data || []).find(c => c.coin === 'USDT');
  if (!usdt) { console.log(JSON.stringify({ ok: false, error: 'USDT not found' })); return; }

  const networks = (usdt.networkList || []).map(n => ({
    network: n.network,
    name: n.name,
    coin: n.coin,
    withdrawEnable: n.withdrawEnable,
    withdrawMin: n.withdrawMin,
    withdrawMax: n.withdrawMax,
    withdrawFee: n.withdrawFee,
    minWithdrawAmount: n.minWithdrawAmount,
    depositEnable: n.depositEnable,
  }));

  const withdrawable = networks.filter(n => n.withdrawEnable);

  console.log(JSON.stringify({
    ok: true,
    coin: 'USDT',
    totalNetworks: networks.length,
    withdrawable: withdrawable.length,
    networks: withdrawable.map(n => `${n.network}: fee=${n.withdrawFee} min=${n.withdrawMin} max=${n.withdrawMax}`),
    cheapest: withdrawable.sort((a, b) => parseFloat(a.withdrawFee) - parseFloat(b.withdrawFee)).slice(0, 3),
  }, null, 2));
}

async function withdraw() {
  const amount = Number(arg('amount', '0'));
  const networkKey = arg('network', 'bsc');
  const confirm = process.argv.includes('--confirm');

  if (!(amount > 0)) { console.error('--amount required (>0)'); process.exit(1); }

  const network = NETWORKS[networkKey];
  if (!network) { console.error('Valid networks: ' + Object.keys(NETWORKS).join(', ')); process.exit(1); }

  // First check available networks
  const { status: netStatus, data: netData } = await binanceGet('/sapi/v1/capital/config/getall');
  if (netStatus !== 200) { console.error('Failed to fetch networks'); process.exit(1); }

  const usdt = (netData || []).find(c => c.coin === 'USDT');
  const net = (usdt?.networkList || []).find(n => n.network === network.binance && n.withdrawEnable);

  if (!net) {
    console.log(JSON.stringify({
      ok: false,
      error: `Network ${network.binance} not available for USDT withdrawal`,
      available: (usdt?.networkList || []).filter(n => n.withdrawEnable).map(n => n.network),
    }));
    return;
  }

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Binance',
    asset: 'USDT',
    amount,
    network: network.binance,
    chain: network.chain,
    to: TO_ADDRESS,
    fee: net.withdrawFee,
    minWithdraw: net.withdrawMin,
    maxWithdraw: net.withdrawMax,
    dryRun: !confirm,
    status: 'DRY_RUN',
  };

  if (amount < parseFloat(net.withdrawMin)) {
    plan.status = 'BELOW_MINIMUM';
    plan.error = `Amount ${amount} USDT < minimum ${net.withdrawMin} USDT`;
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (!confirm) {
    plan.note = 'Add --confirm to execute withdrawal.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // Execute withdrawal
  console.log('Executing Binance withdrawal...');
  const { status, data } = await binancePost('/sapi/v1/capital/withdraw/apply', {
    coin: 'USDT',
    network: network.binance,
    address: TO_ADDRESS,
    amount: String(amount),
  });

  if (status === 200 && data.id) {
    plan.status = 'WITHDRAWAL_SUBMITTED';
    plan.withdrawId = data.id;
    plan.fundsMoved = true;
    plan.explorer = network.explorer + '/address/' + TO_ADDRESS;
  } else {
    plan.status = 'FAILED';
    plan.error = data.msg || JSON.stringify(data).slice(0, 300);
    plan.fundsMoved = false;
  }

  const outFile = resolve(OUT, `binance-withdrawal-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────
const action = arg('action', 'balance');
if (action === 'balance') await checkBalance();
else if (action === 'networks') await checkNetworks();
else if (action === 'withdraw') await withdraw();
else { console.error('actions: balance, networks, withdraw'); process.exit(1); }
