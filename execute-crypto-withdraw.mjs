#!/usr/bin/env node
/**
 * scripts/execute-crypto-withdraw.mjs — ChariBaaS Owner Crypto Withdraw
 *
 * Used by .github/workflows/owner-crypto-withdraw.yml (workflow_dispatch).
 *
 * IMPORTANT — SAFE-BY-DEFAULT BEHAVIOR:
 *   This script is OBSERVE-ONLY by default. It does NOT move funds.
 *   Real on-chain transfers require:
 *     (a) the optional npm deps `ccxt` + `ethers` + `dotenv` to be installed,
 *     (b) signed exchange API secrets / wallet private keys in env,
 *     (c) CRYPTO_MODE=live to override the default observe mode.
 *   Until all three are present, this script emits a deferred-status JSON
 *   and exits 0 so the workflow's "Execute withdraw" step succeeds while
 *   no funds move.
 *
 * Self-contained: no required external npm deps. If `ccxt`/`ethers` are
 * installed, real withdraw logic can be added later.
 *
 * CLI:
 *   node scripts/execute-crypto-withdraw.mjs --amount 50 [--network BEP20] [--address 0x...]
 *
 * Output: a single JSON object on stdout (captured by workflow to out.json).
 *
 * Exit codes:
 *   0 = success (either deferred observe-only, or real withdraw confirmed)
 *   1 = invalid input or environmental error (NOT a withdraw failure)
 *   2 = real withdraw attempted but failed (funds may or may not have moved;
 *       see `txHash` field)
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_NETWORK = 'BEP20';
const DEFAULT_ADDRESS = '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7';

function parseArgs(argv) {
  const out = { amount: null, network: null, address: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--amount')      out.amount   = Number(argv[++i]);
    else if (a === '--network') out.network = String(argv[++i]);
    else if (a === '--address') out.address = String(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.error('Usage: execute-crypto-withdraw.mjs --amount <USDT> [--network BEP20|ERC20|TRON] [--address 0x...]');
      process.exit(0);
    }
  }
  return out;
}

function loadEnv() {
  // Allow .env file if present (graceful no-op if not)
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (!m) continue;
        const [, k, v] = m;
        if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* ignore */ }

  return {
    network: process.env.CRYPTO_NETWORK || DEFAULT_NETWORK,
    address:
      process.env.TRUST_WALLET_ADDRESS ||
      process.env.TRUST_WALLET_USDT_BEP20 ||
      process.env.TRUST_WALLET_USDT_ERC20 ||
      DEFAULT_ADDRESS,
    mode: (process.env.CRYPTO_MODE || 'observe').toLowerCase(),
    binanceApiKey: process.env.BINANCE_API_KEY || '',
    binanceApiSecret: process.env.BINANCE_API_SECRET || '',
    walletPrivateKey:
      process.env.BNB_CHAIN_PRIVATE_KEY || process.env.TRUST_WALLET_PRIVATE_KEY || '',
  };
}

function emit(obj) {
  // Single JSON line on stdout — captured by workflow `> out.json`
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv();

  const network = args.network || env.network;
  const address = args.address || env.address;
  const amount = args.amount;

  if (!amount || !isFinite(amount) || amount <= 0) {
    emit({
      ok: false,
      status: 'invalid_input',
      error: 'Missing or invalid --amount (must be a positive number)',
      amount,
    });
    process.exit(1);
  }

  // ---- OBSERVE-ONLY DEFAULT ----
  // Until CRYPTO_MODE=live AND secrets are present AND ccxt/ethers are
  // installed, we refuse to move funds. This is the safe default.
  const ready =
    env.mode === 'live' &&
    (
      (env.binanceApiKey && env.binanceApiSecret) ||
      env.walletPrivateKey
    );

  if (!ready) {
    emit({
      ok: true,
      status: 'deferred_observe_only',
      reason:
        'OBSERVE-ONLY: real withdraw requires CRYPTO_MODE=live + signed secrets + ccxt/ethers deps. ' +
        'No funds were moved.',
      requested: { amount, currency: 'USDT', network, address },
      env: {
        mode: env.mode,
        has_binance_api_key: !!env.binanceApiKey,
        has_binance_api_secret: !!env.binanceApiSecret,
        has_wallet_private_key: !!env.walletPrivateKey,
        has_ccxt: (() => { try { require.resolve('ccxt'); return true; } catch { return false; } })(),
        has_ethers: (() => { try { require.resolve('ethers'); return true; } catch { return false; } })(),
      },
      timestamp: new Date().toISOString(),
    });
    process.exit(0);
  }

  // ---- LIVE MODE (NOT IMPLEMENTED IN THIS SAFE STUB) ----
  // When you are ready to wire live withdrawals, import ccxt/ethers here
  // and delegate to Nouveau dossier (3)/scripts/execute-crypto-settlement.mjs
  // (which already has the on-chain + exchange logic). Until then, refuse.
  emit({
    ok: false,
    status: 'live_mode_not_implemented_in_stub',
    reason:
      'Live mode prerequisites detected, but this safe stub does not perform real transfers. ' +
      'Delegate to Nouveau dossier (3)/scripts/execute-crypto-settlement.mjs for live execution.',
    requested: { amount, currency: 'USDT', network, address },
    timestamp: new Date().toISOString(),
  });
  process.exit(2);
}

main().catch((err) => {
  emit({ ok: false, status: 'unexpected_error', error: err.message, stack: err.stack });
  process.exit(1);
});
