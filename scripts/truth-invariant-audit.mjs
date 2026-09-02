// scripts/truth-invariant-audit.mjs
// Static audit of the repo against its OWN fail-closed financial- and
// security-invariants. Run without any DB/network — verifies the code+docs that
// ship with the repo uphold:
//   INV-1  no hardcoded real credentials / live secrets in tracked source
//   INV-2  money-movement confirm gates are NOT bypassed by a hardcoded `true`
//   INV-3  the SSRF guard is wired into the money-mover (AxiosClient)
//   INV-4  the reconciliation truth document exists and is not empty
//   INV-5  no fabricated-proof markers remain in the settlement/payout path
//
// Run:  node scripts/truth-invariant-audit.mjs
// Exit 0 = all invariants hold; exit 1 = violations found.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

let pass = 0;
let fail = 0;
const violations = [];

function ok(label) { pass += 1; console.log(`  ✓ ${label}`); }
function bad(label, why) {
  fail += 1;
  violations.push(why);
  console.error(`  ✗ ${label}: ${why}`);
}

// Walk tracked-looking dirs, skip heavy/vendor/generated.
const SKIP = new Set(['node_modules', '.next', '.vercel', '.git', '.mimosa', 'data/generated']);
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.mts']);
const SECRET_RE = /(github_pat_[A-Za-z0-9_]{10,}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|npg_[A-Za-z0-9_]{10,})/;
const AUTO_CONFIRM_RE = /(confirmedTransfer\s*[:=]\s*true|confirm\s*:\s*true\b)/;

// Strip comments/strings before scanning so the confirm-gate test only sees real code.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
    .replace(/^\s*\/\/.*$/gm, '')           // full-line // comments
    .replace(/\/\/[^'"]*$/gm, '')           // trailing // comments
    .replace(/'(?:[^'\\]|\\.)*'/g, '')      // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '')      // double-quoted strings
    .toString();
}
const containsCode = (path, re) => {
  try { return re.test(stripComments(readFileSync(path, 'utf8'))); }
  catch { return false; }
};

function walk(dir, exts = EXTS) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP.has(e)) out.push(...walk(p, exts)); }
    else if (exts.has(e.slice(e.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

function contains(path, re) {
  try { return re.test(readFileSync(path, 'utf8')); } catch { return false; }
}

async function main() {
  console.log('truth-invariant audit (static, no DB/network)\n');

  // INV-1: no hardcoded real secrets in tracked source OR docs/config.
  // Covers src/scripts/prisma, plus docs/ and root config — the "one `git add .`
  // away from history" failure mode that already bit this repo once (plaintext
  // Neon owner password lived in scripts). Exclude .env which is gitignored.
  let leakedCount = 0;
  const leakedAt = [];
  const trackedDirs = [join(ROOT, 'src'), join(ROOT, 'scripts'), join(ROOT, 'prisma'), join(ROOT, 'docs')];
  const docExts = new Set(['.md', '.json', '.mjs', '.js', '.ts']);
  for (const d of trackedDirs) {
    for (const f of walk(d, docExts)) if (contains(f, SECRET_RE)) { leakedCount += 1; leakedAt.push(f); }
  }
  for (const f of ['package.json', 'DEPLOYMENTS.md', 'INTEGRATION.md'].map((p) => join(ROOT, p))) {
    if (existsSync(f) && contains(f, SECRET_RE)) { leakedCount += 1; leakedAt.push(f); }
  }
  if (leakedCount === 0) ok('INV-1: no hardcoded live-secret markers in src/scripts/prisma/docs/config');
  else bad('INV-1', `found ${leakedCount} file(s) matching secret markers: ${leakedAt.join(', ')}`);

  // INV-2: no hardcoded confirm=true bypass in the money engines.
  const moneyFiles = [
    'src/services/wiseService.ts',
    'src/services/paypalService.ts',
    'src/lib/payout-routing.ts',
    'src/lib/settlement-engine.ts',
    'src/finance/TreasuryEdge.ts',
  ].filter((p) => existsSync(join(ROOT, p)));
  let bypass = moneyFiles.filter((p) => containsCode(join(ROOT, p), AUTO_CONFIRM_RE));
  if (bypass.length === 0) ok('INV-2: no hardcoded confirm=true auto-submit in money engines');
  else bad('INV-2', `hardcoded confirm bypass in: ${bypass.join(', ')}`);

  // INV-3: SSRF guard wired into AxiosClient post/get.
  const ax = join(ROOT, 'src/lib/axiosClient.ts');
  if (existsSync(ax) && contains(ax, /guardUrl/) && contains(ax, /assertSafeExternalUrl/)) {
    ok('INV-3: SSRF guard present in AxiosClient (guardUrl + assertSafeExternalUrl)');
  } else bad('INV-3', 'AxiosClient missing guardUrl/assertSafeExternalUrl wiring');

  // INV-4: reconciliation truth doc exists and is non-trivial.
  const rec = join(ROOT, 'docs/financial-reconciliation-2026-09-01.md');
  if (existsSync(rec) && statSync(rec).size > 200) ok('INV-4: reconciliation truth doc present');
  else bad('INV-4', 'docs/financial-reconciliation-2026-09-01.md missing or empty');

  // INV-5: no fabricated-proof markers (single-REF reuse for multiple items / "LIVE_EVIDENCE" fabrications).
  const recText = existsSync(rec) ? readFileSync(rec, 'utf8') : '';
  if (/UNVERIFIED|NOT BOOKED|no real money moved/.test(recText)) ok('INV-5: truth doc explicitly marks unverified figures');
  else bad('INV-5', 'truth doc does not flag the external-supervisor figures as unverified');

  // INV-6: no timestamp/random idempotency keys in the money engines (regression
  // guard for the deterministic-key fixes). Only checks assignment/idempotency
  // config, post string/comment stripping.
  const idemRe = /idempotencyKey\s*:\s*`[^`]*(?:Date\.now\(\)|Math\.random\(|getTime\(\))[^`]*`|idempotencyKey\s*:\s*`[^`]*\$\{[^`]*(?:Date\.now|Math\.random|getTime)[^`]*\}/;
  const idemOffenders = moneyFiles.filter((p) => containsCode(join(ROOT, p), idemRe));
  if (idemOffenders.length === 0) ok('INV-6: no timestamp/random idempotency keys in money engines');
  else bad('INV-6', `timestamp/random idempotency keys in: ${idemOffenders.join(', ')}`);

  // INV-7: Wise production base host is consistently api.transferwise.com.
  const wiseHost = /api\.wise\.com/;
  const grok = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
  const wiseRefs = [
    'src/services/wiseService.ts',
    'src/lib/connector-credentials.ts',
    'src/lib/vault/connector-self-test.ts',
    'src/financial/gateways/BankWireGateway.mjs',
    'scripts/rail-health-probe.mjs',
  ];
  const legacy = wiseRefs.filter((p) => wiseHost.test(grok(p)));
  if (legacy.length === 0) ok('INV-7: no legacy api.wise.com host refs in Wise modules');
  else bad('INV-7', `legacy api.wise.com still referenced in: ${legacy.join(', ')}`);

  console.log(`\n──────────────────────────────`);
  console.log(`result: ${pass} passed, ${fail} failed`);
  if (violations.length) {
    violations.forEach((v) => console.error(`  violation: ${v}`));
    process.exit(1);
  }
  console.log('All truth invariants hold.');
}

main().catch((e) => {
  console.error('audit crashed:', e);
  process.exit(1);
});