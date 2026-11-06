#!/usr/bin/env node
/**
 * utils-compile-prices.mjs — derive a storefront-currency book from the MAD one.
 *
 * The MAD book stays the sole pricing authority; this writes a DERIVED file.
 * Never mutates the source: a converted copy destroys the baseline and the
 * approvedBy audit trail, and cannot be re-derived later.
 *
 * Usage:
 *   node scripts/utils-compile-prices.mjs --mad-per-usd 10
 *   node scripts/utils-compile-prices.mjs --mad-per-usd 10 --currency USD --out rank/output/data/pricing/prices.usd.json
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const SOURCE = join(process.cwd(), 'rank/output/data/pricing/prices.json');
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = argv.includes('--dry-run');
const CURRENCY = val('--currency', 'USD').toUpperCase();
const RATE = Number(val('--mad-per-usd', ''));
const OUT = val('--out', 'rank/output/data/pricing/prices.usd.json');

const die = (m, c = 2) => { console.error(`[fail-closed] ${m}`); process.exit(c); };

if (CURRENCY !== 'USD' && CURRENCY !== 'EUR') die('--currency must be USD or EUR');
if (!Number.isFinite(RATE) || RATE < 5 || RATE > 20) {
  die('--mad-per-usd must be a plausible rate (5..20); it is a commercial input, not a hardcoded constant');
}

const raw = readFileSync(SOURCE, 'utf8');
const book = JSON.parse(raw);
if (book.currency !== 'MAD') die(`source currency is ${book.currency}, expected MAD`);
if (book.minorUnits !== 2) die('source minorUnits must be 2');

const courses = {};
let priced = 0, sumMadMinor = 0, sumOutMinor = 0;
const samples = [];

for (const [slug, meta] of Object.entries(book.courses || {})) {
  const next = { ...meta };
  const minor = Number(meta.amountMinor);
  if (meta.mode === 'fixed' && Number.isFinite(minor) && minor > 0) {
    const majorMad = minor / 100;
    const majorOut = majorMad / RATE;
    const outMinor = Math.round(majorOut * 100);
    if (outMinor < 50) die(`${slug} converts to ${outMinor} minor units — below the 0.50 floor`);
    next.amountMinor = outMinor;
    priced++;
    sumMadMinor += minor;
    sumOutMinor += outMinor;
    if (samples.length < 5) samples.push(`${slug}: ${majorMad.toFixed(2)} MAD -> ${(outMinor / 100).toFixed(2)} ${CURRENCY}`);
  }
  courses[slug] = next;
}

const outPath = isAbsolute(OUT) ? OUT : join(process.cwd(), OUT);
const compiled = {
  $comment: 'DERIVED book. Do not edit by hand. Source of truth: rank/output/data/pricing/prices.json (MAD).',
  schemaVersion: book.schemaVersion,
  updated: new Date().toISOString().slice(0, 10),
  currency: CURRENCY,
  minorUnits: 2,
  derivedFrom: { path: 'rank/output/data/pricing/prices.json', currency: 'MAD', sha256: createHash('sha256').update(raw).digest('hex') },
  fx: { madPerUnit: RATE, unit: CURRENCY, compiledAt: new Date().toISOString() },
  courses,
};

console.log(JSON.stringify({
  dryRun: DRY,
  out: outPath,
  currency: CURRENCY,
  madPerUnit: RATE,
  priced,
  total: Object.keys(courses).length,
  sumMad: sumMadMinor / 100,
  sumOut: sumOutMinor / 100,
  effectiveRate: sumOutMinor ? (sumMadMinor / sumOutMinor).toFixed(4) : null,
  samples,
}, null, 2));

if (DRY) { console.log('DRY RUN — nothing written.'); process.exit(0); }
const tmp = `${outPath}.tmp`;
writeFileSync(tmp, JSON.stringify(compiled, null, 2), 'utf8');
renameSync(tmp, outPath);
console.log(`Wrote ${outPath} (source untouched).`);
