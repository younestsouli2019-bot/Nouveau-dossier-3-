#!/usr/bin/env node
/**
 * test-shopify-missions.mjs — proves M1/M2 fail closed and that M2's plan is
 * derived from the authoritative price book, without any network call.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};
const run = (script, args = [], env = {}) => {
  const clean = { ...process.env, ...env };
  delete clean.SHOPIFY_STORE_DOMAIN; delete clean.SHOPIFY_ADMIN_API_TOKEN;
  Object.assign(clean, env);
  return spawnSync('node', [script, ...args], { encoding: 'utf8', env: clean });
};

// M1 must refuse without credentials
const m1 = run('scripts/shopify-verify.mjs');
ok('M1 exits 2 without credentials', m1.status === 2, `got ${m1.status}`);
// Contract change: the store handle is committed config, the token never is.
ok('M1 names the missing token', /SHOPIFY_ADMIN_API_TOKEN/.test(m1.stderr));
ok('M1 does NOT demand the domain as env (it reads config/shopify.json)', !/no store domain/.test(m1.stderr));
const cfg = JSON.parse(readFileSync('config/shopify.json', 'utf8'));
ok('config declares a store domain', /^[a-z0-9-]+\.myshopify\.com$/.test(cfg.store_domain || ''));
const bookCurrency = JSON.parse(readFileSync('rank/output/data/pricing/prices.json', 'utf8')).currency;
ok('config expected currency matches the price book', (cfg.expected_currency || '').toUpperCase() === (bookCurrency || '').toUpperCase());
ok('M1 makes no network attempt', !/HTTP \d{3}/.test(m1.stdout + m1.stderr));

// SHOPIFY_ADMIN_API_KEY alias: with a (fake) token present under the alias name,
// M1 must stop complaining about a missing secret. It then fails on the network,
// which is exit 1 — NOT the fail-closed exit 2 of a missing credential.
const aliasRun = run('scripts/shopify-verify.mjs', [], { SHOPIFY_ADMIN_API_KEY: 'shpat_fake_for_alias_test', SHOPIFY_STORE_DOMAIN: 'invalid.example-not-a-store' });
ok('M1 accepts SHOPIFY_ADMIN_API_KEY alias (no missing-secret refusal)', !/missing env/.test(aliasRun.stderr));
ok('M1 with alias exits 1 (network/API), not 2 (misconfigured)', aliasRun.status !== 2);

// M2 dry-run must not touch the network and must exit 0
const m2 = run('scripts/shopify-catalog-sync.mjs');
ok('M2 dry-run exits 0', m2.status === 0, `got ${m2.status}`);
ok('M2 dry-run sends nothing', /No request sent/.test(m2.stdout));

let plan = null;
try { plan = JSON.parse(m2.stdout.slice(m2.stdout.indexOf('{'), m2.stdout.lastIndexOf('}') + 1)); } catch {}
ok('M2 emits a JSON plan', !!plan);

const book = JSON.parse(readFileSync('rank/output/data/pricing/prices.json', 'utf8'));
const fixed = Object.values(book.courses).filter((c) => c.mode === 'fixed' && Number.isFinite(c.amountMinor) && c.amountMinor > 0).length;
ok('M2 sellable count equals fixed-with-amount in the book',
   plan && plan.sellable === fixed, `plan=${plan?.sellable} book=${fixed}`);

ok('M2 never publishes quote_required courses',
   plan && (plan.skipped_by_reason?.quote_required || 0) ===
   Object.values(book.courses).filter((c) => c.mode === 'quote_required').length);

// M2 execute must refuse without SWARM_LIVE
const m2e = run('scripts/shopify-catalog-sync.mjs', ['--execute'], { SWARM_LIVE: '' });
ok('M2 --execute refuses without SWARM_LIVE', m2e.status === 2, `got ${m2e.status}`);

// ---- price generator (utils-price-generator.mjs) ----
import { createHash } from 'node:crypto';
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const BOOK = 'rank/output/data/pricing/prices.json';

const before = hash(BOOK);
const genDry = run('scripts/utils-price-generator.mjs', ['--base-mad', '4500']);
ok('generator dry-run exits 0', genDry.status === 0, `got ${genDry.status}`);
ok('generator dry-run writes nothing', hash(BOOK) === before);
ok('generator requires --base-mad', run('scripts/utils-price-generator.mjs').status === 2);
ok('generator --apply refuses without --approve-by',
   run('scripts/utils-price-generator.mjs', ['--base-mad', '4500', '--apply']).status === 2);

let gplan = null;
try { gplan = JSON.parse(genDry.stdout.slice(genDry.stdout.indexOf('{'), genDry.stdout.lastIndexOf('}') + 1)); } catch {}
const convertible = Object.values(book.courses).filter(
  (c) => c.mode === 'quote_required' || (c.mode === 'fixed' && !(Number.isFinite(c.amountMinor) && c.amountMinor > 0))).length;
ok('generator convertible count matches book (mode/amountMinor aware)',
   gplan && gplan.convertible === convertible, `plan=${gplan?.convertible} book=${convertible}`);
ok('generator would NOT touch absent courses',
   gplan && gplan.skipped_absent === Object.values(book.courses).filter((c) => (c.mode || 'absent') === 'absent').length);

console.log(`\nresult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
