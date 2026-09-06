#!/usr/bin/env node
/**
 * bitget-rail.mjs  (AUTONOMOUS · non-custodial · fail-closed)
 *
 * Direct Bitget API integration (CCXT) for balance check + USDT withdrawal
 * to the owner Trust Wallet address via BEP20 (same destination class as
 * binance-rail.mjs).
 *
 *   node scripts/bitget-rail.mjs --action balance
 *   node scripts/bitget-rail.mjs --action networks
 *   node scripts/bitget-rail.mjs --action withdraw --amount 3.3 --network bsc
 *   node scripts/bitget-rail.mjs --action withdraw --amount 3.3 --network bsc --confirm
 *
 * Fail-closed: without --confirm, emits a dry-run plan. Never sends with
 * amount=0, never fabricates tx hashes, never moves funds without the I8
 * capability grant (CAP_WITHDRAW_CRYPTO=true).
 */
import 'dotenv/config';
import ccxt from 'ccxt';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { assertCapability } from '../src/finance/capabilities.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };

const API_KEY = process.env.BITGET_API_KEY;
const API_SECRET = process.env.BITGET_API_SECRET;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;
const TO_ADDRESS = process.env.TRUST_WALLET_ADDRESS;

if (!API_KEY || !API_SECRET || !PASSPHRASE) {
  console.error(JSON.stringify({ ok: false, error: 'BITGET_API_KEY or BITGET_API_SECRET or BITGET_PASSPHRASE not set' }));
  process.exit(2);
}
if (!TO_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(TO_ADDRESS)) {
  console.error(JSON.stringify({ ok: false, error: 'TRUST_WALLET_ADDRESS missing or not a valid EVM 0x address' }));
  process.exit(2);
}

const NETWORKS = {
  bsc: { bitget: 'BEP20', chain: 'BNB Smart Chain', explorer: 'https://bscscan.com' },
  trc20: { bitget: 'TRC20', chain: 'TRON', explorer: 'https://tronscan.org' },
  erc20: { bitget: 'ERC20', chain: 'Ethereum', explorer: 'https://etherscan.io' },
};

function makeClient() {
  return new ccxt.bitget({
    apiKey: API_KEY,
    secret: API_SECRET,
    password: PASSPHRASE,
    enableRateLimit: true,
  });
}

function pickNetworkInfo(networks, key) {
  const n = networks[key] || networks[key.toLowerCase()] || networks[key.replace('20', '-20')];
  if (!n) return null;
  const num = (v) => (v === undefined || v === null ? undefined : Number(v));
  return {
    id: n.id,
    network: n.network || key,
    active: n.active !== false && n.withdrawEnabled !== false,
    fee: num(n.fee) ?? num(n.info?.withdrawalFee) ?? num(n.info?.fee) ?? null,
    min: num(n.limits?.withdraw?.min) ?? num(n.info?.minWithdrawAmount) ?? num(n.info?.min) ?? null,
    max: num(n.limits?.withdraw?.max) ?? num(n.info?.maxWithdrawAmount) ?? num(n.info?.max) ?? null,
  };
}

async function checkBalance() {
  console.log('Checking Bitget balance...');
  try {
    const bitget = makeClient();
    await bitget.loadTimeDifference();
    const b = await bitget.fetchBalance();
    const usdt = b?.free?.['USDT'] ?? 0;
    const total = b?.total?.['USDT'] ?? 0;
    console.log(JSON.stringify({ ok: true, exchange: 'Bitget', USDT: { free: Number(usdt), total: Number(total) }, jsonKeys: Object.keys(b?.free || {}).filter((k) => b.free[k] > 0).slice(0, 20) }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, exchange: 'Bitget', error: e?.message ?? String(e), hint: 'API key may lack read permission, or the account IP whitelist blocks this machine.' }, null, 2));
  }
}

async function checkNetworks() {
  console.log('Checking Bitget USDT withdrawal networks...');
  try {
    const bitget = makeClient();
    await bitget.loadTimeDifference();
    const currencies = await bitget.fetchCurrencies();
    const usdt = currencies?.['USDT'];
    if (!usdt?.networks) {
      console.log(JSON.stringify({ ok: false, error: 'USDT network data unavailable from this API key' }));
      return;
    }
    const networks = [];
    for (const key of Object.keys(usdt.networks)) {
      const info = pickNetworkInfo(usdt.networks, key);
      if (info) networks.push(info);
    }
    console.log(JSON.stringify({ ok: true, coin: 'USDT', networks: networks.map((n) => ({ network: n.network, fee: n.fee, min: n.min, max: n.max, active: n.active })) }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
  }
}

async function withdraw() {
  const amount = Number(arg('amount', '0'));
  const networkKey = arg('network', 'bsc');
  const confirm = process.argv.includes('--confirm');

  if (!(amount > 0)) { console.error('--amount required (>0)'); process.exit(1); }

  const network = NETWORKS[networkKey];
  if (!network) { console.error('Valid networks: ' + Object.keys(NETWORKS).join(', ')); process.exit(1); }

  const bitget = makeClient();
  await bitget.loadTimeDifference();

  const currencies = await bitget.fetchCurrencies();
  const usdt = currencies?.['USDT'];
  const liveNetwork = usdt?.networks ? pickNetworkInfo(usdt.networks, network.bitget) : null;

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Bitget',
    asset: 'USDT',
    amount,
    network: network.bitget,
    chain: network.chain,
    to: TO_ADDRESS,
    fee: liveNetwork?.fee ?? null,
    minWithdraw: liveNetwork?.min ?? null,
    maxWithdraw: liveNetwork?.max ?? null,
    dryRun: !confirm,
    status: 'DRY_RUN',
  };

  if (!liveNetwork || liveNetwork.active === false) {
    plan.status = 'NETWORK_UNAVAILABLE';
    plan.error = `Network ${network.bitget} not available for USDT withdrawal`;
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (liveNetwork.min !== null && amount < liveNetwork.min) {
    plan.status = 'BELOW_MINIMUM';
    plan.error = `Amount ${amount} USDT < minimum ${liveNetwork.min} USDT`;
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (!confirm) {
    plan.note = 'Add --confirm to execute withdrawal.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // I8: explicit capability grant required for actual money movement.
  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.fundsMoved = false;
    plan.note = 'Set the CAP_WITHDRAW_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // Live balance re-check immediately before submission.
  const b = await bitget.fetchBalance();
  const available = Number(b?.free?.['USDT'] ?? 0);
  if (!(available >= amount)) {
    plan.status = 'INSUFFICIENT_BALANCE';
    plan.error = `Available USDT ${available} < requested ${amount}`;
    plan.fundsMoved = false;
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log('Executing Bitget withdrawal...');
  try {
    const result = await bitget.withdraw('USDT', amount, TO_ADDRESS, undefined, {
      network: network.bitget,
      clientOid: `btr-${Date.now()}`,
    });
    const withdrawId = result?.id ?? result?.withdrawId ?? result?.withdrawal?.id ?? null;
    if (withdrawId) {
      plan.status = 'WITHDRAWAL_SUBMITTED';
      plan.withdrawId = String(withdrawId);
      plan.fundsMoved = true;
      plan.explorer = network.explorer + '/address/' + TO_ADDRESS;
    } else {
      plan.status = 'UNRECOGNIZED_RESPONSE';
      plan.error = JSON.stringify(result).slice(0, 300);
      plan.fundsMoved = false;
    }
  } catch (e) {
    plan.status = 'FAILED';
    plan.error = (e?.message ?? String(e)).slice(0, 300);
    plan.fundsMoved = false;
  }

  const outFile = resolve(OUT, `bitget-withdrawal-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
}

const action = arg('action', 'balance');
if (action === 'balance') await checkBalance();
else if (action === 'networks') await checkNetworks();
else if (action === 'withdraw') await withdraw();
else { console.error('actions: balance, networks, withdraw'); process.exit(1); }