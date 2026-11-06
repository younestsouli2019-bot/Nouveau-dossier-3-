#!/usr/bin/env node
/**
 * utils-price-generator.mjs — convert unpriced entries to fixed MAD prices.
 *
 * SCHEMA (verified against shopify-catalog-sync.mjs): courses[slug] = { mode, amount }
 * where `amount` is in MINOR units (450000 = 4500.00 MAD). There is no `type`
 * field and no `amountMinor` field: a generator written against either marks
 * every course fixed-without-amount, so the sync publishes nothing.
 *
 * SAFETY
 *   - dry-run by default; --apply additionally requires --approve-by <name>
 *   - timestamped backup before any mutation; atomic rename on write
 *   - quote_required and absent entries convert only behind explicit flags
 *   - zero convertible entries is a loud failure, not success
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const BOOK = join(process.cwd(), 'rank/output/data/pricing/prices.json');
const MIN_MAD = 50;
const MAX_MAD = 100000;

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const APPLY = has('--apply');
const APPROVE_BY = val('--approve-by', '');
const EXCLUDE_QUOTE = has('--exclude-quote-required');
const INCLUDE_ABSENT = has('--include-absent');
const REPRICE_FIXED = has('--reprice-fixed');
const ONLY = val('--only', '') ? val('--only', '').split(',').map(s => s.trim()).filter(Boolean) : null;
const LIMIT_RAW = Number(val('--limit', ''));
const LIMIT = Number.isInteger(LIMIT_RAW) && LIMIT_RAW > 0 ? LIMIT_RAW : Infinity;
const baseMad = Number(val('--base-mad', ''));

const die = (m, c = 2) => { console.error(`[fail-closed] ${m}`); process.exit(c); };

if (!Number.isInteger(baseMad) || baseMad < MIN_MAD || baseMad > MAX_MAD) die(`--base-mad must be an integer ${MIN_MAD}..${MAX_MAD}`);
if (APPLY && !APPROVE_BY) die('--apply requires --approve-by <name>: prices are a commercial act');

const book = JSON.parse(readFileSync(BOOK, 'utf8'));
if (book.currency !== 'MAD') die(`book currency is ${book.currency}, expected MAD`);
if (book.minorUnits !== 2) die(`book minorUnits is ${book.minorUnits}, expected 2`);

const amount = baseMad * 10 ** book.minorUnits;
const courses = book.courses || {};
const changes = [];
const skipped = { quoteExcluded: 0, absentNotIncluded: 0, alreadyPriced: 0, filtered: 0 };

for (const [slug, meta] of Object.entries(courses)) {
  if (ONLY && !ONLY.includes(slug)) { skipped.filtered++; continue; }
  if (changes.length >= LIMIT) break;
  const mode = meta.mode || 'absent';
  if (mode === 'absent') {
    if (!INCLUDE_ABSENT) { skipped.absentNotIncluded++; continue; }
  } else if (mode === 'quote_required') {
    if (EXCLUDE_QUOTE) { skipped.quoteExcluded++; continue; }
  } else if (mode === 'fixed') {
    const priced = Number.isFinite(meta.amountMinor) && meta.amountMinor > 0;
    if (priced && !REPRICE_FIXED) { skipped.alreadyPriced++; continue; }
  }
  changes.push({ slug, from: meta.amountMinor ?? null, to: amount, wasMode: mode });
}

const summary = {
  applied: APPLY,
  approveBy: APPROVE_BY || null,
  baseMad,
  amountMinor: amount,
  total: Object.keys(courses).length,
  convertible: changes.length,
  skipped_absent: skipped.absentNotIncluded,
  skipped_already_priced: skipped.alreadyPriced,
  skipped_quote_excluded: skipped.quoteExcluded,
  filtered: skipped.filtered,
  sumMinorAfter: changes.reduce((n, c) => n + c.to, 0),
  warning: changes.some((c) => c.wasMode === 'quote_required')
    ? 'converting quote_required entries publishes them as sellable; stage with --limit/--only'
    : null,
  sample: changes.slice(0, 5).map((c) => `${c.slug}: ${c.wasMode} -> ${c.to}`),
};
console.log(JSON.stringify(summary, null, 2));

if (changes.length === 0) {
  console.error('[warn] 0 courses convertible — check schema: mode + amount (minor units), not type/amountMinor.');
  process.exit(3);
}
if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply --approve-by <name>.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(process.cwd(), 'rank/output/data/pricing/backups');
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `prices-${stamp}.json`);
copyFileSync(BOOK, backup);

const now = new Date().toISOString();
for (const c of changes) {
  const meta = courses[c.slug];
  meta.mode = 'fixed';
  meta.amountMinor = c.to;
  meta.approvedBy = APPROVE_BY;
  meta.approvedAt = now;
}
book.updated = now.slice(0, 10);

const tmp = `${BOOK}.tmp`;
writeFileSync(tmp, JSON.stringify(book, null, 2), 'utf8');
renameSync(tmp, BOOK);

console.log(`Wrote ${changes.length} entries at ${baseMad} MAD. Backup: ${backup}`);
console.log('Next: node scripts/shopify-catalog-sync.mjs (dry run).');
