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
ok('M1 names the missing vars', /SHOPIFY_STORE_DOMAIN/.test(m1.stderr) && /SHOPIFY_ADMIN_API_TOKEN/.test(m1.stderr));
ok('M1 makes no network attempt', !/HTTP \d{3}/.test(m1.stdout + m1.stderr));

// M2 dry-run must not touch the network and must exit 0
const m2 = run('scripts/shopify-catalog-sync.mjs');
ok('M2 dry-run exits 0', m2.status === 0, `got ${m2.status}`);
ok('M2 dry-run sends nothing', /No request sent/.test(m2.stdout));

let plan = null;
try { plan = JSON.parse(m2.stdout.slice(m2.stdout.indexOf('{'), m2.stdout.lastIndexOf('}') + 1)); } catch {}
ok('M2 emits a JSON plan', !!plan);

const book = JSON.parse(readFileSync('rank/output/data/pricing/prices.json', 'utf8'));
const fixed = Object.values(book.courses).filter((c) => c.mode === 'fixed' && c.amount != null).length;
ok('M2 sellable count equals fixed-with-amount in the book',
   plan && plan.sellable === fixed, `plan=${plan?.sellable} book=${fixed}`);

ok('M2 never publishes quote_required courses',
   plan && (plan.skipped_by_reason?.quote_required || 0) ===
   Object.values(book.courses).filter((c) => c.mode === 'quote_required').length);

// M2 execute must refuse without SWARM_LIVE
const m2e = run('scripts/shopify-catalog-sync.mjs', ['--execute'], { SWARM_LIVE: '' });
ok('M2 --execute refuses without SWARM_LIVE', m2e.status === 2, `got ${m2e.status}`);

console.log(`\nresult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
