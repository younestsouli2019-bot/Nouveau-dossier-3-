#!/usr/bin/env node
/**
 * bitget-rail.mjs  (AUTONOMOUS · non-custodial · fail-closed)
 *
 * Direct Bitget API integration (CCXT) for balance check + withdrawal to one
 * of the owner's pre-set, verified payout routes declared in
 * config/crypto-addresses.json (resolved by scripts/lib/owner-routes.mjs).
 *
 *   node scripts/bitget-rail.mjs --action balance
 *   node scripts/bitget-rail.mjs --action holdings
 *   node scripts/bitget-rail.mjs --action networks
 *   node scripts/bitget-rail.mjs --action routes
 *   node scripts/bitget-rail.mjs --action transfer --asset VND --from funding --to spot --all
 *   node scripts/bitget-rail.mjs --action convert --from VND --to USDT --all
 *   node scripts/bitget-rail.mjs --action convert --symbol BTC/USDT --amount 0.00004 --confirm
 *   node scripts/bitget-rail.mjs --action convert-dust --coin VND --confirm
 *   node scripts/bitget-rail.mjs --action withdraw --amount 3.3 --route bitget-usdt-bep20
 *   node scripts/bitget-rail.mjs --action withdraw --amount 3.3 --network bsc --confirm
 *
 * Fail-closed: without --confirm, emits a dry-run plan. Never sends with
 * amount=0, never fabricates tx hashes, never moves funds without the I8
 * capability grant (CAP_WITHDRAW_CRYPTO=true). A destination that does not
 * resolve to a verified owner route is refused — there is no default wallet
 * and no fallback chain. A conversion is verified against a fresh balance
 * read, never against the exchange order response alone.
 *
 * A balance the spot market cannot price (no BASE/QUOTE pair) is still
 * reachable: --action convert --method auto falls back to Bitget's own RFQ
 * convert, and --action transfer unsticks an asset sitting in another wallet.
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

// Accepted --from/--to wallet shorthands, folded onto the ccxt account-type
// keys (bitget.options.accountsByType). Anything unknown resolves to null and
// the transfer is refused rather than guessed.
const WALLET_ALIASES = {
  spot: 'spot', funding: 'funding', p2p: 'p2p',
  cross: 'cross', crossed: 'cross', crossed_margin: 'cross', margin: 'cross',
  isolated: 'isolated', isolated_margin: 'isolated',
  swap: 'swap', usdt_futures: 'swap', futures: 'swap',
  usdc_swap: 'usdc_swap', usdc_futures: 'usdc_swap',
  future: 'future', coin_futures: 'future',
  uta: 'uta', unified: 'uta',
};

// How to read one wallet's free balance back. The classic spot/funding/p2p
// wallets share the default read; the rest need an account-type hint.
const WALLET_READ = {
  spot: {}, funding: {}, p2p: {},
  uta: { uta: true },
  swap: { type: 'swap', productType: 'USDT-FUTURES' },
  usdc_swap: { type: 'swap', productType: 'USDC-FUTURES' },
  future: { type: 'swap', productType: 'COIN-FUTURES' },
  cross: { type: 'margin', marginMode: 'cross' },
  isolated: { type: 'margin', marginMode: 'isolated' },
};

function canonicalWallet(input) {
  return WALLET_ALIASES[String(input ?? '').trim().toLowerCase()] ?? null;
}

async function walletFree(bitget, wallet, asset) {
  const bal = await bitget.fetchBalance(WALLET_READ[wallet] ?? {});
  return Number(bal?.free?.[asset] ?? 0);
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
 * Move an asset between two wallets of the same account (funding -> spot is
 * the usual unstick). Internal only: no external address is involved, so the
 * route registry plays no part here. The guard is instead that the two wallets
 * must differ, be known, and that the source wallet must actually hold enough —
 * verified again after the call, never trusted from the response.
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
  const bitget = makeClient();
  await bitget.loadTimeDifference();
  await bitget.loadMarkets();

  const free = await walletFree(bitget, from, asset);
  if (!(free > 0)) {
    fail('TRANSFER_NOTHING_TO_TRANSFER', `free ${asset} in the ${from} wallet is ${free} — see --action holdings`);
  }

  const amount = Number((all ? free : requested).toFixed(8));
  if (!(amount > 0)) fail('TRANSFER_AMOUNT_DUST', 'requested amount rounds to 0');
  if (amount > free) {
    fail('TRANSFER_INSUFFICIENT_BALANCE', `requested ${amount} ${asset} > free ${free} ${asset} in ${from}`);
  }

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Bitget',
    action: 'transfer',
    asset,
    from,
    to,
    amount,
    freeBefore: free,
    dryRun: !confirm,
    status: 'DRY_RUN',
    fundsMoved: false,
  };

  if (!confirm) {
    plan.note = 'Add --confirm to move the balance between wallets. Nothing is sent without it.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // I8: same explicit grant as the withdrawal — no flag, no move.
  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.note = 'Set the CAP_WITHDRAW_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log('Executing Bitget wallet transfer...');
  let transferId = null;
  try {
    const result = await bitget.transfer(asset, amount, from, to, { clientOid: `btr-x-${Date.now()}` });
    transferId = result?.id ?? result?.info?.transferId ?? null;
    plan.transferId = transferId ? String(transferId) : null;
  } catch (e) {
    plan.status = 'FAILED';
    plan.error = (e?.message ?? String(e)).slice(0, 300);
    console.log(JSON.stringify(plan, null, 2));
    writeArtifact('transfer', plan);
    return;
  }

  // Never trust the response alone: the source wallet must actually be lighter.
  const after = await walletFree(bitget, from, asset);
  plan.sourceAfter = after;
  const moved = free - after;
  if (moved > 0) {
    plan.status = 'TRANSFERRED';
    plan.moved = Number(moved.toFixed(8));
    plan.fundsMoved = true;
  } else {
    plan.status = 'TRANSFER_UNCONFIRMED';
    plan.error = `transfer ${transferId ?? '(no id)'} returned but the ${from} ${asset} balance did not decrease — treated as failure`;
  }

  writeArtifact('transfer', plan);
  console.log(JSON.stringify(plan, null, 2));
}

/**
 * Convert a stranded base balance into the quote asset the payout rails can
 * move. Two execution paths:
 *
 *   market — a plain spot market SELL (BASE/QUOTE must be listed).
 *   native — Bitget's own RFQ convert (v2/convert/quoted-price -> trade), the
 *            only route for an asset with no spot pair at all (a held VND
 *            balance, for instance).
 *
 * --method auto (the default) picks market when the pair is listed, native
 * otherwise. Both paths are guarded like a withdrawal: dry-run by default,
 * explicit capability grant (I8), live balance re-read before submission, and
 * the outcome is verified against a fresh balance read instead of trusting the
 * exchange response. A native trade always uses a quote taken immediately
 * before the call — a stale quote is refused.
 */
async function convert() {
  const confirm = process.argv.includes('--confirm');
  const all = process.argv.includes('--all');
  const method = String(arg('method', 'auto')).trim().toLowerCase();
  if (!['auto', 'market', 'native'].includes(method)) {
    fail('CONVERT_METHOD_INVALID', `--method must be auto, market or native (got "${method}")`);
  }

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

  const market = bitget.markets?.[symbol] ?? null;
  const marketUsable = !!market && market.active !== false;
  const path = method === 'auto' ? (marketUsable ? 'market' : 'native') : method;
  if (path === 'market' && !marketUsable) {
    fail('CONVERT_SYMBOL_UNLISTED', `Bitget does not list ${symbol} — retry with --method native`);
  }

  const b = await bitget.fetchBalance();
  const free = Number(b?.free?.[base] ?? 0);
  if (!(free > 0)) {
    fail('CONVERT_NOTHING_TO_CONVERT', `free ${base} balance is ${free} — nothing to convert (see --action holdings)`);
  }

  const amount = path === 'market'
    ? Number(bitget.amountToPrecision(symbol, all ? free : requested))
    : Number((all ? free : requested).toFixed(8));
  if (!(amount > 0)) fail('CONVERT_AMOUNT_DUST', 'requested amount rounds to 0 at this precision');
  if (amount > free) fail('CONVERT_INSUFFICIENT_BALANCE', `requested ${amount} ${base} > free ${free} ${base}`);

  if (path === 'market') {
    const minAmount = market?.limits?.amount?.min ?? null;
    if (minAmount !== null && amount < minAmount) {
      fail('CONVERT_BELOW_MINIMUM', `${amount} ${base} < exchange minimum ${minAmount} ${base}`);
    }
  }

  const notionalFloor = Number(process.env.CONVERT_MIN_NOTIONAL_USDT ?? 1) || 1;

  const plan = {
    at: new Date().toISOString(),
    exchange: 'Bitget',
    action: 'convert',
    path,
    symbol,
    base,
    quote,
    amount,
    freeBefore: free,
    dryRun: !confirm,
    status: 'DRY_RUN',
    fundsMoved: false,
  };

  // Price the conversion. Read-only on both paths.
  if (path === 'market') {
    const ticker = await bitget.fetchTicker(symbol);
    const last = Number(ticker?.last ?? ticker?.close ?? 0);
    plan.lastPrice = last > 0 ? last : null;
    plan.notionalQuote = last > 0 ? Number((amount * last).toFixed(8)) : null;
    if (plan.notionalQuote !== null) {
      const minCost = market?.limits?.cost?.min ?? null;
      if (minCost !== null && plan.notionalQuote < minCost) {
        fail('CONVERT_BELOW_MIN_COST', `notional ${plan.notionalQuote.toFixed(2)} ${quote} < exchange minimum ${minCost} ${quote}`);
      }
      // Dust conversions destroy more value in fees than they recover.
      if (plan.notionalQuote < notionalFloor) {
        fail('CONVERT_BELOW_NOTIONAL_FLOOR', `notional ${plan.notionalQuote.toFixed(2)} ${quote} < floor ${notionalFloor} ${quote} (CONVERT_MIN_NOTIONAL_USDT)`);
      }
    }
  } else {
    let quoteRes;
    try {
      quoteRes = await bitget.fetchConvertQuote(base, quote, amount);
    } catch (e) {
      fail('CONVERT_QUOTE_UNAVAILABLE', `Bitget convert cannot quote ${symbol}: ${(e?.message ?? String(e)).slice(0, 200)}`);
    }
    if (!quoteRes?.id || !(Number(quoteRes?.toAmount) > 0) || !(Number(quoteRes?.price) > 0)) {
      fail('CONVERT_QUOTE_INCOMPLETE', `Bitget convert returned no usable price for ${symbol}`);
    }
    plan.quoteId = quoteRes.id;
    plan.lastPrice = Number(quoteRes.price);
    plan.notionalQuote = Number(Number(quoteRes.toAmount).toFixed(8));
    plan.quoteFee = quoteRes.fee ?? null;
    if (plan.notionalQuote < notionalFloor) {
      fail('CONVERT_BELOW_NOTIONAL_FLOOR', `notional ${plan.notionalQuote.toFixed(2)} ${quote} < floor ${notionalFloor} ${quote} (CONVERT_MIN_NOTIONAL_USDT)`);
    }
  }

  if (!confirm) {
    plan.note = 'Add --confirm to submit the conversion. Nothing is sent without it.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // I8: the conversion exists only to make the owner sweep possible, so it is
  // authorised by the same explicit grant as the withdrawal itself.
  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.note = 'Set the CAP_WITHDRAW_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`Executing Bitget ${path} convert...`);
  let orderRef = null;
  try {
    if (path === 'market') {
      const order = await bitget.createMarketSellOrder(symbol, amount);
      orderRef = order?.id ?? null;
    } else {
      // Re-quote immediately before the trade: a stale quote is refused.
      const fresh = await bitget.fetchConvertQuote(base, quote, amount);
      if (!fresh?.id || !(Number(fresh?.toAmount) > 0) || !(Number(fresh?.price) > 0)) {
        plan.status = 'CONVERT_QUOTE_STALE';
        plan.error = 'fresh convert quote came back unusable — nothing submitted';
        console.log(JSON.stringify(plan, null, 2));
        writeArtifact('convert', plan);
        return;
      }
      const trade = await bitget.createConvertTrade(fresh.id, base, quote, amount, {
        price: fresh.price,
        toAmount: fresh.toAmount,
      });
      orderRef = trade?.id ?? fresh.id;
      plan.quoteId = fresh.id;
      plan.lastPrice = Number(fresh.price);
      plan.notionalQuote = Number(Number(fresh.toAmount).toFixed(8));
    }
    plan.orderId = orderRef ? String(orderRef) : null;
  } catch (e) {
    plan.status = 'FAILED';
    plan.error = (e?.message ?? String(e)).slice(0, 300);
    console.log(JSON.stringify(plan, null, 2));
    writeArtifact('convert', plan);
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
    plan.error = `order ${orderRef ?? '(no id)'} returned but ${base} free balance did not decrease — treated as failure`;
  }

  writeArtifact('convert', plan);
  console.log(JSON.stringify(plan, null, 2));
}

/**
 * Bitget's own small-asset convert: the last resort for dust too small to
 * trade on a spot market and too small to withdraw. The listing is read-only;
 * the trade endpoint is only reached with --confirm and the I8 grant.
 */
async function convertDust() {
  const confirm = process.argv.includes('--confirm');
  const onlyCoin = String(arg('coin', '')).trim().toUpperCase() || null;

  requireCreds();
  const bitget = makeClient();
  await bitget.loadTimeDifference();

  let list;
  try {
    list = parseRawAssets(await bitget.privateUtaGetV3ConvertSmallAssets()).map((a) => a.coin);
  } catch (e) {
    fail('CONVERT_DUST_UNREADABLE', `could not list small assets: ${(e?.message ?? String(e)).slice(0, 200)}`);
  }

  const coins = onlyCoin ? list.filter((c) => c === onlyCoin) : list;
  if (coins.length === 0) {
    fail('CONVERT_DUST_EMPTY', onlyCoin ? `${onlyCoin} is not in the convertible small-asset list` : 'no small assets to convert', 1);
  }

  if (!confirm) {
    console.log(JSON.stringify({
      ok: true,
      action: 'convert-dust',
      dryRun: true,
      fundsMoved: false,
      smallAssets: list,
      wouldConvert: coins,
      note: 'Add --confirm to submit each small-asset conversion.',
    }, null, 2));
    return;
  }

  const cap = assertCapability('WITHDRAW_CRYPTO');
  if (!cap.ok) {
    console.log(JSON.stringify({
      ok: false,
      action: 'convert-dust',
      status: 'CAPABILITY_BLOCKED',
      error: cap.error,
      fundsMoved: false,
    }, null, 2));
    return;
  }

  const results = [];
  for (const coin of coins) {
    try {
      const r = await bitget.privateUtaPostV3ConvertSmallAssetsTrade({ coin });
      results.push({ coin, ok: true, info: r?.data ?? null });
    } catch (e) {
      results.push({ coin, ok: false, error: (e?.message ?? String(e)).slice(0, 200) });
    }
  }

  const moved = results.some((r) => r.ok);
  const report = {
    ok: moved,
    action: 'convert-dust',
    at: new Date().toISOString(),
    results,
    fundsMoved: moved,
  };
  writeArtifact('convert-dust', report);
  console.log(JSON.stringify(report, null, 2));
}

function writeArtifact(kind, plan) {
  try {
    const outFile = resolve(OUT, `bitget-${kind}-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(plan, null, 2));
  } catch (e) {
    console.error(`artifact write failed: ${e?.message ?? String(e)}`);
  }
}

/**
 * Every wallet Bitget can hold an asset in. A rail that reads only one of them
 * will report 0 while the UI shows a balance, so the rail refuses to guess:
 * holdings are enumerated across all of them and each balance is attributed to
 * the wallet that actually holds it.
 */
const ACCOUNT_SCOPES = [
  { label: 'spot (classic)', params: { type: 'spot' } },
  { label: 'uta trading', params: { uta: true } },
  { label: 'uta funding', params: { uta: true, type: 'funding' } },
  { label: 'futures USDT-FUTURES', params: { type: 'swap', productType: 'USDT-FUTURES' } },
  { label: 'futures USDC-FUTURES', params: { type: 'swap', productType: 'USDC-FUTURES' } },
  { label: 'futures COIN-FUTURES', params: { type: 'swap', productType: 'COIN-FUTURES' } },
  { label: 'margin crossed', params: { type: 'margin', marginMode: 'cross' } },
  { label: 'margin isolated', params: { type: 'margin', marginMode: 'isolated' } },
  { label: 'earn savings', custom: (ex) => ex.privateEarnGetV2EarnSavingsAssets() },
  { label: 'earn assets', custom: (ex) => ex.privateEarnGetV2EarnAccountAssets() },
];

/** Best-effort extraction of {coin, free, total} rows from an unparsed response. */
function parseRawAssets(payload) {
  const out = [];
  const seen = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (!node || typeof node !== 'object') return;
    const coin = node.coin ?? node.coinName ?? node.currency ?? node.asset;
    if (typeof coin === 'string' && coin) {
      const total = Number(node.total ?? node.totalAmount ?? node.amount ?? node.balance ?? node.available ?? 0);
      const free = Number(node.available ?? node.free ?? node.amount ?? 0);
      const key = `${coin}`;
      if (Number.isFinite(total) && total > 0 && !seen.has(key)) {
        seen.add(key);
        out.push({ coin: coin.toUpperCase(), free: Number.isFinite(free) ? free : 0, total });
      }
      return;
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(payload?.data ?? payload);
  return out;
}

async function fetchScope(exchange, scope) {
  try {
    if (scope.custom) {
      const raw = await scope.custom(exchange);
      return { label: scope.label, ok: true, assets: parseRawAssets(raw) };
    }
    const bal = await exchange.fetchBalance(scope.params);
    const assets = [];
    for (const code of Object.keys(bal?.total ?? {})) {
      const total = Number(bal.total[code] ?? 0);
      if (!(total > 0)) continue;
      assets.push({
        coin: code,
        free: Number(bal.free?.[code] ?? 0),
        used: Number(bal.used?.[code] ?? 0),
        total,
      });
    }
    return { label: scope.label, ok: true, assets };
  } catch (e) {
    // A scope the account does not have is expected; it is reported, not hidden.
    return { label: scope.label, ok: false, error: (e?.message ?? String(e)).slice(0, 200) };
  }
}

/**
 * Comprehensive, read-only inventory: WHERE each balance sits, what form it is
 * in (spot / UTA / funding / futures / margin / earn), what it is worth, and by
 * which route it could actually leave (spot market, Bitget small-asset convert,
 * or a withdrawal network). Nothing here moves funds.
 */
async function holdings() {
  requireCreds();
  const bitget = makeClient();
  await bitget.loadTimeDifference();
  await bitget.loadMarkets();
  const currencies = await bitget.fetchCurrencies();

  const scopes = [];
  for (const scope of ACCOUNT_SCOPES) {
    scopes.push(await fetchScope(bitget, scope));
  }

  // Attach open positions: funds held as margin are not a free balance.
  let positions = [];
  try {
    const raw = await bitget.fetchPositions();
    positions = (raw ?? [])
      .filter((p) => Number(p?.contracts ?? 0) > 0)
      .map((p) => ({ symbol: p.symbol, side: p.side, contracts: p.contracts, notional: p.notional }));
  } catch (e) {
    positions = [{ error: (e?.message ?? String(e)).slice(0, 160) }];
  }

  // Bitget's own small-asset convert: usually the cheapest way out of a dust
  // balance, and only offered for some assets.
  let smallAssets = null;
  try {
    const raw = await bitget.privateUtaGetV3ConvertSmallAssets();
    smallAssets = parseRawAssets(raw).map((a) => a.coin);
  } catch {
    smallAssets = null;
  }

  // Assets Bitget's RFQ convert will accept at all. This is the path that
  // matters for a balance with no spot pair (VND, for instance).
  let convertible = null;
  try {
    const cc = await bitget.fetchConvertCurrencies();
    convertible = new Set(Object.keys(cc ?? {}));
  } catch {
    convertible = null;
  }

  const byCoin = new Map();
  for (const scope of scopes) {
    for (const a of scope.assets ?? []) {
      const entry = byCoin.get(a.coin) ?? { coin: a.coin, totalUnits: 0, locations: [] };
      entry.totalUnits += a.total;
      entry.locations.push({ wallet: scope.label, total: a.total, free: a.free ?? null });
      byCoin.set(a.coin, entry);
    }
  }

  const assets = [];
  for (const entry of byCoin.values()) {
    const { coin } = entry;
    const symbol = `${coin}/USDT`;
    const market = bitget.markets?.[symbol];
    const currency = currencies?.[coin];

    let last = null;
    if (market && market.active !== false) {
      try {
        const t = await bitget.fetchTicker(symbol);
        last = Number(t?.last ?? t?.close ?? 0) || null;
      } catch { last = null; }
    }

    const withdrawals = Object.values(currency?.networks ?? {})
      .filter((n) => n && n.active !== false)
      .map((n) => ({
        network: n.network ?? n.id ?? null,
        withdraw: n.withdraw !== false,
        fee: n.fee ?? null,
        min: n.limits?.withdraw?.min ?? null,
        max: n.limits?.withdraw?.max ?? null,
      }))
      .filter((n) => n.withdraw && n.network);

    assets.push({
      coin,
      totalUnits: Number(entry.totalUnits.toFixed(12)),
      locations: entry.locations,
      spotMarket: market ? symbol : null,
      spotMarketActive: market ? market.active !== false : false,
      lastUsdt: coin === 'USDT' ? 1 : last,
      valueUsdt: coin === 'USDT'
        ? Number(entry.totalUnits.toFixed(6))
        : (last ? Number((entry.totalUnits * last).toFixed(6)) : null),
      smallAssetConvertible: smallAssets === null ? null : smallAssets.includes(coin),
      nativeConvertible: convertible === null ? null : convertible.has(coin),
      withdrawalNetworks: withdrawals,
    });
  }
  assets.sort((a, b) => (b.valueUsdt ?? -1) - (a.valueUsdt ?? -1));

  const report = {
    ok: true,
    at: new Date().toISOString(),
    readOnly: true,
    fundsMoved: false,
    scopes: scopes.map((s) => ({
      label: s.label,
      ok: s.ok,
      ...(s.ok ? { holdings: s.assets } : { error: s.error }),
    })),
    walletsHoldingAssets: scopes.filter((s) => (s.assets ?? []).length > 0).map((s) => s.label),
    openPositions: positions,
    totalsByWallet: Object.fromEntries(
      scopes.map((s) => [s.label, Object.fromEntries((s.assets ?? []).map((a) => [a.coin, a.total]))]),
    ),
    assets,
    answer: assets.length === 0
      ? 'No asset balance found in any Bitget wallet for this API key. Check the key belongs to the account shown in the UI.'
      : `${assets.length} asset(s) held in: ${scopes.filter((s) => (s.assets ?? []).length > 0).map((s) => s.label).join(', ')}.`,
  };

  try {
    const outFile = resolve(OUT, `bitget-holdings-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`artifact write failed: ${e?.message ?? String(e)}`);
  }

  console.log(JSON.stringify(report, null, 2));
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
else if (action === 'holdings') await holdings();
else if (action === 'transfer') await transfer();
else if (action === 'convert') await convert();
else if (action === 'convert-dust') await convertDust();
else if (action === 'withdraw') await withdraw();
else {
  console.error('actions: balance, holdings, networks, routes, transfer, convert, convert-dust, withdraw');
  process.exit(1);
}