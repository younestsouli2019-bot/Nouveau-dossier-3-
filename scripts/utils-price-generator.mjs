#!/usr/bin/env node
/**
 * utils-price-generator.mjs — mass-assign MAD prices to the authoritative book.
 *
 * SCHEMA (verified): courses[] = { mode: 'fixed'|'quote_required'|'absent',
 *                                  amountMinor?: int, approvedBy?, approvedAt? }
 * There is NO `type` field. A generator written against `type` converts 0 items
 * while printing success — that silent no-op is what this script prevents.
 *
 * SAFETY:
 *   - dry-run by default; nothing is written without --apply
 *   - --apply REQUIRES --approve-by <name>: prices are a commercial act, and the
 *     book records who approved them (approvedBy/approvedAt)
 *   - a timestamped .bak copy is written before any mutation
 *   - mode 'absent' is never made sellable unless --include-absent is explicit
 *   - loud failure when zero courses convert (schema drift, not success)
 *
 * Usage:
 *   node scripts/utils-price-generator.mjs --base-mad 4500
 *   node scripts/utils-price-generator.mjs --base-mad 4500 --apply --approve-by owner
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const BOOK = join(process.cwd(), 'rank/output/data/pricing/prices.json');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const baseMad = Number(val('--base-mad', '0'));
const apply = flag('--apply');
const approveBy = val('--approve-by', '');
const includeAbsent = flag('--include-absent');
const perTier = val('--tier-map', ''); // "category=price|category=price"

if (!baseMad || Number.isNaN(baseMad) || baseMad <= 0) {
  console.error('[fail-closed] --base-mad <amount in major units> is required, e.g. --base-mad 4500');
  process.exit(2);
}
if (apply && !approveBy) {
  console.error('[fail-closed] --apply requires --approve-by <name>. Prices are recorded with an approver.');
  process.exit(2);
}

let book;
try { book = JSON.parse(readFileSync(BOOK, 'utf8')); }
catch (e) { console.error(`[fail-closed] cannot read price book: ${e.message}`); process.exit(1); }

const courses = book.courses || {};
const minor = book.minorUnits ?? 2;
const tiers = new Map(perTier ? perTier.split('|').filter(Boolean).map((p) => {
  const [k, v] = p.split('='); return [k, Number(v)];
}) : []);

// Optional category lookup so tiers can price by course family rather than flat.
let categoryOf = () => null;
try {
  const cat = JSON.parse(readFileSync(join(process.cwd(), 'data/rwc-catalog-live.json'), 'utf8')).items || [];
  const m = new Map(cat.map((c) => [c.slug, c.category]));
  categoryOf = (slug) => m.get(slug) || null;
} catch { /* catalogue optional; flat price still works */ }

const today = new Date().toISOString().slice(0, 10);
const changes = [];
const skipped = { absent: 0, alreadyFixed: 0 };

for (const [slug, meta] of Object.entries(courses)) {
  const mode = meta.mode || 'absent';
  if (mode === 'absent') {
    if (!includeAbsent) { skipped.absent++; continue; }
  }
  if (mode === 'fixed' && Number.isFinite(meta.amountMinor) && meta.amountMinor > 0) {
    skipped.alreadyFixed++; continue;
  }
  const tierPrice = tiers.get(categoryOf(slug) || '') ?? null;
  const major = tierPrice ?? baseMad;
  changes.push({
    slug,
    from: mode,
    major,
    amountMinor: Math.round(major * 10 ** minor),
  });
}

const summary = {
  book: BOOK,
  currency: book.currency,
  minorUnits: minor,
  base_mad: baseMad,
  mode: apply ? 'apply' : 'dry-run',
  convertible: changes.length,
  skipped_absent: skipped.absent,
  skipped_already_fixed: skipped.alreadyFixed,
  total_courses: Object.keys(courses).length,
  sample: changes.slice(0, 3),
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nNothing written. Re-run with --apply --approve-by <owner> to commit these prices.');
  if (changes.length === 0) {
    console.error('[warn] 0 courses convertible — check schema: expected `mode` + `amountMinor`, NOT `type`/`amount`.');
  }
  process.exit(0);
}

for (const c of changes) {
  const meta = courses[c.slug];
  meta.mode = 'fixed';
  meta.amountMinor = c.amountMinor;
  meta.approvedBy = approveBy;
  meta.approvedAt = today;
}
book.updated = today;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
copyFileSync(BOOK, `${BOOK}.bak-${stamp}`);
writeFileSync(BOOK, JSON.stringify(book, null, 2), 'utf8');

console.log(JSON.stringify({ ...summary, backup: `${BOOK}.bak-${stamp}` }, null, 2));
console.log(`\nWrote ${changes.length} prices at ${baseMad} MAD (approvedBy=${approveBy}).`);
if (changes.length === 0) {
  console.error('[warn] 0 converted — the book may already be priced, or the schema changed.');
}
