#!/usr/bin/env node
/**
 * inbound-scout.mjs  (Agent 1 · INBOUND RIB SCOUT · fail-closed)
 *
 * Continuously-parsable inbound matcher: ingests REAL wire proofs
 * (MT103 snapshots / UETR refs / externalRef JSON / Camt.053 extracts)
 * and cross-matches them against the OwnerSettlement + RevenueEvent
 * worklist in Postgres. Emits exact-match settlement candidates.
 *
 * FAIL-CLOSED:
 *  - Never marks anything "settled" itself. Produces a candidacy report
 *    keyed by real proof artifacts (amount+currency+destination+ref).
 *  - A confirmation actor (operation/ledger-sync) applies the transition
 *    only after payload integrity verification.
 *  - No fabricated matches: without an EXACT externalRef or exact
 *    amount+currency+RIB match, nothing is staged.
 *
 *   node scripts/inbound-scout.mjs --file <mt103-or-receipt.json|csv>
 *   node scripts/inbound-scout.mjs --dir data/inbound/receipts --poll
 *
 * Produces: data/out/inbound-scout-report.json
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
const INBOX = resolve(ROOT, 'data', 'inbound', 'receipts');
for (const d of [OUT, INBOX]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };

// ── Owner RIBs (inbound destinations we recognize) ───────────────────────
const OWNER_RIBS = [
  '007810000448500030594182', // primary
  '007810000448200061321372', // reserve RIB 372
];
const OWNER_RIB_SUFFIXES = ['0594182', '61321372'];

// ── Parsers ──────────────────────────────────────────────────────────────
function parseReceipt(text, filename) {
  const records = [];
  const trimmed = text.trim();

  // JSON receipt (common: { externalRef, amount, currency, destination, remitter, ... })
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.receipts || j.entries || j.records || [j]);
      for (const rec of arr) {
        records.push({
          externalRef: rec.externalRef || rec.reference || rec.ref || rec.acctSvcrRef || rec.txId,
          amount: rec.amount ?? rec.value ?? rec.total,
          currency: (rec.currency || rec.ccy || 'USD').toString().toUpperCase(),
          destination: rec.destination || rec.rib || rec.iban || rec.account,
          remitter: rec.remitter || rec.sender || rec.remittingBank,
          bookDate: rec.bookDate || rec.valueDate || rec.occurredAt,
          note: rec.description || rec.remittanceInfo || rec.note,
          proofFile: filename,
          kind: rec.kind || 'externalRef',
        });
      }
    } catch { /* not valid json — fall through */ }
  }

  // CSV (camt.053 export or bank wire export)
  if (!records.length && (trimmed.includes(',') || trimmed.includes('\t'))) {
    const lines = trimmed.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const header = lines[0].split(/[,\t]/).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
      const colIdx = (names) => header.findIndex(h => names.some(n => h.includes(n)));
      const ix = {
        ref: colIdx(['externalref', 'reference', 'ref', 'acctsvcrref', 'txid', 'transactionid']),
        amount: colIdx(['amount', 'value', 'total', 'amt']),
        currency: colIdx(['currency', 'ccy', 'cur']),
        dest: colIdx(['rib', 'iban', 'destination', 'account', 'beneficiaryaccount']),
        remitter: colIdx(['remitter', 'sender', 'remittingbank', 'remittancedetails']),
        date: colIdx(['bookdate', 'valuedate', 'occurredat', 'date', 'bookgdt']),
        note: colIdx(['description', 'note', 'remittanceinfo', 'narrative', 'details']),
      };
      for (const line of lines.slice(1)) {
        const v = line.split(/[,\t]/).map(s => s.replace(/^"|"$/g, '').trim());
        const get = (i) => i !== undefined && i >= 0 ? v[i] : undefined;
        records.push({
          externalRef: get(ix.ref),
          amount: get(ix.amount),
          currency: (get(ix.currency) || 'USD').toString().toUpperCase(),
          destination: get(ix.dest),
          remitter: get(ix.remitter),
          bookDate: get(ix.date),
          note: get(ix.note),
          proofFile: filename,
          kind: 'csv_bank_export',
        });
      }
    }
  }

  // Plain text MT103 fragment (greedy regex)
  if (!records.length) {
    const re = /(?:UETR|UETI|Transaction Ref|Reference)[:\s]*([A-Z0-9\-]{16,32})/gi;
    let m;
    while ((m = re.exec(trimmed)) !== null) {
      const amtRe = /(?:Amount|Value)[:\s]*([0-9.,]+)\s*([A-Z]{3})/i.exec(trimmed.slice(Math.max(0, m.index - 200), m.index + 200));
      records.push({
        externalRef: m[1],
        amount: amtRe ? amtRe[1] : undefined,
        currency: amtRe ? amtRe[2].toUpperCase() : undefined,
        destination: OWNER_RIBS.includes(trimmed) ? trimmed : undefined,
        proofFile: filename,
        kind: 'mt103_fragment',
        note: 'parsed from text snapshot',
      });
    }
  }

  // Normalize amount to Number
  for (const r of records) {
    if (r.amount !== undefined && typeof r.amount !== 'number') {
      r.amount = Number(String(r.amount).replace(/[ ,]+/g, '').replace(/[^\d.]/g, ''));
    }
  }

  return records;
}

// ── RIB matching helper ──────────────────────────────────────────────────
function ribMatches(dest) {
  if (!dest) return false;
  const d = String(dest).replace(/\s+/g, '');
  if (OWNER_RIBS.includes(d)) return true;
  return OWNER_RIB_SUFFIXES.some(s => d.endsWith(s));
}

// ── Main flow ────────────────────────────────────────────────────────────
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  await c.connect();

  // 1. Gather receipts
  const fileParam = arg('file', '');
  const dirParam = arg('dir', INBOX);
  let files = [];
  if (fileParam) files = [resolve(fileParam)];
  else if (existsSync(dirParam)) {
    files = readdirSync(dirParam)
      .filter(f => /\.(json|csv|txt|xml|mt103)$/i.test(f))
      .map(f => resolve(dirParam, f));
  }
  if (!files.length) {
    console.log(JSON.stringify({ ok: true, filesScanned: 0, receiptsParsed: 0, matched: 0, unmatched: 0, note: 'empty_inbox' }));
    process.exit(0);
  }

  // 2. Parse all receipts
  const receipts = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    receipts.push(...parseReceipt(text, f));
  }
  if (!receipts.some(r => r.externalRef)) {
    console.log(JSON.stringify({ ok: false, error: 'no_parseable_receipts', files }));
    process.exit(2);
  }

  // 3. Pull unsettled worklist from DB
  const settlements = (await c.query(
    `SELECT id, amount, status, currency, "externalRef", "destinationLabel"
     FROM "OwnerSettlement"
     WHERE status = 'needs_manual_proof'`
  )).rows;
  const revenues = (await c.query(
    `SELECT id, source, amount, status, currency, "referenceId"
     FROM "RevenueEvent"
     WHERE status IN ('pending', 'PENDING_REASONING')`
  )).rows;

  // 4. Exact-match each receipt against worklist
  const matches = [];
  const unmatched = [];

  for (const rec of receipts) {
    const amt = rec.amount ? Number(rec.amount) : null;
    const dstOk = ribMatches(rec.destination);
    const ref = String(rec.externalRef || '').trim();

    let hit = null;
    let matchType = null;

    // (a) exact externalRef match against settlement refs
    const refHit = settlements.find(s => s.externalRef && String(s.externalRef).trim() === ref)
      || revenues.find(r => r.referenceId && String(r.referenceId).trim() === ref);
    if (refHit) { hit = refHit; matchType = 'EXACT_REF'; }

    // (b) exact amount+currency+RIB match, no fabricated amounts
    if (!hit && amt && rec.currency) {
      const amtSettlements = settlements
        .filter(s => Number(s.amount) === amt && (s.currency || 'USD') === rec.currency && dstOk);
      const amtRevenues = revenues
        .filter(r => Number(r.amount) === amt && (r.currency || 'USD') === rec.currency && dstOk);
      if (amtSettlements.length === 1) { hit = amtSettlements[0]; matchType = 'EXACT_AMOUNT_RIB'; }
      else if (amtRevenues.length === 1) { hit = amtRevenues[0]; matchType = 'EXACT_AMOUNT_RIB'; }
      else if (amtSettlements.length + amtRevenues.length > 1) {
        unmatched.push({ receipt: rec, reason: 'multiple_candidates_same_amount', candidates: [...amtSettlements, ...amtRevenues].map(x => x.id) });
        continue;
      }
    }

    if (hit) {
      matches.push({
        proofFile: rec.proofFile,
        kind: rec.kind,
        externalRef: ref,
        amount: amt,
        currency: rec.currency,
        destination: rec.destination,
        matchType,
        entityType: hit.hasOwnProperty('source') ? 'RevenueEvent' : 'OwnerSettlement',
        entityId: hit.id,
        bookDate: rec.bookDate || null,
        note: rec.note || null,
      });
    } else {
      unmatched.push({ receipt: rec, reason: dstOk ? 'no_amount_or_ref_match' : 'destination_not_owner_rib' });
    }
  }

  // 5. Report
  const report = {
    at: new Date().toISOString(),
    engine: 'inbound-scout',
    filesScanned: files.length,
    receiptsParsed: receipts.length,
    matched: matches.length,
    unmatched: unmatched.length,
    matches,
    unmatched,
    note: 'FAIL-CLOSED: Stage only. Apply via attestation after integrity verification. Never mark settled from this report alone.',
  };

  writeFileSync(resolve(OUT, 'inbound-scout-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    filesScanned: files.length,
    receiptsParsed: receipts.length,
    matched: matches.length,
    unmatched: unmatched.length,
  }, null, 2));

  if (matches.length) {
    console.log('\n=== STAGED MATCHES (awaiting attestation) ===');
    for (const m of matches) console.log(`${m.matchType} | ${m.entityType}:${m.entityId} | ${m.amount} ${m.currency} | ref=${m.externalRef} | file=${m.proofFile}`);
  }
  if (unmatched.length) {
    console.log('\n=== UNMATCHED ===');
    for (const u of unmatched) console.log(`ref=${u.receipt.externalRef} | ${u.receipt.amount} ${u.receipt.currency} | dst=${u.receipt.destination} | ${u.reason}`);
  }
}

run().finally(() => c.end());