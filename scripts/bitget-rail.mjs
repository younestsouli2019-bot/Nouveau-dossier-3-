#!/usr/bin/env node
/**
 * bitget-rail.mjs  (AUTONOMOUS · non-custodial · fail-closed)
 *
 * Direct Bitget API integration (CCXT) for balance check + withdrawal to one
 * of the owner's pre-set, verified payout routes declared in
 * config/crypto-addresses.json (resolved by scripts/lib/owner-routes.mjs).
 *
 *   node scripts/bitget-rail.mjs --action balance
 *   node scripts/bitget-rail.mjs --action networks
 *   node scripts/bitget-rail.mjs --action routes
 *   node scripts/bitget-rail.mjs --action withdraw --amount 3.3 --route bitget-usdt-bep20
 *   node scripts/bitget-rail.mjs --action withdraw --amount 3.3 --network bsc --confirm
 *   node scripts/bitget-rail.mjs --action convert --from BTC --to USDT --all
 *   node scripts/bitget-rail.mjs --action convert --symbol BTC/USDT --amount 0.00004 --confirm
 *
 * Fail-closed: without --confirm, emits a dry-run plan. Never sends with
 * amount=0, never fabricates tx hashes, never moves funds without the I8
 * capability grant (CAP_WITHDRAW_CRYPTO=true). A destination that does not
 * resolve to a verified owner route is refused — there is no default wallet
 * and no fallback chain. A conversion is verified against a fresh balance
 * read, never against the exchange order response alone.
 */
import 'dotenv/config';
import ccxt from 'ccxt';
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

const API_KEY = process.env.BITGET_API_KEY;
const API_SECRET = process.env.BITGET_API_SECRET;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;
// A destination supplied out-of-band (workflow dispatch input) is only ever
// cross-checked against the registry — it never replaces it.
const ADDRESS_OVERRIDE = process.env.OWNER_CRYPTO_ADDRESS || process.env.TRUST_WALLET_ADDRESS || null;

function fail(code, error, exitCode = 2) {
  console.log(JSON.stringify({ ok: false, code, error, fundsMoved: false }, null, 2));
  process.exit(exitCode);
}

function requireCreds() {
  if (!API_KEY || !API_SECRET || !PASSPHRASE) {
    fail('CREDENTIALS_MISSING', 'BITGET_API_KEY or BITGET_API_SECRET or BITGET_PASSPHRASE not set');
  }
}

// Chain metadata for the networks the registry is allowed to name. A route on
// an unknown network still executes, it just carries no chain/explorer hint.
const NETWORKS = {
  BEP20: { chain: 'BNB Smart Chain', explorer: 'https://bscscan.com' },
  ERC20: { chain: 'Ethereum', explorer: 'https://etherscan.io' },
  TRC20: { chain: 'TRON', explorer: 'https://tronscan.org' },
  BTC: { chain: 'Bitcoin', explorer: 'https://mempool.space' },
};

// Accepted --network shorthands, folded onto the registry's network names.
const NETWORK_ALIASES = {
  bsc: 'BEP20', bnb: 'BEP20', bep20: 'BEP20',
  erc20: 'ERC20', eth: 'ERC20', ethereum: 'ERC20',
  trc20: 'TRC20', tron: 'TRC20',
  btc: 'BTC', bitcoin: 'BTC',
};

function canonicalNetwork(input) {
  const s = String(input ?? '').trim();
  return NETWORK_ALIASES[s.toLowerCase()] ?? s.toUpperCase();
}

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
  requireCreds();
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
  requireCreds();
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
  const confirm = process.argv.includes('--confirm');
  const routeId = arg('route', undefined);
  const asset = String(arg('asset', 'USDT')).trim().toUpperCase();
  const requestedNetwork = canonicalNetwork(arg('network', 'bsc'));

  if (!(amount > 0)) fail('AMOUNT_REQUIRED', '--amount required (>0)', 1);

  // Destination resolution comes first: no API call, no credential read, and
  // above all no send until a verified owner route has been resolved.
  let registry;
  try {
    registry = loadRoutes();
  } catch (e) {
    fail('ROUTE_REGISTRY_UNREADABLE', e?.message ?? String(e));
  }

  const resolved = routeId
    ? resolveRoute(registry, { id: routeId })
    : resolveRoute(registry, { rail: 'bitget', asset, network: requestedNetwork });
  if (!resolved.ok) {
    fail(resolved.code, `${resolved.error} | available routes: ${listRoutes(registry).map((r) => r.id).join(', ')}`);
  }

  const route = resolved.route;
  const network = NETWORKS[route.network] ?? { chain: route.network, explorer: null };

  // A destination passed by the caller must BE the registered one; anything
  // else is an attempt to substitute a wallet we did not verify.
  if (ADDRESS_OVERRIDE && fold(ADDRESS_OVERRIDE) !== fold(route.address)) {
    fail(
      'ROUTE_ADDRESS_MISMATCH',
      `caller-supplied destination is not the registered address of route "${route.id}"`,
    );
  }

  requireCreds();

  const bitget = makeClient();
  await bitget.loadTimeDifference();

  const currencies = await bitget.fetchCurrencies();
  const coin = currencies?.[route.asset];
  const liveNetwork = coin?.networks ? pickNetworkInfo(coin.networks, route.network) : null;

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Bitget',
    routeId: route.id,
    asset: route.asset,
    amount,
    network: route.network,
    chain: network.chain,
    to: route.address,
    fee: liveNetwork?.fee ?? null,
    minWithdraw: liveNetwork?.min ?? null,
    maxWithdraw: liveNetwork?.max ?? null,
    dryRun: !confirm,
    status: 'DRY_RUN',
  };

  if (!liveNetwork || liveNetwork.active === false) {
    plan.status = 'NETWORK_UNAVAILABLE';
    plan.error = `Network ${route.network} not available for ${route.asset} withdrawal`;
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (liveNetwork.min !== null && amount < liveNetwork.min) {
    plan.status = 'BELOW_MINIMUM';
    plan.error = `Amount ${amount} ${route.asset} < minimum ${liveNetwork.min} ${route.asset}`;
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
  const available = Number(b?.free?.[route.asset] ?? 0);
  if (!(available >= amount)) {
    plan.status = 'INSUFFICIENT_BALANCE';
    plan.error = `Available ${route.asset} ${available} < requested ${amount}`;
    plan.fundsMoved = false;
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log('Executing Bitget withdrawal...');
  try {
    const result = await bitget.withdraw(route.asset, amount, route.address, undefined, {
      network: route.network,
      clientOid: `btr-${Date.now()}`,
    });
    const withdrawId = result?.id ?? result?.withdrawId ?? result?.withdrawal?.id ?? null;
    if (withdrawId) {
      plan.status = 'WITHDRAWAL_SUBMITTED';
      plan.withdrawId = String(withdrawId);
      plan.fundsMoved = true;
      if (network.explorer) plan.explorer = network.explorer + '/address/' + route.address;
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

/**
 * Convert a stranded base balance into the quote asset the payout rails can
 * move (BTC -> USDT today). A market sell is the only way to unstick an
 * asset the rail cannot withdraw; it is deliberately narrow:
 * only a SELL of the base balance, never a buy, never a leveraged product.
 *
 * Guarded exactly like a withdrawal: dry-run by default, explicit
 * capability grant (I8), live balance re-read before submission, and the
 * result is verified against a fresh balance read instead of trusting the
 * exchange response.
 */
async function convert() {
  const confirm = process.argv.includes('--confirm');
  const all = process.argv.includes('--all');
  const symbolArg = String(arg('symbol', '')).trim().toUpperCase();
  const symbol = symbolArg || `${String(arg('from', 'BTC')).trim().toUpperCase()}/${String(arg('to', 'USDT')).trim().toUpperCase()}`;
  const [base, quote] = symbol.split('/');
  if (!base || !quote || base === quote) {
    fail('CONVERT_SYMBOL_INVALID', `--symbol must look like BASE/QUOTE (got "${symbol}")`);
  }

  const amountArg = arg('amount', undefined);
  const requested = amountArg === undefined ? null : Number(amountArg);
  if (!all && !(requested > 0)) fail('CONVERT_AMOUNT_REQUIRED', 'pass --amount <base qty> or --all', 1);

  requireCreds();
  const bitget = makeClient();
  await bitget.loadTimeDifference();
  await bitget.loadMarkets();

  let market;
  try {
    market = bitget.market(symbol);
  } catch (e) {
    fail('CONVERT_SYMBOL_UNLISTED', `Bitget does not list ${symbol}: ${e?.message ?? String(e)}`);
  }

  const b = await bitget.fetchBalance();
  const free = Number(b?.free?.[base] ?? 0);
  if (!(free > 0)) fail('CONVERT_NOTHING_TO_CONVERT', `free ${base} balance is ${free} — nothing to convert`);

  const amount = Number(bitget.amountToPrecision(symbol, all ? free : requested));
  if (!(amount > 0)) fail('CONVERT_AMOUNT_DUST', `requested amount rounds to 0 at ${symbol} precision`);

  const minAmount = market?.limits?.amount?.min ?? null;
  if (minAmount !== null && amount < minAmount) {
    fail('CONVERT_BELOW_MINIMUM', `${amount} ${base} < exchange minimum ${minAmount} ${base}`);
  }
  if (amount > free) fail('CONVERT_INSUFFICIENT_BALANCE', `requested ${amount} ${base} > free ${free} ${base}`);

  const notionalFloor = Number(process.env.CONVERT_MIN_NOTIONAL_USDT ?? 1) || 1;
  const ticker = await bitget.fetchTicker(symbol);
  const last = Number(ticker?.last ?? ticker?.close ?? 0);
  const notional = last > 0 ? amount * last : null;
  if (notional !== null) {
    const minCost = market?.limits?.cost?.min ?? null;
    if (minCost !== null && notional < minCost) {
      fail('CONVERT_BELOW_MIN_COST', `notional ${notional.toFixed(2)} ${quote} < exchange minimum ${minCost} ${quote}`);
    }
    // Dust conversions destroy more value in fees than they recover.
    if (notional < notionalFloor) {
      fail('CONVERT_BELOW_NOTIONAL_FLOOR', `notional ${notional.toFixed(2)} ${quote} < floor ${notionalFloor} ${quote} (CONVERT_MIN_NOTIONAL_USDT)`);
    }
  }

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Bitget',
    action: 'convert',
    symbol,
    side: 'sell',
    amount,
    freeBefore: free,
    lastPrice: last > 0 ? last : null,
    notionalQuote: notional !== null ? Number(notional.toFixed(8)) : null,
    quote,
    dryRun: !confirm,
    status: 'DRY_RUN',
    fundsMoved: false,
  };

  if (!confirm) {
    plan.note = 'Add --confirm to submit the market sell. Nothing is sent without it.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // I8: the conversion exists only to make the owner sweep possible, so it is
  // authorised by the same explicit grant as the withdrawal itself.
  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.note = 'Set CAP_WITHDRAW_CRYPTO=true to authorize. Dry-run planning is always allowed.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log('Executing Bitget market sell...');
  let orderId = null;
  try {
    const order = await bitget.createMarketSellOrder(symbol, amount);
    orderId = order?.id ?? null;
    plan.orderId = orderId ? String(orderId) : null;
  } catch (e) {
    plan.status = 'FAILED';
    plan.error = (e?.message ?? String(e)).slice(0, 300);
    console.log(JSON.stringify(plan, null, 2));
    writeConvertArtifact(plan);
    return;
  }

  // Never trust the order response alone: re-read the balance and require the
  // base to have actually decreased before calling the conversion done.
  const after = await bitget.fetchBalance();
  const baseAfter = Number(after?.free?.[base] ?? 0);
  const quoteAfter = Number(after?.free?.[quote] ?? 0);
  plan.baseAfter = baseAfter;
  plan.quoteAfter = quoteAfter;
  const consumed = free - baseAfter;

  if (consumed > 0) {
    plan.status = 'CONVERTED';
    plan.baseConsumed = Number(consumed.toFixed(8));
    plan.fundsMoved = true;
  } else {
    plan.status = 'CONVERT_UNCONFIRMED';
    plan.error = `order ${orderId ?? '(no id)'} returned but ${base} free balance did not decrease — treated as failure`;
  }

  writeConvertArtifact(plan);
  console.log(JSON.stringify(plan, null, 2));
}

function writeConvertArtifact(plan) {
  try {
    const outFile = resolve(OUT, `bitget-convert-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(plan, null, 2));
  } catch (e) {
    console.error(`artifact write failed: ${e?.message ?? String(e)}`);
  }
}

/** Operator inventory of every declared route and whether it is armed. */
function checkRoutes() {
  let registry;
  try {
    registry = loadRoutes();
  } catch (e) {
    fail('ROUTE_REGISTRY_UNREADABLE', e?.message ?? String(e));
  }
  console.log(
    JSON.stringify({ ok: true, verifiedAt: registry.verifiedAt, routes: listRoutes(registry) }, null, 2),
  );
}

const action = arg('action', 'balance');
if (action === 'balance') await checkBalance();
else if (action === 'networks') await checkNetworks();
else if (action === 'routes') checkRoutes();
else if (action === 'convert') await convert();
else if (action === 'withdraw') await withdraw();
else { console.error('actions: balance, networks, routes, convert, withdraw'); process.exit(1); }