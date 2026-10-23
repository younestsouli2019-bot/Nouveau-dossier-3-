#!/usr/bin/env node
/**
 * evm-wallet-rail.mjs  (AUTONOMOUS · PROGRAMMATIC · non-custodial)
 *
 * Direct programmatic control of the Trust Wallet EVM address across
 * L2s and sidechains — bypasses all centralized exchanges. Uses ethers.js
 * v6 to sign and send transactions directly from the private key.
 *
 * Supported chains: Base, Arbitrum, Optimism, Polygon, BSC, Ethereum, Scroll, Linea
 * Supported tokens: Native ETH/BNB/MATIC + USDT (ERC20/BEP20)
 *
 *   node scripts/evm-wallet-rail.mjs --action balance
 *   node scripts/evm-wallet-rail.mjs --action routes
 *   node scripts/evm-wallet-rail.mjs --action send --chain bsc --token USDT --amount 3.70
 *   node scripts/evm-wallet-rail.mjs --action send --chain bsc --route evm-usdt-bep20 --amount 3.70 --confirm
 *
 * The destination is NEVER taken from a constant or from the caller: it is
 * resolved from the owner route registry declared in config/crypto-addresses.json
 * (scripts/lib/owner-routes.mjs). An unknown, ambiguous, unverified or
 * address-less route is refused. --to, when supplied, is only cross-checked.
 *
 * Fail-closed: never sends without --action send, never fabricates tx hashes.
 * I8: even with --confirm, a CAP_SEND_CRYPTO capability grant is required before any send.
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { assertCapability } from '../src/finance/capabilities.mjs';
import { loadRoutes, resolveRoute, listRoutes, fold } from './lib/owner-routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── Chain registry ───────────────────────────────────────────────────────
const CHAINS = {
  base: {
    name: 'Base',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://basescan.org',
    usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://arbiscan.io',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    rpc: 'https://mainnet.optimism.io',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://optimistic.etherscan.io',
    usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  polygon: {
    name: 'Polygon PoS',
    chainId: 137,
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    nativeSymbol: 'MATIC',
    nativeDecimals: 18,
    explorer: 'https://polygonscan.com',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    usdtDecimals: 6,
    gasMultiplier: 1.5,
  },
  bsc: {
    name: 'BNB Smart Chain',
    chainId: 56,
    rpc: 'https://bsc-dataseed.binance.org',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    explorer: 'https://bscscan.com',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
    usdtDecimals: 18,
    gasMultiplier: 1.3,
  },
  ethereum: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://etherscan.io',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    usdtDecimals: 6,
    gasMultiplier: 1.5,
  },
  scroll: {
    name: 'Scroll',
    chainId: 534352,
    rpc: 'https://rpc.scroll.io',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://scrollscan.com',
    usdt: null,
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  linea: {
    name: 'Linea',
    chainId: 59144,
    rpc: 'https://rpc.linea.build',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://lineascan.build',
    usdt: null,
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
};

// ── ERC20 ABI (balanceOf + transfer + decimals) ──────────────────────────
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// Which registry network name (config/crypto-addresses.json routes[].network)
// each chain key answers to. A destination is never taken from a constant:
// it is resolved from the owner route registry, so this map only says what to
// look up.
const CHAIN_NETWORK = {
  base: 'BASE',
  arbitrum: 'ARBITRUM',
  optimism: 'OPTIMISM',
  polygon: 'POLYGON',
  bsc: 'BEP20',
  ethereum: 'ERC20',
  scroll: 'SCROLL',
  linea: 'LINEA',
};

// ── Helpers ──────────────────────────────────────────────────────────────
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const PK = process.env.TRUST_WALLET_PRIVATE_KEY;
const ADDR = process.env.TRUST_WALLET_ADDRESS;

if (!PK) { console.error('TRUST_WALLET_PRIVATE_KEY not set'); process.exit(2); }

/** Fail-closed verdict: print and stop without touching the chain. */
function refuse(code, error) {
  console.log(JSON.stringify({ ok: false, code, error, fundsMoved: false }, null, 2));
}

// ── Actions ──────────────────────────────────────────────────────────────
async function checkBalances() {
  const balances = {};
  for (const [key, chain] of Object.entries(CHAINS)) {
    try {
      const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
      const wallet = new ethers.Wallet(PK, provider);
      const native = await provider.getBalance(ADDR);
      let usdtBal = 0n;
      if (chain.usdt) {
        const contract = new ethers.Contract(chain.usdt, ERC20_ABI, provider);
        usdtBal = await contract.balanceOf(ADDR);
      }
      const nativeFormatted = Number(ethers.formatUnits(native, chain.nativeDecimals));
      const usdtFormatted = Number(ethers.formatUnits(usdtBal, chain.usdtDecimals));
      balances[key] = {
        chain: chain.name,
        native: nativeFormatted,
        nativeSymbol: chain.nativeSymbol,
        usdt: usdtFormatted,
        totalUsd: usdtFormatted, // native price ignored for simplicity
        canSendUsdt: usdtFormatted > 0,
        canSendNative: nativeFormatted > 0,
        hasGas: nativeFormatted > 0,
      };
      if (usdtFormatted > 0 || nativeFormatted > 0) {
        console.log(`${chain.name}: ${chain.nativeSymbol}=${nativeFormatted.toFixed(6)} | USDT=${usdtFormatted.toFixed(2)} | can_send=${usdtFormatted > 0}`);
      }
    } catch (e) {
      balances[key] = { chain: chain.name, error: e.message.slice(0, 100) };
    }
  }
  const totalUsdt = Object.values(balances).reduce((a, b) => a + (b.usdt || 0), 0);
  const chainsWithFunds = Object.entries(balances).filter(([, b]) => (b.usdt || 0) > 0 || (b.native || 0) > 0);
  const chainsWithGas = Object.entries(balances).filter(([, b]) => b.hasGas);
  console.log(JSON.stringify({ totalUsdt, chainsWithFunds: chainsWithFunds.length, chainsWithGas: chainsWithGas.length, balances }, null, 2));
  return balances;
}

async function sendTransaction() {
  const chainKey = String(arg('chain', '')).trim().toLowerCase();
  const routeId = arg('route', undefined);
  const amount = Number(arg('amount', '0'));
  const toArg = arg('to', '');

  if (!chainKey || !CHAINS[chainKey]) {
    console.error('Valid chains: ' + Object.keys(CHAINS).join(', '));
    process.exit(1);
  }
  if (!(amount > 0)) { console.error('--amount required (>0)'); process.exit(1); }

  const chain = CHAINS[chainKey];
  const network = CHAIN_NETWORK[chainKey];
  const asset = String(arg('token', chain.nativeSymbol)).trim().toUpperCase();

  // Destination resolution comes first: no provider, no key use, no signature
  // until a verified owner route has been resolved from the registry.
  let registry;
  try {
    registry = loadRoutes();
  } catch (e) {
    refuse('ROUTE_REGISTRY_UNREADABLE', e?.message ?? String(e));
    return;
  }

  const resolved = routeId
    ? resolveRoute(registry, { id: routeId })
    : resolveRoute(registry, { rail: 'evm', asset, network });
  if (!resolved.ok) {
    refuse(resolved.code, `${resolved.error} | available routes: ${listRoutes(registry).map((r) => r.id).join(', ')}`);
    return;
  }

  const route = resolved.route;
  if (route.network !== network) {
    refuse('ROUTE_NETWORK_MISMATCH', `route "${route.id}" is on ${route.network}, not ${network} (chain ${chainKey})`);
    return;
  }
  // A destination passed by the caller must BE the registered one.
  if (toArg && fold(toArg) !== fold(route.address)) {
    refuse('ROUTE_ADDRESS_MISMATCH', `--to is not the registered address of route "${route.id}"`);
    return;
  }

  const token = route.asset;
  const isNative = token === chain.nativeSymbol;
  const isUsdt = token === 'USDT' && !!chain.usdt;
  if (!isNative && !isUsdt) {
    refuse('TOKEN_UNSUPPORTED', `route "${route.id}" pays ${token}, which this rail does not know on ${chain.name}`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(PK, provider);
  const to = route.address;

  const plan = {
    at: new Date().toISOString(),
    chain: chain.name,
    network,
    routeId: route.id,
    token,
    amount,
    to,
    from: wallet.address,
    gasMultiplier: chain.gasMultiplier,
    dryRun: !flag('confirm'),
    status: 'DRY_RUN',
    fundsMoved: false,
  };

  if (!flag('confirm')) {
    plan.note = 'Add --confirm to actually send. This is a dry run.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // I8: explicit capability grant required for actual money movement.
  const cap = assertCapability('SEND_CRYPTO');
  if (!cap.ok) {
    plan.status = 'CAPABILITY_BLOCKED';
    plan.error = cap.error;
    plan.note = 'Set the CAP_SEND_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.';
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  let tx;
  try {
    if (isNative) {
      // Native token transfer (chain gas is paid from the same balance).
      const value = ethers.parseUnits(String(amount), chain.nativeDecimals);
      tx = await wallet.sendTransaction({ to, value });
    } else {
      const contract = new ethers.Contract(chain.usdt, ERC20_ABI, wallet);
      const decimals = await contract.decimals();
      const value = ethers.parseUnits(String(amount), decimals);
      tx = await contract.transfer(to, value);
    }
    plan.txHash = tx.hash;
    plan.explorer = chain.explorer + '/tx/' + tx.hash;
  } catch (e) {
    plan.status = 'FAILED';
    plan.error = (e?.message ?? String(e)).slice(0, 300);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log('TX_SENT: ' + tx.hash);
  console.log('EXPLORER: ' + chain.explorer + '/tx/' + tx.hash);

  try {
    const receipt = await tx.wait();
    plan.status = 'CONFIRMED';
    plan.fundsMoved = true;
    plan.blockNumber = receipt.blockNumber;
    plan.gasUsed = receipt.gasUsed.toString();
    console.log('CONFIRMED in block ' + receipt.blockNumber + ' gasUsed=' + receipt.gasUsed.toString());
  } catch (e) {
    // Broadcast but unconfirmed: report honestly, never claim success.
    plan.status = 'UNCONFIRMED';
    plan.error = (e?.message ?? String(e)).slice(0, 200);
  }

  writeFileSync(resolve(OUT, 'evm-tx-' + tx.hash.slice(0, 10) + '.json'), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
}

/** Operator inventory of every declared route and whether it is armed. */
function checkRoutes() {
  let registry;
  try {
    registry = loadRoutes();
  } catch (e) {
    refuse('ROUTE_REGISTRY_UNREADABLE', e?.message ?? String(e));
    return;
  }
  const routes = listRoutes(registry).filter((r) => !r.rail || r.rail === 'evm');
  console.log(JSON.stringify({
    ok: true,
    verifiedAt: registry.verifiedAt,
    chains: Object.fromEntries(Object.entries(CHAIN_NETWORK).map(([k, v]) => [v, k])),
    routes,
  }, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────
const action = arg('action', 'balance');
if (action === 'balance') await checkBalances();
else if (action === 'routes') checkRoutes();
else if (action === 'send') await sendTransaction();
else { console.error('actions: balance, routes, send'); process.exit(1); }
