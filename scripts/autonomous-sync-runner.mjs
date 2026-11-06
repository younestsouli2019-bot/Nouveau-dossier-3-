#!/usr/bin/env node
/**
 * autonomous-sync-runner.mjs — master runner that COMPOSES the verified steps.
 *
 * It deliberately reimplements nothing: pricing comes from utils-compile-prices
 * (derived book, source untouched), publishing from shopify-catalog-sync
 * (idempotent by handle, currency gate, SWARM_LIVE guard).
 *
 * Exit codes: 0 completed, 1 a step failed, 2 config missing for --execute.
 *
 * Usage:
 *   FX_MAD_PER_USD=10 node scripts/autonomous-sync-runner.mjs
 *   SWARM_LIVE=1 ... node scripts/autonomous-sync-runner.mjs --execute
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const RATE = process.env.FX_MAD_PER_USD || '10';
const OUT = 'rank/output/data/pricing/prices.usd.json';

const run = (script, argv, env = {}) => {
  const r = spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', env: { ...process.env, ...env } });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  return r.status ?? 1;
};

console.log(`[runner] 1/3 compile derived book at ${RATE} MAD per unit`);
if (run('scripts/utils-compile-prices.mjs', ['--mad-per-usd', RATE, '--out', OUT]) !== 0) {
  console.error('[runner] compile failed — stopping');
  process.exit(1);
}

console.log('[runner] 2/3 sync plan against the derived book');
if (run('scripts/shopify-catalog-sync.mjs', [], { PRICE_BOOK_PATH: OUT }) !== 0) {
  console.error('[runner] plan failed — stopping');
  process.exit(1);
}

if (!EXECUTE) {
  console.log('[runner] completed in dry-run mode. Nothing was published.');
  process.exit(0);
}

const domain = process.env.SHOPIFY_STORE_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
if (!domain || !token) {
  console.error('[runner] --execute requires SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN');
  process.exit(2);
}
if (process.env.SWARM_LIVE !== '1') {
  console.error('[runner] --execute requires SWARM_LIVE=1');
  process.exit(2);
}

console.log('[runner] 3/3 publish');
process.exit(run('scripts/shopify-catalog-sync.mjs', ['--execute'], { PRICE_BOOK_PATH: OUT }) === 0 ? 0 : 1);
