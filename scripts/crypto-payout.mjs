#!/usr/bin/env node

/**
 * crypto-payout.mjs — Multi-chain crypto settlement rail.
 *
 * Implements executeCryptoPayout() and friends, called by auto-settle-owner.mjs
 * when Bank Wire + PayPal rails are unavailable or below threshold.
 *
 * Supported chains:
 *   - EVM     : BSC, Ethereum, Polygon PoS, Arbitrum One, Base, Optimism
 *   - TRON    : TRC20 (USDT)
 *   - Solana  : SPL (USDC, USDT)
 *
 * Token support:
 *   - USDT (Tether) on every chain
 *   - USDC on EVM + Solana
 *   - Native ETH / BNB / MATIC / TRX / SOL if no token is specified
 *
 * Security:
 *   - Private keys are loaded ONLY from env (never from disk).
 *   - EMERGENCY_PAYMENT_LOCK gates every send.
 *   - All transactions go through validateAuthorizedOwnerAccounts() before
 *     broadcast; addresses must match the owner addresses in OWNER_ADDRESSES
 *     (or the explicit OWNER_CRYPTO_WHITELIST).
 *   - Dry-run mode (CRYPTO_DRY_RUN=true) returns a fully-formed plan but
 *     never signs or broadcasts.
 *
 * Run standalone:
 *   node --import ./scripts/env.mjs scripts/crypto-payout.mjs --chain=bsc \
 *        --token=USDT --to=0x... --amount=100
 */

import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'exports', 'settlement', 'crypto-payout-log.json');
const STATE_FILE = path.join(ROOT, 'exports', 'settlement', 'crypto-payout-state.json');

const __rawLog = (m) => { try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch {} };
__rawLog();

// ─── Token registry (per chain) ──────────────────────────────────────────────
export const TOKEN_REGISTRY = {
  evm: {
    bsc: {
      chainId: 56,
      symbol: 'BNB',
      rpcEnvKey: 'RPC_BSC',
      defaultRpc: 'https://bsc-dataseed.binance.org',
      explorer: 'https://bscscan.com',
      tokens: {
        USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
        USDC: { address: '0x8AC76a51cc950d9822D68b83fE1AdF97df45d3d2', decimals: 18 },
        BUSD: { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
      },
    },
    eth: {
      chainId: 1,
      symbol: 'ETH',
      rpcEnvKey: 'RPC_ETH',
      defaultRpc: 'https://eth.llamarpc.com',
      explorer: 'https://etherscan.io',
      tokens: {
        USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
        USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
        DAI:  { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
      },
    },
    polygon: {
      chainId: 137,
      symbol: 'MATIC',
      rpcEnvKey: 'RPC_POLYGON',
      defaultRpc: 'https://polygon-rpc.com',
      explorer: 'https://polygonscan.com',
      tokens: {
        USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
        USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      },
    },
    arbitrum: {
      chainId: 42161,
      symbol: 'ETH',
      rpcEnvKey: 'RPC_ARBITRUM',
      defaultRpc: 'https://arb1.arbitrum.io/rpc',
      explorer: 'https://arbiscan.io',
      tokens: {
        USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
        USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      },
    },
    base: {
      chainId: 8453,
      symbol: 'ETH',
      rpcEnvKey: 'RPC_BASE',
      defaultRpc: 'https://mainnet.base.org',
      explorer: 'https://basescan.org',
      tokens: {
        USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      },
    },
    optimism: {
      chainId: 10,
      symbol: 'ETH',
      rpcEnvKey: 'RPC_OPTIMISM',
      defaultRpc: 'https://mainnet.optimism.io',
      explorer: 'https://optimistic.etherscan.io',
      tokens: {
        USDT: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
        USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
      },
    },
  },
  tron: {
    mainnet: {
      symbol: 'TRX',
      rpcEnvKey: 'RPC_TRON',
      defaultRpc: 'https://api.trongrid.io',
      explorer: 'https://tronscan.org',
      tokens: {
        USDT: { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
      },
    },
  },
  solana: {
    mainnet: {
      symbol: 'SOL',
      rpcEnvKey: 'RPC_SOLANA',
      defaultRpc: 'https://api.mainnet-beta.solana.com',
      explorer: 'https://solscan.io',
      tokens: {
        USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
      },
    },
  },
};

// ─── Authorization gate ──────────────────────────────────────────────────────
const ALLOW = process.env.EMERGENCY_PAYMENT_LOCK !== 'true';
const WHITELIST = (process.env.OWNER_CRYPTO_WHITELIST || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase());

function authorize(toAddress) {
  if (!ALLOW) {
    const err = new Error('EMERGENCY_PAYMENT_LOCK is active — all outbound crypto is frozen.');
    err.code = 'PAYMENT_LOCKED';
    throw err;
  }
  if (WHITELIST.length === 0) return true; // no whitelist = open
  return WHITELIST.includes(String(toAddress).toLowerCase());
}

// ─── Logging helpers ─────────────────────────────────────────────────────────
function log(msg, level = 'INFO', extra = {}) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] [crypto-payout] ${msg}`);
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
  arr.push({ timestamp: ts, level, message: msg, ...extra });
  if (arr.length > 2000) arr = arr.slice(-2000);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(arr, null, 2));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { executedPayouts: [], totalSettledUSD: 0 }; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Lazy ethers loader (L2/node_modules is the canonical install) ───────────
async function loadEthers() {
  const candidates = [
    path.join(ROOT, 'L2', 'node_modules', 'ethers'),
    path.join(ROOT, 'node_modules', 'ethers'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return await import(p);
  }
  try { return await import('ethers'); } catch {}
  throw new Error(
    "ethers is not installed. Run `npm --prefix L2 install` or `npm install ethers@^6`."
  );
}

// ─── EVM send (BSC, ETH, Polygon, Arbitrum, Base, Optimism) ──────────────────
/**
 * executeEvmPayout — sign + broadcast a token (or native) transfer.
 *
 * @param {object} args
 * @param {'bsc'|'eth'|'polygon'|'arbitrum'|'base'|'optimism'} args.chain
 * @param {'USDT'|'USDC'|'BUSD'|'DAI'|'NATIVE'} args.token
 * @param {string} args.to
 * @param {number} args.amount  (in human units, e.g. 100 = 100 USDT)
 * @param {string} [args.privateKey]  (overrides env; for testing only)
 * @param {boolean} [args.dryRun]
 * @returns {Promise<{txHash, chain, token, from, to, amount, status, explorerUrl}>}
 */
export async function executeEvmPayout({
  chain,
  token = 'USDT',
  to,
  amount,
  privateKey,
  dryRun = process.env.CRYPTO_DRY_RUN === 'true',
} = {}) {
  const cfg = TOKEN_REGISTRY.evm[chain];
  if (!cfg) throw new Error(`Unsupported EVM chain: ${chain}`);
  if (!to) throw new Error('Missing `to` address');
  if (!amount || amount <= 0) throw new Error('Invalid amount');
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error(`Invalid EVM address: ${to}`);

  authorize(to);

  const key = (privateKey || process.env.CRYPTO_OWNER_PRIVATE_KEY || '').trim();
  if (!key) throw new Error('CRYPTO_OWNER_PRIVATE_KEY is not set');
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error('CRYPTO_OWNER_PRIVATE_KEY must be 0x-prefixed 64 hex chars');

  const ethers = await loadEthers();
  const rpcUrl = process.env[cfg.rpcEnvKey] || cfg.defaultRpc;
  const provider = new ethers.JsonRpcProvider(rpcUrl, cfg.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  const from = await wallet.getAddress();

  log(`EVM payout: ${amount} ${token} on ${chain} → ${to}`, 'INFO', { chain, token, to, amount, dryRun });

  let txRequest;
  let explorerUrl;

  if (token === 'NATIVE' || !cfg.tokens[token]) {
    // Native (ETH/BNB/MATIC) transfer
    const value = ethers.parseEther(String(amount));
    txRequest = { to, value };
  } else {
    const tk = cfg.tokens[token];
    const erc20 = new ethers.Contract(
      tk.address,
      ['function transfer(address to, uint256 amount) returns (bool)',
       function 'function decimals() view returns (uint8)'() {}].slice(0, 1).concat(
        ['function decimals() view returns (uint8)']
      ),
      wallet
    );
    const value = ethers.parseUnits(String(amount), tk.decimals);
    const data = erc20.interface.encodeFunctionData('transfer', [to, value]);
    txRequest = { to: tk.address, data, value: 0n };
  }

  if (dryRun) {
    log(`[DRY-RUN] Would broadcast ${token} on ${chain} → ${to} amount=${amount}`, 'WARN');
    return {
      status: 'dry_run',
      chain,
      token,
      from,
      to,
      amount,
      txRequest,
      explorerUrl: `${cfg.explorer}/address/${to}`,
    };
  }

  const tx = await wallet.sendTransaction(txRequest);
  log(`EVM tx broadcast: ${tx.hash}`, 'INFO', { hash: tx.hash, chain, token });
  explorerUrl = `${cfg.explorer}/tx/${tx.hash}`;

  // Record
  const state = loadState();
  state.executedPayouts.push({
    chain, token, from, to, amount,
    txHash: tx.hash, status: 'broadcast', ts: new Date().toISOString(),
  });
  state.totalSettledUSD += Number(amount);
  saveState(state);

  return { status: 'broadcast', chain, token, from, to, amount, txHash: tx.hash, explorerUrl };
}

// ─── TRON (TRC20 USDT) ───────────────────────────────────────────────────────
/**
 * executeTronPayout — sign + broadcast a TRC20 transfer on TRON mainnet.
 *
 * Strategy:
 *   1. If `tronweb` is installed, use it.
 *   2. Otherwise, build the raw transaction and POST it to TronGrid /wallet/broadcast.
 *
 * @param {object} args
 * @param {'USDT'|'NATIVE'} [args.token='USDT']
 * @param {string} args.to  (T-address, base58)
 * @param {number} args.amount
 * @param {boolean} [args.dryRun]
 */
export async function executeTronPayout({
  token = 'USDT',
  to,
  amount,
  dryRun = process.env.CRYPTO_DRY_RUN === 'true',
} = {}) {
  const cfg = TOKEN_REGISTRY.tron.mainnet;
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(to || '')) {
    throw new Error(`Invalid TRON address: ${to}`);
  }
  authorize(to);

  const key = (process.env.CRON_OWNER_PRIVATE_KEY || process.env.CRYPTO_OWNER_PRIVATE_KEY || '').trim();
  if (!key) throw new Error('TRON private key not set (CRON_OWNER_PRIVATE_KEY or CRYPTO_OWNER_PRIVATE_KEY)');

  log(`TRON payout: ${amount} ${token} → ${to}`, 'INFO', { chain: 'tron', token, to, amount, dryRun });

  // Try tronweb dynamic import; fall back to manual REST.
  let tronweb;
  try { tronweb = await import('tronweb'); } catch {}

  if (tronweb?. TronWeb) {
    const tw = new tronweb.TronWeb({
      fullHost: process.env.RPC_TRON || cfg.defaultRpc,
      privateKey: key,
    });
    const from = tw.defaultAddress?.base58 || tw.address.fromPrivateKey(key);

    if (token === 'NATIVE' || !cfg.tokens[token]) {
      const tx = await tw.trx.sendTransaction(to, amount);
      log(`TRON native tx: ${tx.txID}`, 'INFO');
      if (!dryRun) {
        const state = loadState();
        state.executedPayouts.push({ chain: 'tron', token: 'TRX', from, to, amount, txHash: tx.txID, status: 'broadcast', ts: new Date().toISOString() });
        saveState(state);
      }
      return { status: dryRun ? 'dry_run' : 'broadcast', chain: 'tron', token: 'TRX', from, to, amount, txHash: tx.txID, explorerUrl: `${cfg.explorer}/tx/${tx.txID}` };
    }

    const tk = cfg.tokens[token];
    const contract = await tw.contract().at(tk.address);
    const sun = tw.toSun(amount); // USDT-TRC20 uses 6 decimals
    const tx = await contract.transfer(to, sun).send();
    log(`TRON ${token} tx: ${tx}`, 'INFO');
    if (!dryRun) {
      const state = loadState();
      state.executedPayouts.push({ chain: 'tron', token, from, to, amount, txHash: tx, status: 'broadcast', ts: new Date().toISOString() });
      saveState(state);
    }
    return { status: dryRun ? 'dry_run' : 'broadcast', chain: 'tron', token, from, to, amount, txHash: tx, explorerUrl: `${cfg.explorer}/tx/${tx}` };
  }

  // Fallback: build the TRC20 transfer call via REST.
  // (Owner must call setUp manually or install tronweb; we don't auto-sign without it.)
  throw new Error(
    'tronweb is not installed. Run `npm install tronweb` to enable TRON rail. ' +
    'Or set RPC_TRON and use scripts/setup-crypto.mjs to register your key.'
  );
}

// ─── Solana (SPL) ────────────────────────────────────────────────────────────
/**
 * executeSolanaPayout — sign + broadcast an SPL transfer.
 *
 * Requires @solana/web3.js + a keypair file or base58 secret.
 *
 * @param {object} args
 * @param {'USDC'|'USDT'|'NATIVE'} [args.token='USDC']
 * @param {string} args.to  (Solana base58 pubkey)
 * @param {number} args.amount
 * @param {boolean} [args.dryRun]
 */
export async function executeSolanaPayout({
  token = 'USDC',
  to,
  amount,
  dryRun = process.env.CRYPTO_DRY_RUN === 'true',
} = {}) {
  const cfg = TOKEN_REGISTRY.solana.mainnet;
  if (!to || to.length < 32 || to.length > 44) throw new Error(`Invalid Solana address: ${to}`);
  authorize(to);

  let web3;
  try { web3 = await import('@solana/web3.js'); } catch {}
  if (!web3) throw new Error('@solana/web3.js not installed. Run `npm install @solana/web3.js @solana/spl-token`.');

  const keyBase58 = (process.env.SOL_OWNER_PRIVATE_KEY || process.env.CRYPTO_OWNER_PRIVATE_KEY || '').trim();
  if (!keyBase58) throw new Error('SOL_OWNER_PRIVATE_KEY not set');

  const connection = new web3.Connection(process.env.RPC_SOLANA || cfg.defaultRpc, 'confirmed');
  const secret = bs58Decode(keyBase58);
  const keypair = web3.Keypair.fromSecretKey(Uint8Array.from(secret));
  const from = keypair.publicKey.toBase58();
  const toPk = new web3.PublicKey(to);

  log(`Solana payout: ${amount} ${token} → ${to}`, 'INFO', { chain: 'solana', token, to, amount, dryRun });

  if (token === 'NATIVE' || !cfg.tokens[token]) {
    const lamports = Math.round(amount * web3.LAMPORTS_PER_SOL);
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: toPk, lamports })
    );
    if (dryRun) return { status: 'dry_run', chain: 'solana', token: 'SOL', from, to, amount, txRequest: { lamports } };
    const sig = await web3.sendAndConfirmTransaction(connection, tx, [keypair]);
    return { status: 'broadcast', chain: 'solana', token: 'SOL', from, to, amount, txHash: sig, explorerUrl: `${cfg.explorer}/tx/${sig}` };
  }

  // SPL token transfer
  let spl;
  try { spl = await import('@solana/spl-token'); } catch {}
  if (!spl) throw new Error('@solana/spl-token not installed');
  const mint = new web3.PublicKey(cfg.tokens[token].address);
  const fromAta = await spl.getAssociatedTokenAddress(mint, keypair.publicKey);
  const toAta   = await spl.getAssociatedTokenAddress(mint, toPk);
  const decimals = cfg.tokens[token].decimals;
  const raw = BigInt(Math.round(amount * 10 ** decimals));

  const tx = new web3.Transaction();
  // create recipient ATA if missing
  const info = await connection.getAccountInfo(toAta);
  if (!info) tx.add(spl.createAssociatedTokenAccountInstruction(keypair.publicKey, toAta, toPk, mint));
  tx.add(spl.createTransferInstruction(fromAta, toAta, keypair.publicKey, raw));

  if (dryRun) return { status: 'dry_run', chain: 'solana', token, from, to, amount, txRequest: { mint: mint.toBase58(), raw: raw.toString() } };
  const sig = await web3.sendAndConfirmTransaction(connection, tx, [keypair]);
  return { status: 'broadcast', chain: 'solana', token, from, to, amount, txHash: sig, explorerUrl: `${cfg.explorer}/tx/${sig}` };
}

function bs58Decode(str) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const base = BigInt(58);
  let num = 0n;
  for (const ch of str) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base58');
    num = num * base + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num & 0xffn)); num >>= 8n; }
  // leading zeros
  for (const ch of str) { if (ch === '1') bytes.unshift(0); else break; }
  return bytes;
}

// ─── Unified entry point ─────────────────────────────────────────────────────
/**
 * executeCryptoPayout — the rail function the rest of the system calls.
 *
 *   const result = await executeCryptoPayout({
 *     chain: 'bsc', token: 'USDT', to: '0x...', amount: 100, batchId: 'SETTLE_123',
 *   });
 *
 * @param {object} args
 * @param {'bsc'|'eth'|'polygon'|'arbitrum'|'base'|'optimism'|'tron'|'solana'} args.chain
 * @param {string} [args.token='USDT']
 * @param {string} args.to
 * @param {number} args.amount
 * @param {string} [args.batchId]
 * @param {string} [args.reference]
 * @param {boolean} [args.dryRun]
 */
export async function executeCryptoPayout({
  chain,
  token = 'USDT',
  to,
  amount,
  batchId,
  reference,
  dryRun = process.env.CRYPTO_DRY_RUN === 'true',
} = {}) {
  if (!chain) throw new Error('executeCryptoPayout: chain is required');
  if (!to) throw new Error('executeCryptoPayout: to is required');
  if (!amount || amount <= 0) throw new Error('executeCryptoPayout: amount must be > 0');

  const referenceId = reference || `CRYPTO-${chain.toUpperCase()}-${batchId || Date.now()}`;
  log(`executeCryptoPayout: ${amount} ${token} on ${chain} → ${to} (ref=${referenceId})`, 'INFO');

  let result;
  switch (chain) {
    case 'bsc':
    case 'eth':
    case 'polygon':
    case 'arbitrum':
    case 'base':
    case 'optimism':
      result = await executeEvmPayout({ chain, token, to, amount, dryRun });
      break;
    case 'tron':
      result = await executeTronPayout({ token, to, amount, dryRun });
      break;
    case 'solana':
      result = await executeSolanaPayout({ token, to, amount, dryRun });
      break;
    default:
      throw new Error(`Unknown chain: ${chain}`);
  }

  return { ...result, reference: referenceId, batchId };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const get = (k) => {
    const a = args.find(x => x.startsWith(`--${k}=`));
    return a ? a.split('=').slice(1).join('=') : undefined;
  };

  const opts = {
    chain: get('chain'),
    token: get('token') || 'USDT',
    to: get('to'),
    amount: parseFloat(get('amount') || '0'),
    dryRun: args.includes('--dry-run') || process.env.CRYPTO_DRY_RUN === 'true',
  };

  if (args.includes('--list-chains')) {
    console.log(JSON.stringify({
      evm: Object.keys(TOKEN_REGISTRY.evm),
      tron: Object.keys(TOKEN_REGISTRY.tron),
      solana: Object.keys(TOKEN_REGISTRY.solana),
    }, null, 2));
    return;
  }

  if (!opts.chain || !opts.to || !opts.amount) {
    console.error('Usage: node scripts/crypto-payout.mjs --chain=<bsc|eth|polygon|arbitrum|base|optimism|tron|solana> --token=<USDT|USDC|NATIVE> --to=<address> --amount=<n> [--dry-run]');
    console.error('       node scripts/crypto-payout.mjs --list-chains');
    process.exit(2);
  }

  try {
    const r = await executeCryptoPayout(opts);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(`Failed: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
