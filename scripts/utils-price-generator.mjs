#!/usr/bin/env node
/**
 * utils-price-generator.mjs — assign fixed MAD prices, tiered by default.
 *
 * SCHEMA (verified): courses[slug] = { mode, amountMinor }; amountMinor is in
 * MINOR units (450000 = 4500.00 MAD). There is no `type` and no `amount` field:
 * a generator written against either publishes nothing.
 *
 * SAFETY: dry-run by default; --apply requires --approve-by; tiered unless
 * --base-mad is given; stage with --limit/--only; backup + atomic rename.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const BOOK = join(process.cwd(), 'rank/output/data/pricing/prices.json');
const MIN_MAD = 50;
const MAX_MAD = 100000;
const TIERS = { ATPL: 12500, PPL: 4500, PREPTEST: 1500, DEFAULT: 3500 };

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = has('--apply');
const APPROVE_BY = val('--approve-by', '');
const EXCLUDE_QUOTE = has('--exclude-quote-required');
const INCLUDE_ABSENT = has('--include-absent');
const REPRICE_FIXED = has('--reprice-fixed');
const ONLY = val('--only', '') ? val('--only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
const LIMIT_RAW = Number(val('--limit', ''));
const LIMIT = Number.isInteger(LIMIT_RAW) && LIMIT_RAW > 0 ? LIMIT_RAW : Infinity;
const flatMad = Number(val('--base-mad', ''));
const TIERED = !Number.isFinite(flatMad) || flatMad === 0;
const die = (m, c = 2) => { console.error(`[fail-closed] ${m}`); process.exit(c); };

if (!TIERED && (!Number.isInteger(flatMad) || flatMad < MIN_MAD || flatMad > MAX_MAD)) die('bad --base-mad');
for (const [t, v] of Object.entries(TIERS)) if (v < MIN_MAD || v > MAX_MAD) die(`tier ${t} out of bounds`);
if (APPLY && !APPROVE_BY) die('--apply requires --approve-by <name>');

const book = JSON.parse(readFileSync(BOOK, 'utf8'));
if (book.currency !== 'MAD') die(`book currency is ${book.currency}, expected MAD`);
if (book.minorUnits !== 2) die('book minorUnits must be 2');

/** Most specific first: an ATPL slug also contains "preptest". */
function tierFor(slug) {
  const s = slug.toLowerCase();
  if (/(^|-)atpl(-|$)|airline-transport|commercial-pilot/.test(s)) return 'ATPL';
  if (/(^|-)ppl(-|$)|private-pilot/.test(s)) return 'PPL';
  if (/preptest|mock|practice-exam|test-bank/.test(s)) return 'PREPTEST';
  return 'DEFAULT';
}

const minor = book.minorUnits;
const courses = book.courses || {};
const changes = [];
const skipped = { quoteExcluded: 0, absentNotIncluded: 0, alreadyPriced: 0, filtered: 0 };
const tierCounts = { ATPL: 0, PPL: 0, PREPTEST: 0, DEFAULT: 0 };

for (const [slug, meta] of Object.entries(courses)) {
  if (ONLY && !ONLY.includes(slug)) { skipped.filtered++; continue; }
  if (changes.length >= LIMIT) break;
  const mode = meta.mode || 'absent';
  if (mode === 'absent') { if (!INCLUDE_ABSENT) { skipped.absentNotIncluded++; continue; } }
  else if (mode === 'quote_required') { if (EXCLUDE_QUOTE) { skipped.quoteExcluded++; continue; } }
  else if (mode === 'fixed') {
    const priced = Number.isFinite(meta.amountMinor) && meta.amountMinor > 0;
    if (priced && !REPRICE_FIXED) { skipped.alreadyPriced++; continue; }
  }
  const tier = TIERED ? tierFor(slug) : 'FLAT';
  if (TIERED) tierCounts[tier]++;
  const to = (TIERED ? TIERS[tier] : flatMad) * 10 ** minor;
  changes.push({ slug, from: meta.amountMinor ?? null, to, wasMode: mode, tier });
}

const sumMinor = changes.reduce((n, c) => n + c.to, 0);
console.log(JSON.stringify({
  applied: APPLY,
  mode: TIERED ? 'tiered' : 'flat',
  approveBy: APPROVE_BY || null,
  baseMad: TIERED ? null : flatMad,
  tiers: TIERED ? tierCounts : null,
  total: Object.keys(courses).length,
  convertible: changes.length,
  skipped_absent: skipped.absentNotIncluded,
  skipped_already_priced: skipped.alreadyPriced,
  skipped_quote_excluded: skipped.quoteExcluded,
  filtered: skipped.filtered,
  sumMinorAfter: sumMinor,
  sumMadAfter: sumMinor / 10 ** minor,
  warning: changes.some((c) => c.wasMode === 'quote_required') ? 'quote leads become sellable; stage with --limit/--only' : null,
  sample: changes.slice(0, 5).map((c) => `${c.slug}: ${c.wasMode} -> ${c.to} (${c.tier})`),
}, null, 2));

if (changes.length === 0) { console.error('[warn] 0 convertible — schema is mode + amountMinor, not type/amount.'); process.exit(3); }
if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply --approve-by <name>.'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(process.cwd(), 'rank/output/data/pricing/backups');
mkdirSync(dir, { recursive: true });
copyFileSync(BOOK, join(dir, `prices-${stamp}.json`));
for (const c of changes) {
  const meta = courses[c.slug];
  meta.mode = 'fixed';
  meta.amountMinor = c.to;
  meta.pricedAt = new Date().toISOString();
  meta.pricedBy = 'utils-price-generator';
  meta.approvedBy = APPROVE_BY;
  meta.approvedAt = new Date().toISOString();
}
book.updated = new Date().toISOString().slice(0, 10);
const tmp = `${BOOK}.tmp`;
writeFileSync(tmp, JSON.stringify(book, null, 2), 'utf8');
renameSync(tmp, BOOK);
console.log(`Wrote ${changes.length} entries. Backup: ${dir}`);
