#!/usr/bin/env node

/**
 * setup:crypto — autonomous crypto-rail credential self-setup.
 *
 * Mirrors scripts/setup-wise.mjs. For each chain the user wants to enable,
 *  1. Verifies the env (RPC + key) is set.
 *  2. Connects to the RPC, prints the chain id, and tests the connection.
 *  3. Derives the owner address from the private key (EVM) or from
 *     the configured pubkey (TRON/Solana).
 *  4. Persists a `crypto-setup.json` snapshot.
 *
 * Usage:
 *   node --import ./scripts/env.mjs scripts/setup-crypto.mjs                  # all chains
 *   node --import ./scripts/env.mjs scripts/setup-crypto.mjs --chain=bsc     # single chain
 *   node --import ./scripts/env.mjs scripts/setup-crypto.mjs --dry-run
 */

import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { TOKEN_REGISTRY, executeCryptoPayout } from './crypto-payout.mjs';

const ROOT = path.resolve(process.cwd());
const ENV_FILE = path.join(ROOT, '.env');
const SETUP_FILE = path.join(ROOT, 'dist_rwc', 'crypto-setup.json');

function info(m) { console.log(`[setup] ${m}`); }
function warn(m) { console.warn(`[setup][warn] ${m}`); }
function fail(m, code = 1) { console.error(`\n=== SETUP FAILED ===\n${m}\n`); process.exit(code); }

function getArg(name) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
}

const chainFilter = getArg('chain');
const dryRun = process.argv.includes('--dry-run') || process.env.CRYPTO_DRY_RUN === 'true';

const chains = [];
if (!chainFilter || chainFilter === 'evm') {
  for (const k of Object.keys(TOKEN_REGISTRY.evm)) chains.push({ family: 'evm', key: k, cfg: TOKEN_REGISTRY.evm[k] });
}
if (!chainFilter || chainFilter === 'tron') {
  for (const k of Object.keys(TOKEN_REGISTRY.tron)) chains.push({ family: 'tron', key: k, cfg: TOKEN_REGISTRY.tron[k] });
}
if (!chainFilter || chainFilter === 'solana') {
  for (const k of Object.keys(TOKEN_REGISTRY.solana)) chains.push({ family: 'solana', key: k, cfg: TOKEN_REGISTRY.solana[k] });
}

const report = { ts: new Date().toISOString(), dryRun, chains: {} };

async function setupEvm(key, cfg) {
  const rpc = process.env[cfg.rpcEnvKey] || cfg.defaultRpc;
  const pk = (process.env.CRYPTO_OWNER_PRIVATE_KEY || '').trim();
  const out = { chain: key, chainId: cfg.chainId, rpc, envOk: false, ownerAddress: null };
  if (!pk) { out.error = 'CRYPTO_OWNER_PRIVATE_KEY not set'; return out; }
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) { out.error = 'CRYPTO_OWNER_PRIVATE_KEY must be 0x-prefixed 64 hex chars'; return out; }

  out.envOk = true;
  try {
    const ethers = await import('ethers').catch(() => null)
                || await import(path.join(ROOT, 'L2', 'node_modules', 'ethers')).catch(() => null)
                || await import('ethers');
    const provider = new ethers.JsonRpcProvider(rpc, cfg.chainId, { staticNetwork: true });
    const net = await provider.getNetwork();
    out.reportedChainId = Number(net.chainId);
    out.chainIdMatch = Number(net.chainId) === cfg.chainId;
    const wallet = new ethers.Wallet(pk);
    out.ownerAddress = wallet.address;

    if (!dryRun) {
      const probe = await executeCryptoPayout({
        chain: key, token: 'NATIVE', to: wallet.address, amount: 0, dryRun: true,
      });
      out.probe = probe.status;
    } else {
      out.probe = 'skipped (dry-run)';
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

async function setupTron(key, cfg) {
  const rpc = process.env[cfg.rpcEnvKey] || cfg.defaultRpc;
  const pk = (process.env.CRON_OWNER_PRIVATE_KEY || process.env.CRYPTO_OWNER_PRIVATE_KEY || '').trim();
  const out = { chain: key, rpc, envOk: !!pk, ownerAddress: null };
  if (!pk) { out.error = 'CRON_OWNER_PRIVATE_KEY (or CRYPTO_OWNER_PRIVATE_KEY) not set'; return out; }
  out.envOk = true;

  try {
    const res = await fetch(`${rpc}/wallet/getnowblock`);
    out.rpcOk = res.ok;
  } catch (e) { out.rpcOk = false; out.rpcError = e.message; }

  try {
    const tw = await import('tronweb').catch(() => null);
    if (tw?.TronWeb) {
      const w = new tw.TronWeb({ fullHost: rpc, privateKey: pk });
      out.ownerAddress = w.address.fromPrivateKey(pk);
    } else {
      out.note = 'tronweb not installed; install with `npm install tronweb` to derive the TRON address';
    }
  } catch (e) { out.error = e.message; }
  return out;
}

async function setupSolana(key, cfg) {
  const rpc = process.env[cfg.rpcEnvKey] || cfg.defaultRpc;
  const pk = (process.env.SOL_OWNER_PRIVATE_KEY || process.env.CRYPTO_OWNER_PRIVATE_KEY || '').trim();
  const out = { chain: key, rpc, envOk: !!pk, ownerAddress: null };
  if (!pk) { out.error = 'SOL_OWNER_PRIVATE_KEY (or CRYPTO_OWNER_PRIVATE_KEY) not set'; return out; }
  out.envOk = true;

  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    out.rpcOk = res.ok;
  } catch (e) { out.rpcOk = false; out.rpcError = e.message; }
  return out;
}

(async () => {
  info(`Crypto rail setup — dry-run=${dryRun}, chains=${chains.length}`);
  for (const c of chains) {
    let r;
    if (c.family === 'evm') r = await setupEvm(c.key, c.cfg);
    else if (c.family === 'tron') r = await setupTron(c.key, c.cfg);
    else r = await setupSolana(c.key, c.cfg);
    report.chains[`${c.family}:${c.key}`] = r;

    if (r.envOk) {
      info(`✓ ${c.family}:${c.key} — env OK, owner=${r.ownerAddress || '?'}`);
    } else {
      warn(`✗ ${c.family}:${c.key} — ${r.error || 'env missing'}`);
    }
  }

  fs.mkdirSync(path.dirname(SETUP_FILE), { recursive: true });
  fs.writeFileSync(SETUP_FILE, JSON.stringify(report, null, 2));
  info(`Wrote ${SETUP_FILE}`);

  // Friendly next-step summary
  console.log('\n=== NEXT STEPS ===');
  console.log('1. Edit .env: set OWNER_CRYPTO_ADDRESS (your hot wallet) + CRYPTO_OWNER_PRIVATE_KEY.');
  console.log('2. Set CRYPTO_DRY_RUN=true and run `npm run crypto:payout -- --chain=bsc --token=USDT --to=<OWNER_CRYPTO_ADDRESS> --amount=1` to dry-run.');
  console.log('3. When the dry-run looks right, set CRYPTO_DRY_RUN=false + CRYPTO_ENABLE=true.');
  console.log('4. (Optional) Add the same env as repo secrets so the GitHub Actions workflow can run it:');
  console.log('     gh secret set CRYPTO_OWNER_PRIVATE_KEY --body "<key>"');
  console.log('     gh secret set OWNER_CRYPTO_ADDRESS --body "<addr>"');
  console.log('     gh secret set RPC_BSC --body "https://bsc-dataseed.binance.org"');
  console.log('     ...repeat for each chain you use.');
})().catch(e => fail(e.message));
