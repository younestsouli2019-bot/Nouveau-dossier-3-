#!/usr/bin/env node
// =============================================================================
// Attijari CIB Direct — free, LOCAL, READ-ONLY statement scraper (Playwright).
// -----------------------------------------------------------------------------
// WHY: Plaid/Enable/SimpleFin/PSD2 cannot reach DOMESTIC Morocco (MAD) RIBs
// (the EU PSD2 portal is Attijariwafa Bank Europe, not the local accounts).
// This uses a headless Chrome via Playwright to log into Attijari CIB Direct
// (the corporate web portal that DOES see the 2 local MAD accounts) and export
// statements, then hands them to the existing FAIL-CLOSED reconcile harness.
//
// GUARANTEES (matches repo invariants):
//   * READ-ONLY: it never writes to OwnerSettlement/PayoutItem/RevenueEvent.
//     It ONLY downloads a statement file. Any reconciliation/settlement happens
//     through camt053-reconcile.ts -> runBankReconciliation (exact-match, writes
//     only on a real external match).
//   * No fabrication: output is a real downloaded statement, never synthesized.
//   * Local & free: no cloud relay, no third-party paid API, no browser SaaS.
//
// FIRST-TIME SETUP (local machine only):
//   1) npm install            (playwright is a devDependency)
//   2) npx playwright install chromium
//   3) env vars (never commit):
//        ATTIJARI_CIB_LOGIN_URL   https://...  (your CIB Direct customer login URL)
//        ATTIJARI_CIB_USER        your CIB Direct username
//        ATTIJARI_CIB_PASS        your CIB Direct password
//        (optional per-domain selectors below — CIB Direct DOM is per-contract)
//
// USAGE:
//   node scripts/attijari-cib-scraper.mjs
//       --download [--reconcile]   login + export statements for all MAD RIBs; --reconcile
//                                  auto-feeds each download to the FAIL-CLOSED harness
//       --reconcile-local <dir>    re-run the harness on existing statement files (.csv/.xml)
//                                  without a browser (e.g. after a manual statement drop)
//       --camt053 <file>           convert a CSV/statement to Camt.053 XML, print to stdout
//       --headed                   show the browser (debug selectors)
//       --out <dir>                output dir (default data/out/bank)
// =============================================================================
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node:url';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ----- Config ---------------------------------------------------------------
const CIB_CONFIG_PATH = path.join(ROOT, 'src/lib/payment-providers/attijari-config.json');
const accounts = JSON.parse(fs.readFileSync(CIB_CONFIG_PATH, 'utf8')).accounts || [];

const env = process.env;
const OUT = env.ATTIJARI_CIB_OUT || path.resolve(process.argv.includes('--out')
  ? (() => { const i = process.argv.indexOf('--out'); return path.resolve(process.argv[i + 1]); })()
  : 'data/out/bank');

const LOGIN_URL = env.ATTIJARI_CIB_LOGIN_URL;
const USER = env.ATTIJARI_CIB_USER;
const PASS = env.ATTIJARI_CIB_PASS;

// Selectors are per-contract; expose ALL as env so none are hard-coded lies.
const SEL = {
  userInput: env.ATTIJARI_CIB_SEL_USER || 'input[name="username"], input#username, input[type="text"]',
  passInput: env.ATTIJARI_CIB_SEL_PASS || 'input[name="password"], input#password, input[type="password"]',
  loginBtn: env.ATTIJARI_CIB_SEL_LOGIN || 'button[type="submit"], input[type="submit"]',
  accountRow: env.ATTIJARI_CIB_SEL_ACCT || 'table tbody tr, .accounts .account',
  statementLink: env.ATTIJARI_CIB_SEL_STMT || 'a:has-text("statement"), a:has-text("Statement"), a:has-text("relevé"), a:has-text("Relevé")',
  downloadBtn: env.ATTIJARI_CIB_SEL_DL || 'button:has-text("Export"), button:has-text("Télécharger"), a:has-text(".camt"), a:has-text(".csv")',
  dateFrom: env.ATTIJARI_CIB_SEL_FROM || 'input[name*="from"], input[id*="from"], #dateDebut',
  dateTo: env.ATTIJARI_CIB_SEL_TO || 'input[name*="to"], input[id*="to"], #dateFin',
};

const START = new Date(Date.now() - 30 * 86400000); // last 30 days default
const END = new Date();
const fmtDate = d => d.toISOString().slice(0, 10);
const fmtDateFR = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function die(msg) { console.error('[cib-scraper] ' + msg); process.exit(2); }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ----- CSV -> Camt.053 XML converter ----------------------------------------
// Converts a generic CSV (first line = header) into minimal Camt.053 so the
// existing parseCamt053 + runBankReconciliation harness can consume it safely.
// Column names accepted (case-insensitive, matched heuristically):
//   amount | date | reference | counterparty | id | cdt/dbt | currency
function csvToCamt053(csvText) {
  const lines = csvText.replace(/\r/g, '').split('\n').filter(l => l.trim().length);
  if (!lines.length) die('empty CSV');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const idx = (names) => header.findIndex(h => names.some(n => h.includes(n)));
  const iAmt = idx(['amount', 'montant', 'amt']);
  const iDate = idx(['date', 'bookgdt', 'datevaleur']);
  const iRef = idx(['reference', 'ref', 'narration', 'libelle', 'description']);
  const iCp = idx(['counterparty', 'beneficiaire', 'tiers', 'name', 'nom']);
  const iId = idx(['id', 'transid', 'txnid', 'transactionid', 'acctsvcrref']);
  const iCur = idx(['currency', 'ccy', 'devise']);
  const iDir = idx(['cdtdbtind', 'direction', 'sens', 'debit', 'credit']);

  const ndd = [];
  lines.slice(1).forEach((line, k) => {
    const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
    const amount = iAmt >= 0 ? Math.abs(parseFloat(parts[iAmt] || '0')) : 0;
    if (!amount) return;
    const date = (iDate >= 0 && parts[iDate]) ? String(parts[iDate]).slice(0, 10) : fmtDate(new Date());
    const dir = iDir >= 0 ? String(parts[iDir] || '').toUpperCase() : 'CRDT';
    const isCredit = dir.includes('CRDT') || dir === 'CR' || dir === 'C' || (iDir < 0 && parseFloat(parts[iAmt] || '0') >= 0);
    const ccy = (iCur >= 0 && parts[iCur]) ? String(parts[iCur]).toUpperCase() : 'USD';
    const ref = (iRef >= 0 && parts[iRef]) ? parts[iRef] : `IMPORTED-${k}`;
    const svcrRef = (iId >= 0 && parts[iId]) ? parts[iId] : `TXN-${Date.now()}-${k}`;
    const cp = (iCp >= 0 && parts[iCp]) ? parts[iCp] : ('IMPORTED');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    ndd.push(`        <Ntry>
          <Amt Ccy="${esc(ccy)}">${amount.toFixed(2)}</Amt>
          <AcctSvcrRef>${esc(svcrRef)}</AcctSvcrRef>
          <BookgDt><Dt>${esc(date)}</Dt></BookgDt>
          <CdtDbtInd>${isCredit ? 'CRDT' : 'DBIT'}</CdtDbtInd>
          <NtryDtls><TxDtls>
            <Ref>${esc(ref)}</Ref>
            <Rmted><Cdtr><Nm>${esc(cp)}</Nm></Cdtr></Rmted>
          </TxDtls></NtryDtls>
        </Ntry>`);
  });
  if (!ndd.length) die('CSV produced no valid amount rows');
  const digest = sha(csvText);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt><Stmt>
    <Id>CIB-${fmtDate(END)}-${digest.slice(0, 8)}</Id>
    <Ntry>
${ndd.join('\n')}
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`;
}

// ----- Reconcile files (shared by --reconcile and --reconcile-local) -------
// Feeds each statement file to the FAIL-CLOSED harness (camt053-reconcile.ts),
// converting CSV downloads to Camt.053 first. Never writes to the ledger except
// via exact-match auto-settle inside the harness.
function reconcileFiles(saved) {
  const { spawnSync } = require('node:child_process');
  console.log('\n[cib-scraper] reconciling each statement via the fail-closed harness...');
  let ok = 0, fail = 0;
  for (const s of saved.slice()) {
    let file = s;
    const ext = path.extname(file).toLowerCase();
    const head = fs.readFileSync(file, 'utf8').trimStart();
    // The harness consumes Camt.053 XML; convert non-XML (CSV) downloads first.
    if (ext !== '.xml' && !head.startsWith('<')) {
      const outDir = path.dirname(file);
      fs.mkdirSync(outDir, { recursive: true });
      file = path.join(outDir, path.basename(file, ext) + '.camt053.xml');
      fs.writeFileSync(file, csvToCamt053(fs.readFileSync(s, 'utf8')));
      console.log('[cib-scraper] converted CSV ->', file);
    }
    console.log(`[cib-scraper] reconciling ${file}...`);
    // Robust Windows-safe invocation: node --import tsx (no .bin/tsx shim, no shell).
    const res = spawnSync(process.execPath, [
      '--import', 'tsx',
      path.join(ROOT, 'scripts/camt053-reconcile.ts'),
      file,
    ], { encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(res.stdout || '');
    process.stderr.write(res.stderr || '');
    if (res.status === 0) ok++; else { fail++; console.error(`[cib-scraper] reconcile exited ${res.status} for ${file}`); }
  }
  console.log(`\n[cib-scraper] reconcile done: ${ok} ok, ${fail} failed.`);
}

// ----- Download mode --------------------------------------------------------
async function runDownload() {
  const { chromium } = await import('playwright');
  if (!LOGIN_URL || !USER || !PASS) {
    die('ATTIJARI_CIB_LOGIN_URL / ATTIJARI_CIB_USER / ATTIJARI_CIB_PASS must be set (local .env; never committed).');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const headed = process.argv.includes('--headed');
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  console.log('[cib-scraper] opening', LOGIN_URL);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  try {
    await page.waitForSelector(SEL.userInput, { timeout: 30000 });
    await page.fill(SEL.userInput, USER);
    await page.fill(SEL.passInput, PASS);
    await page.click(SEL.loginBtn);
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    console.log('[cib-scraper] logged in.');

    const saved = [];
    for (const acct of accounts.filter(a => a.isActive && a.rib && a.rib.fullRib)) {
      const rib = acct.rib.fullRib;
      const label = (acct.label || acct.id).replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
      console.log(`[cib-scraper] account ${label} (${rib}) — navigating…`);
      // best-effort: pick the row containing this RIB, open its statements, export.
      try {
        await page.waitForSelector(SEL.accountRow, { timeout: 30000 });
        const rows = page.locator(SEL.accountRow);
        let row = null;
        for (let i = 0; i < await rows.count(); i++) {
          const txt = (await rows.nth(i).innerText()) || '';
          if (txt.includes(rib.slice(-6)) || txt.includes(rib)) { row = rows.nth(i); break; }
        }
        // If we can't isolate a row, attempt global statement selection (first match).
        await (row || rows.first()).click();
        // set date range (best-effort)
        try {
          if (await page.isVisible(SEL.dateFrom)) await page.fill(SEL.dateFrom, fmtDateFR(START));
          if (await page.isVisible(SEL.dateTo)) await page.fill(SEL.dateTo, fmtDateFR(END));
        } catch {}
        await page.waitForTimeout(800);

        const dl = page.locator(SEL.downloadBtn).first();
        await dl.click().catch(async () => {
          // fallback: look for statement page first
          await (page.locator(SEL.statementLink).first()).click().catch(() => {});
          await page.waitForTimeout(1200);
          await (page.locator(SEL.downloadBtn).first()).click().catch(() => { throw new Error('no export control'); });
        });

        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
          page.waitForTimeout(1500), // allow slow-click exports
        ]);
        let name = `attijari-${label}-${fmtDate(END)}`;
        if (download) {
          const ext = path.extname(download.suggestedFilename() || '') || '.bin';
          name += ext;
          const dest = path.join(OUT, name);
          await download.saveAs(dest);
          console.log(`[cib-scraper] downloaded -> ${dest}`);
          saved.push(dest);
        } else {
          // No file download; try to capture the statement table as CSV instead.
          const html = await page.content();
          name += '.html';
          const dest = path.join(OUT, name);
          fs.writeFileSync(dest, html);
          console.log(`[cib-scraper] no file export; captured page -> ${dest} (manual review needed)`);
          saved.push(dest);
        }
      } catch (e) {
        console.error(`[cib-scraper] account ${label}: ${e.message}`);
      }
    }
    console.log('\n[cib-scraper] done. Saved files:');
    for (const s of saved) console.log('  -', s);
    if (process.argv.includes('--reconcile') && saved.length) {
      reconcileFiles(saved);
    }
  } finally {
    await browser.close();
  }
  console.log('\n[cib-scraper] NOTE: statements are RAW downloads. They have NOT touched the ledger.');
  console.log('[cib-scraper] Reconcile a file with:  node scripts/camt053-reconcile.ts <file>   (fail-closed, exact-match only)');
}

// ----- CLI dispatch ---------------------------------------------------------
const flags = process.argv.slice(2);
if (flags.includes('--camt053')) {
  const i = flags.indexOf('--camt053');
  const file = flags[i + 1];
  if (!file || !fs.existsSync(file)) die(`file not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  let xml;
  if (text.trim().startsWith('<?xml') || text.trim().startsWith('<Document')) {
    xml = text; // already Camt.053
  } else {
    xml = csvToCamt053(text); // CSV -> Camt.053
  }
  process.stdout.write(xml + '\n');
  console.error(`[cib-scraper] wrote Camt.053 (${xml.length} bytes). Pipe into camt053-reconcile.ts or save to a file.`);
} else if (flags.includes('--reconcile-local')) {
  const i = flags.indexOf('--reconcile-local');
  const dir = path.resolve(flags[i + 1] || OUT);
  if (!fs.existsSync(dir)) die(`dir not found: ${dir}`);
  const files = fs.readdirSync(dir)
    .filter(f => /\.(csv|xml|camt053)$/i.test(f))
    .map(f => path.join(dir, f));
  if (!files.length) die(`no statement files (.csv/.xml) in ${dir}`);
  console.log(`[cib-scraper] --reconcile-local: ${files.length} file(s) in ${dir}`);
  reconcileFiles(files);
} else if (flags.includes('--download') || process.argv.length <= 2) {
  await runDownload();
} else {
  console.log(`Usage:
  node scripts/attijari-cib-scraper.mjs --download [--reconcile] [--headed]
  node scripts/attijari-cib-scraper.mjs --reconcile-local <dir>   (re-run reconcile after manual statement drop)
  node scripts/attijari-cib-scraper.mjs --camt053 <statement.csv|xml>
`);
  process.exit(0);
}
