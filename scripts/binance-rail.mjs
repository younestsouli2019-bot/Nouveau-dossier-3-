#!/usr/bin/env node
/**
 * binance-rail.mjs  (AUTONOMOUS · non-custodial · fail-closed)
 *
 * Direct Binance API integration for balance check, a read-only holdings
 * audit, and withdrawal to one of the owner's pre-set, verified payout routes
 * declared in config/crypto-addresses.json (resolved by scripts/lib/owner-routes.mjs).
 *
 *   node scripts/binance-rail.mjs --action balance
 *   node scripts/binance-rail.mjs --action holdings
 *   node scripts/binance-rail.mjs --action networks
 *   node scripts/binance-rail.mjs --action routes
 *   node scripts/binance-rail.mjs --action transfer --asset VND --from funding --to spot --all
 *   node scripts/binance-rail.mjs --action convert --from VND --to USDT --all
 *   node scripts/binance-rail.mjs --action withdraw --amount 5 --network bsc --confirm
 *   node scripts/binance-rail.mjs --action withdraw --amount 5 --route binance-usdt-bep20 --confirm
 *
 * The destination is NEVER taken from a constant: it is resolved from the owner
 * route registry. An unknown, ambiguous, unverified, address-less or
 * exchange-deposit route is refused — there is no default wallet and no
 * fallback chain. --address, when supplied, is only cross-checked.
 *
 * Fail-closed: without --confirm, emits a dry-run plan. Never sends with
 * amount=0, never fabricates tx hashes, never moves funds without the I8
 * capability grant (CAP_WITHDRAW_CRYPTO=true).
 */
import 'dotenv/config';
import crypto from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { assertCapability } from '../src/finance/capabilities.mjs';
import { loadRoutes, resolveRoute, listRoutes, fold } from './lib/owner-routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const BASE = 'https://api.binance.com';
const FAPI = 'https://fapi.binance.com';
// A destination supplied out-of-band (workflow dispatch input) is only ever
// cross-checked against the registry — it never replaces it.
const ADDRESS_OVERRIDE = process.env.OWNER_CRYPTO_ADDRESS || process.env.TRUST_WALLET_ADDRESS || null;

function fail(code, error, exitCode = 2) {
  console.log(JSON.stringify({ ok: false, code, error, fundsMoved: false }, null, 2));
  process.exit(exitCode);
}

function requireCreds() {
  if (!API_KEY || !API_SECRET) fail('CREDENTIALS_MISSING', 'BINANCE_API_KEY or BINANCE_API_SECRET not set');
}

// ── Binance signing ──────────────────────────────────────────────────────
function sign(queryString) {
  return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

async function serverTimeMs() {
  try {
    const r = await fetch(`${BASE}/api/v3/time`);
    const j = await r.json();
    if (j.serverTime) return j.serverTime;
  } catch {}
  return Date.now();
}

async function binanceGet(path, params = {}, base = BASE) {
  const timestamp = await serverTimeMs();
  const qs = new URLSearchParams({ ...params, timestamp, recvWindow: 10000 }).toString();
  const signature = sign(qs);
  const r = await fetch(`${base}${path}?${qs}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': API_KEY },
  });
  return { status: r.status, data: await r.json() };
}

async function binancePost(path, params = {}, base = BASE) {
  const timestamp = await serverTimeMs();
  const body = new URLSearchParams({ ...params, timestamp, recvWindow: 10000 }).toString();
  const signature = sign(body);
  // -1022 fix: the signature must be appended to the SIGNED PAYLOAD (the body),
  // not sent separately in the URL query — Binance matches the HMAC against the
  // exact form-urlencoded bytes it receives, so signature-in-URL fails closed.
  const signed = `${body}&signature=${signature}`;
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: signed,
  });
  return { status: r.status, data: await r.json() };
}

// ── Network config (registry network name → Binance chain details) ────────
const NETWORKS = {
  bsc:      { binance: 'BSC',      registry: 'BEP20',    chain: 'BNB Smart Chain', nativeSymbol: 'BNB',   explorer: 'https://bscscan.com' },
  eth:      { binance: 'ETH',      registry: 'ERC20',    chain: 'Ethereum',        nativeSymbol: 'ETH',   explorer: 'https://etherscan.io' },
  arbitrum: { binance: 'ARBITRUM', registry: 'ARBITRUM', chain: 'Arbitrum One',    nativeSymbol: 'ETH',   explorer: 'https://arbiscan.io' },
  optimism: { binance: 'OPTIMISM', registry: 'OPTIMISM', chain: 'Optimism',        nativeSymbol: 'ETH',   explorer: 'https://optimistic.etherscan.io' },
  polygon:  { binance: 'MATIC',    registry: 'POLYGON',  chain: 'Polygon PoS',     nativeSymbol: 'MATIC', explorer: 'https://polygonscan.com' },
  base:     { binance: 'BASE',     registry: 'BASE',     chain: 'Base',            nativeSymbol: 'ETH',   explorer: 'https://basescan.org' },
};

const NETWORK_ALIASES = {
  bsc: 'bsc', bnb: 'bsc', bep20: 'bsc',
  eth: 'eth', erc20: 'eth', ethereum: 'eth',
  arbitrum: 'arbitrum', arb: 'arbitrum',
  optimism: 'optimism', op: 'optimism',
  polygon: 'polygon', matic: 'polygon', pol: 'polygon',
  base: 'base',
};

function canonicalNetworkKey(input) {
  return NETWORK_ALIASES[String(input ?? '').trim().toLowerCase()] ?? null;
}

// Universal-transfer wallet names (Binance uses MAIN for the spot wallet).
const WALLET_ALIASES = {
  spot: 'MAIN', main: 'MAIN',
  funding: 'FUNDING',
  umfuture: 'UMFUTURE', futures: 'UMFUTURE', 'usdt-futures': 'UMFUTURE',
  cmfuture: 'CMFUTURE', 'coin-futures': 'CMFUTURE',
  margin: 'MARGIN', cross: 'MARGIN', crossed: 'MARGIN',
  isolatedmargin: 'ISOLATEDMARGIN', 'isolated-margin': 'ISOLATEDMARGIN',
};

function canonicalWallet(input) {
  return WALLET_ALIASES[String(input ?? '').trim().toLowerCase()] ?? null;
}

/** USDT value of a free balance, or null when Binance quotes no USDT pair. */
async function valueUsdt(asset, qty) {
  if (!qty) return 0;
  if (asset === 'USDT' || asset === 'USDC' || asset === 'BUSD') return Number(qty.toFixed(6));
  try {
    const r = await fetch(`${BASE}/api/v3/ticker/price?symbol=${asset}USDT`);
    const j = await r.json();
    const p = Number(j?.price);
    return Number.isFinite(p) && p > 0 ? Number((qty * p).toFixed(6)) : null;
  } catch {
    return null;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────
async function checkBalance() {
  console.log('Checking Binance balance...');
  requireCreds();
  const { status, data } = await binanceGet('/api/v3/account');

  if (status !== 200 || data.code) {
    console.log(JSON.stringify({
      ok: false,
      status,
      error: data.code || data.msg || 'unknown',
      message: data.msg || 'API key may be invalid. Regenerate in Binance > API Management.',
      hint: 'No IP whitelist, Enable Withdrawals. Binance geo-blocks some cloud egress (HTTP 451).',
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
  const asset = String(arg('asset', 'USDT')).trim().toUpperCase();
  console.log(`Checking Binance withdrawal networks for ${asset}...`);
  requireCreds();
  const { status, data } = await binanceGet('/sapi/v1/capital/config/getall');

  if (status !== 200 || data.code) {
    console.log(JSON.stringify({ ok: false, error: data.code || data.msg }));
    return;
  }

  const coin = (data || []).find(c => c.coin === asset);
  if (!coin) { console.log(JSON.stringify({ ok: false, error: `${asset} not found` })); return; }

  const networks = (coin.networkList || []).map(n => ({
    network: n.network,
    name: n.name,
    withdrawEnable: n.withdrawEnable,
    withdrawMin: n.withdrawMin,
    withdrawMax: n.withdrawMax,
    withdrawFee: n.withdrawFee,
  }));

  const withdrawable = networks.filter(n => n.withdrawEnable);

  console.log(JSON.stringify({
    ok: true,
    coin: asset,
    totalNetworks: networks.length,
    withdrawable: withdrawable.length,
    networks: withdrawable.map(n => `${n.network}: fee=${n.withdrawFee} min=${n.withdrawMin} max=${n.withdrawMax}`),
    cheapest: withdrawable.sort((a, b) => parseFloat(a.withdrawFee) - parseFloat(b.withdrawFee)).slice(0, 3),
  }, null, 2));
}

/**
 * Read-only inventory of every wallet Binance can hold an asset in. A rail
 * that reads only the spot account reports 0 while the UI shows a balance, so
 * holdings are enumerated per wallet and each balance is attributed to the
 * wallet that actually holds it. Nothing here moves funds.
 */
async function holdings() {
  requireCreds();
  const scopes = [];
  const push = (label, fn) => scopes.push((async () => {
    try {
      const assets = await fn();
      return { label, ok: true, assets };
    } catch (e) {
      return { label, ok: false, error: (e?.message ?? String(e)).slice(0, 200) };
    }
  })());

  const rows = (list) => (list || [])
    .map((a) => ({
      coin: a.asset,
      free: Number(a.free ?? 0),
      used: Number(a.locked ?? 0) + Number(a.freeze ?? 0) + Number(a.withdrawing ?? 0),
      total: Number(a.free ?? 0) + Number(a.locked ?? 0) + Number(a.freeze ?? 0) + Number(a.withdrawing ?? 0),
    }))
    .filter((a) => a.total > 0);

  push('spot', async () => rows((await binanceGet('/api/v3/account')).data?.balances));
  push('funding', async () => rows((await binancePost('/sapi/v1/asset/get-funding-asset', {})).data));
  push('all-coins', async () => rows((await binancePost('/sapi/v3/asset/getUserAsset', {})).data));
  push('cross margin', async () => {
    const d = (await binanceGet('/sapi/v1/margin/account')).data;
    return (d?.userAssets || [])
      .map((a) => ({ coin: a.asset, free: Number(a.free ?? 0), used: Number(a.locked ?? 0), total: Number(a.netAsset ?? 0) }))
      .filter((a) => a.total > 0);
  });
  push('USDT-M futures', async () => {
    const d = (await binanceGet('/fapi/v2/balance', {}, FAPI)).data;
    return (d || [])
      .map((a) => ({ coin: a.asset, free: Number(a.availableBalance ?? 0), used: 0, total: Number(a.balance ?? 0) }))
      .filter((a) => a.total > 0);
  });

  const resolved = await Promise.all(scopes);

  const byCoin = new Map();
  for (const scope of resolved) {
    for (const a of scope.assets ?? []) {
      const entry = byCoin.get(a.coin) ?? { coin: a.coin, totalUnits: 0, locations: [] };
      entry.totalUnits += a.total;
      entry.locations.push({ wallet: scope.label, total: a.total, free: a.free });
      byCoin.set(a.coin, entry);
    }
  }

  const assets = [];
  for (const entry of byCoin.values()) {
    const value = await valueUsdt(entry.coin, entry.totalUnits);
    assets.push({
      coin: entry.coin,
      totalUnits: Number(entry.totalUnits.toFixed(12)),
      locations: entry.locations,
      valueUsdt: value,
    });
  }
  assets.sort((a, b) => (b.valueUsdt ?? -1) - (a.valueUsdt ?? -1));

  const report = {
    ok: true,
    at: new Date().toISOString(),
    readOnly: true,
    fundsMoved: false,
    scopes: resolved,
    walletsHoldingAssets: resolved.filter((s) => (s.assets ?? []).length > 0).map((s) => s.label),
    assets,
    answer: assets.length === 0
      ? 'No asset balance found in any Binance wallet for this API key.'
      : `${assets.length} asset(s) held in: ${resolved.filter((s) => (s.assets ?? []).length > 0).map((s) => s.label).join(', ')}.`,
  };

  try {
    writeFileSync(resolve(OUT, `binance-holdings-${Date.now()}.json`), JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`artifact write failed: ${e?.message ?? String(e)}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

async function withdraw() {
  const amount = Number(arg('amount', '0'));
  const confirm = process.argv.includes('--confirm');
  const routeId = arg('route', undefined);
  const asset = String(arg('asset', 'USDT')).trim().toUpperCase();
  const networkKey = canonicalNetworkKey(arg('network', 'bsc'));

  if (!(amount > 0)) fail('AMOUNT_REQUIRED', '--amount required (>0)', 1);
  if (!networkKey) {
    fail('NETWORK_UNKNOWN', `--network must be one of: ${Object.keys(NETWORKS).join(', ')}`);
  }

  // Destination resolution comes first: no API call and above all no send
  // until a verified owner route has been resolved.
  let registry;
  try {
    registry = loadRoutes();
  } catch (e) {
    fail('ROUTE_REGISTRY_UNREADABLE', e?.message ?? String(e));
  }

  const network = NETWORKS[networkKey];
  const resolved = routeId
    ? resolveRoute(registry, { id: routeId })
    : resolveRoute(registry, { rail: 'binance', asset, network: network.registry });
  if (!resolved.ok) {
    fail(resolved.code, `${resolved.error} | available routes: ${listRoutes(registry).map((r) => r.id).join(', ')}`);
  }

  const route = resolved.route;
  if (route.network !== network.registry) {
    fail('ROUTE_NETWORK_MISMATCH', `route "${route.id}" is on ${route.network}, not ${network.registry} (network ${networkKey})`);
  }
  // A destination passed by the caller must BE the registered one.
  if (ADDRESS_OVERRIDE && fold(ADDRESS_OVERRIDE) !== fold(route.address)) {
    fail('ROUTE_ADDRESS_MISMATCH', `caller-supplied destination is not the registered address of route "${route.id}"`);
  }

  requireCreds();

  // First check available networks
  const { status: netStatus, data: netData } = await binanceGet('/sapi/v1/capital/config/getall');
  if (netStatus !== 200) fail('NETWORKS_UNAVAILABLE', 'Failed to fetch withdrawal networks');

  const coin = (netData || []).find(c => c.coin === route.asset);
  const net = (coin?.networkList || []).find(n => n.network === network.binance && n.withdrawEnable);

  if (!net) {
    fail('NETWORK_UNAVAILABLE', `Network ${network.binance} not available for ${route.asset} withdrawal`, 1);
  }

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Binance',
    routeId: route.id,
    asset: route.asset,
    amount,
    network: network.binance,
    chain: network.chain,
    to: route.address,
    fee: net.withdrawFee,
    minWithdraw: net.withdrawMin,
    maxWithdraw: net.withdrawMax,
    dryRun: !confirm,
    status: 'DRY_RUN',
    fundsMoved: false,
  };

  if (amount < parseFloat(net.withdrawMin)) {
    plan.status = 'BELOW_MINIMUM';
    plan.error = `Amount ${amount} ${route.asset} < minimum ${net.withdrawMin} ${route.asset}`;
    writeFileSync(resolve(OUT, `binance-plan-refused-${Date.now()}.json`), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (!confirm) {
    plan.note = 'Add --confirm to execute withdrawal.';
    writeFileSync(resolve(OUT, `binance-plan-dryrun-${Date.now()}.json`), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // I8: explicit capability grant required for actual money movement.
  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.note = 'Set the CAP_WITHDRAW_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.';
    writeFileSync(resolve(OUT, `binance-plan-refused-${Date.now()}.json`), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // Execute withdrawal
  console.log('Executing Binance withdrawal...');
  const { status, data } = await binancePost('/sapi/v1/capital/withdraw/apply', {
    coin: route.asset,
    network: network.binance,
    address: route.address,
    amount: String(amount),
  });

  if (status === 200 && data.id) {
    plan.status = 'WITHDRAWAL_SUBMITTED';
    plan.withdrawId = data.id;
    plan.fundsMoved = true;
    plan.explorer = network.explorer + '/address/' + route.address;
  } else {
    plan.status = 'FAILED';
    plan.error = data.msg || JSON.stringify(data).slice(0, 300);
  }

  writeFileSync(resolve(OUT, `binance-withdrawal-${Date.now()}.json`), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
}

/**
 * Move an asset between two wallets of the same Binance account
 * (funding -> spot is the usual unstick) via the Universal Transfer endpoint.
 * No external address is involved, so the route registry plays no part.
 */
async function transfer() {
  const confirm = process.argv.includes('--confirm');
  const all = process.argv.includes('--all');
  const asset = String(arg('asset', '')).trim().toUpperCase();
  const from = canonicalWallet(arg('from', 'funding'));
  const to = canonicalWallet(arg('to', 'spot'));

  if (!asset) fail('TRANSFER_ASSET_REQUIRED', 'pass --asset <COIN>', 1);
  if (!from || !to) {
    fail('TRANSFER_WALLET_UNKNOWN', `unknown wallet — known: ${Object.keys(WALLET_ALIASES).sort().join(', ')}`);
  }
  if (from === to) fail('TRANSFER_SAME_WALLET', `--from and --to both resolve to "${from}"`, 1);

  const amountArg = arg('amount', undefined);
  const requested = amountArg === undefined ? null : Number(amountArg);
  if (!all && !(requested > 0)) fail('TRANSFER_AMOUNT_REQUIRED', 'pass --amount <qty> or --all', 1);

  requireCreds();

  let free = null;
  if (all) {
    const { data } = from === 'FUNDING'
      ? await binancePost('/sapi/v1/asset/get-funding-asset', { asset })
      : await binancePost('/sapi/v3/asset/getUserAsset', { asset });
    const row = (Array.isArray(data) ? data : []).find((a) => a.asset === asset);
    free = Number(row?.free ?? 0);
    if (!(free > 0)) fail('TRANSFER_NOTHING_TO_TRANSFER', `free ${asset} reported by the ${from} wallet is ${free}`);
  }

  const amount = Number((all ? free : requested).toFixed(8));
  if (!(amount > 0)) fail('TRANSFER_AMOUNT_DUST', 'requested amount rounds to 0');

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Binance',
    action: 'transfer',
    type: `${from}_${to}`,
    asset,
    amount,
    dryRun: !confirm,
    status: 'DRY_RUN',
    fundsMoved: false,
  };

  if (!confirm) {
    plan.note = 'Add --confirm to move the balance between wallets. Nothing is sent without it.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.note = 'Set the CAP_WITHDRAW_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log('Executing Binance universal transfer...');
  const { status, data } = await binancePost('/sapi/v1/asset/transfer', {
    type: plan.type,
    asset,
    amount: String(amount),
  });

  if (status === 200 && (data.tranId || data.tranId === 0)) {
    plan.status = 'TRANSFERRED';
    plan.tranId = String(data.tranId);
    plan.fundsMoved = true;
  } else {
    plan.status = 'FAILED';
    plan.error = data.msg || JSON.stringify(data).slice(0, 300);
  }

  writeFileSync(resolve(OUT, `binance-transfer-${Date.now()}.json`), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
}

/**
 * Convert one asset into another via Binance Convert (RFQ). This is the path
 * that matters for a balance with no tradable spot pair. The quote is always
 * taken immediately before the accept — a stale quote is refused.
 */
async function convert() {
  const confirm = process.argv.includes('--confirm');
  const all = process.argv.includes('--all');
  const fromAsset = String(arg('from', '')).trim().toUpperCase();
  const toAsset = String(arg('to', 'USDT')).trim().toUpperCase();

  if (!fromAsset) fail('CONVERT_FROM_REQUIRED', 'pass --from <COIN> [--to <COIN>]', 1);
  if (fromAsset === toAsset) fail('CONVERT_SYMBOL_INVALID', '--from and --to must differ', 1);

  const amountArg = arg('amount', undefined);
  const requested = amountArg === undefined ? null : Number(amountArg);
  if (!all && !(requested > 0)) fail('CONVERT_AMOUNT_REQUIRED', 'pass --amount <qty> or --all', 1);

  requireCreds();

  let free = null;
  if (all) {
    const { data } = await binancePost('/sapi/v3/asset/getUserAsset', { asset: fromAsset });
    const row = (Array.isArray(data) ? data : []).find((a) => a.asset === fromAsset);
    free = Number(row?.free ?? 0);
    if (!(free > 0)) fail('CONVERT_NOTHING_TO_CONVERT', `free ${fromAsset} balance is ${free} (see --action holdings)`);
  }

  const amount = Number((all ? free : requested).toFixed(8));
  if (!(amount > 0)) fail('CONVERT_AMOUNT_DUST', 'requested amount rounds to 0');

  const notionalFloor = Number(process.env.CONVERT_MIN_NOTIONAL_USDT ?? 1) || 1;

  const quote = async () => {
    const { status, data } = await binancePost('/sapi/v1/convert/getQuote', {
      fromAsset,
      toAsset,
      fromAmount: String(amount),
    });
    if (status !== 200 || data.code) {
      fail('CONVERT_QUOTE_UNAVAILABLE', `Binance convert cannot quote ${fromAsset}->${toAsset}: ${data.msg || JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  };

  const q = await quote();
  const ratio = Number(q.ratio);
  const toAmount = Number(q.toAmount);
  if (!(toAmount > 0) || !(ratio > 0)) {
    fail('CONVERT_QUOTE_INCOMPLETE', `Binance convert returned no usable price for ${fromAsset}->${toAsset}`);
  }

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Binance',
    action: 'convert',
    fromAsset,
    toAsset,
    amount,
    freeBefore: free,
    ratio,
    toAmount,
    quoteId: q.quoteId ?? null,
    dryRun: !confirm,
    status: 'DRY_RUN',
    fundsMoved: false,
  };

  if (toAsset === 'USDT' && toAmount < notionalFloor) {
    plan.status = 'BELOW_NOTIONAL_FLOOR';
    plan.error = `notional ${toAmount.toFixed(2)} ${toAsset} < floor ${notionalFloor} ${toAsset} (CONVERT_MIN_NOTIONAL_USDT)`;
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (!confirm) {
    plan.note = 'Add --confirm to accept the quote. Nothing is sent without it.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.note = 'Set the CAP_WITHDRAW_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // Re-quote immediately before accepting: a stale quote is refused.
  const fresh = await quote();
  if (!(Number(fresh.toAmount) > 0) || !fresh.quoteId) {
    plan.status = 'CONVERT_QUOTE_STALE';
    plan.error = 'fresh convert quote came back unusable — nothing submitted';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  plan.quoteId = fresh.quoteId;
  plan.ratio = Number(fresh.ratio);
  plan.toAmount = Number(fresh.toAmount);

  console.log('Executing Binance convert...');
  const acc = await binancePost('/sapi/v1/convert/acceptQuote', { quoteId: fresh.quoteId });
  if (acc.status === 200 && acc.data?.orderId) {
    plan.status = 'CONVERTED';
    plan.orderId = String(acc.data.orderId);
    plan.fundsMoved = true;
  } else {
    plan.status = 'FAILED';
    plan.error = acc.data?.msg || JSON.stringify(acc.data).slice(0, 300);
  }

  // Never trust the response alone: re-read the source balance.
  const afterRes = await binancePost('/sapi/v3/asset/getUserAsset', { asset: fromAsset });
  const afterRow = (Array.isArray(afterRes.data) ? afterRes.data : []).find((a) => a.asset === fromAsset);
  plan.sourceAfter = Number(afterRow?.free ?? 0);
  if (plan.status === 'CONVERTED' && free !== null && !(free - plan.sourceAfter > 0)) {
    plan.status = 'CONVERT_UNCONFIRMED';
    plan.fundsMoved = false;
    plan.error = `order ${plan.orderId} returned but the ${fromAsset} free balance did not decrease — treated as failure`;
  }

  writeFileSync(resolve(OUT, `binance-convert-${Date.now()}.json`), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
}

/** Operator inventory of every declared route and whether it is armed. */
function checkRoutes() {
  let registry;
  try {
    registry = loadRoutes();
  } catch (e) {
    fail('ROUTE_REGISTRY_UNREADABLE', e?.message ?? String(e));
  }
  console.log(JSON.stringify({ ok: true, verifiedAt: registry.verifiedAt, routes: listRoutes(registry) }, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────
// Exported for signature tests (scripts/test-binance-rail.mjs). Executing this
// file directly still runs the CLI dispatch below, unchanged.
export { sign, binanceGet, binancePost };

const action = arg('action', 'balance');
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isDirectRun) {
  // imported as a module (tests) — do not execute a CLI action
} else if (action === 'balance') await checkBalance();
else if (action === 'holdings') await holdings();
else if (action === 'networks') await checkNetworks();
else if (action === 'routes') checkRoutes();
else if (action === 'transfer') await transfer();
else if (action === 'convert') await convert();
else if (action === 'withdraw') await withdraw();
else {
  console.error('actions: balance, holdings, networks, routes, transfer, convert, withdraw');
  process.exit(1);
}
