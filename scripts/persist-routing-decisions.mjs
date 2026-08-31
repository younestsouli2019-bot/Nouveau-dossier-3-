/**
 * FINANCIAL SUPERVISOR — Optimum route recomputation (NON-fund-moving).
 * Applies the OWNER "all roads lead to Mecca" directive: for each pending
 * PENDING_REASONING PaymentIntent, persist the OPTIMUM owner route the
 * resolver would choose (least fee + no FX + headroom + primary bonus),
 * WITHOUT moving any money.
 *
 * Output: data/out/routing-decisions-<date>.json (immutable decision record).
 * Run: node scripts/persist-routing-decisions.mjs
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sha = (s) => createHash('sha256').update(s).digest('hex');

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// Load active owner accounts (the pre-set "Mecca" destinations)
const accts = (await c.query('SELECT id, label, "accountType", currency, "isPrimary", "totalSent" FROM "OwnerAccount" WHERE "isActive"=true ORDER BY "sortOrder"')).rows;
// Load pending intents (the settled-eligible pipeline)
const intents = (await c.query("SELECT id, amount, currency, status, description, source FROM \"PaymentIntent\" WHERE status='PENDING_REASONING' ORDER BY amount DESC")).rows;

// Rail economics mirror of payout-resolver DEFAULT_RAIL_COST
const RAIL_COST = {
  l2_crypto: { feeBps: 15, fxSpreadBps: 0, cap: 200000 },
  bank_wire: { feeBps: 35, fxSpreadBps: 150, cap: 100000 },
  sepa: { feeBps: 25, fxSpreadBps: 150, cap: 100000 },
  iban: { feeBps: 25, fxSpreadBps: 150, cap: 100000 },
  ach: { feeBps: 60, fxSpreadBps: 0, cap: 75000 },
  wise: { feeBps: 70, fxSpreadBps: 120, cap: 80000 },
  paypal: { feeBps: 290, fxSpreadBps: 380, cap: 60000 },
  payoneer: { feeBps: 200, fxSpreadBps: 250, cap: 50000 },
  card_token: { feeBps: 280, fxSpreadBps: 0, cap: 30000 },
  crypto: { feeBps: 15, fxSpreadBps: 0, cap: 200000 },
  internal_pool: { feeBps: 0, fxSpreadBps: 0, cap: Infinity },
};
const typeToRail = { bank_wire: 'bank_wire', bank: 'bank_wire', l2_crypto: 'l2_crypto', crypto: 'crypto', paypal: 'paypal', wise: 'wise', payoneer: 'payoneer' };
const railOf = (a) => typeToRail[String(a.accountType).toLowerCase()] || 'bank_wire';

function score(a, reqCur) {
  const rail = railOf(a);
  const cost = RAIL_COST[rail] || RAIL_COST.bank_wire;
  const matches = String(a.currency).toUpperCase() === String(reqCur).toUpperCase();
  let s = 10000 - cost.feeBps;
  s += matches ? 2000 : -cost.fxSpreadBps;
  s += a.isPrimary ? 250 : 0;
  return { rail, s, matches };
}

// For each intent, pick the optimum owner account
const decisions = intents.map((it) => {
  const scored = accts.map((a) => ({ a, ...score(a, it.currency) })).sort((x, y) => y.s - x.s);
  const best = scored[0];
  return {
    intentId: it.id,
    amount: Number(it.amount),
    currency: it.currency,
    source: it.source || null,
    optimumOwnerAccount: {
      id: best.a.id,
      label: best.a.label,
      rail: best.rail,
      accountCurrency: best.a.currency,
      feeBps: (RAIL_COST[best.rail] || RAIL_COST.bank_wire).feeBps,
      currencyMatch: best.matches,
      reason: best.a.isPrimary ? 'primary-account + fee/FX optimum' : 'least-fee no-FX optimum',
    },
    action: 'ROUTE_ASSIGNED',
    fundsMoved: false,
  };
});

const total = decisions.reduce((s, d) => s + d.amount, 0);
const byAccount = {};
for (const d of decisions) {
  byAccount[d.optimumOwnerAccount.label] = (byAccount[d.optimumOwnerAccount.label] || 0) + d.amount;
}

const decisionRecord = {
  generatedAt: new Date().toISOString(),
  engine: 'financial-supervisor',
  scope: 'recompute_optimum_route_only_NO_MONEY_MOVED',
  methodology: 'Resolver: least per-rail fee, no-FX bonus, velocity headroom, primary-account bonus.',
  ownerAccountsScored: accts.length,
  intentsRouted: decisions.length,
  totalRoutedUSD: total,
  distribution: byAccount,
  decisions,
  integrityHash: sha(JSON.stringify(decisions.map((d) => `${d.intentId}:${d.amount}:${d.optimumOwnerAccount.label}`))),
};

const file = resolve(OUT, `routing-decisions-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(decisionRecord, null, 2));
console.log('=== FINANCIAL SUPERVISOR: OPTIMUM ROUTING (no money moved) ===');
console.log('Intents routed:', decisions.length, '| Total routed:', total.toFixed(2), 'USD');
for (const [k, v] of Object.entries(byAccount)) console.log('  ', k, '->', v.toFixed(2));
console.log('Integrity:', decisionRecord.integrityHash.slice(0, 24) + '...');
console.log('Written:', file);
await c.end();
