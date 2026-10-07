#!/usr/bin/env node
/**
 * ============================================================================
 * R2/R3/R4 HARDENING SCAN — coverage-aware, fail-closed gate
 * ============================================================================
 * Implements the Agent R2 / R3 / R4 template against the real repository.
 *
 * The cardinal rule this script exists to enforce:
 *
 *     "0 findings" and "NOT_RUN" are different claims.
 *
 * A rule whose input columns do not exist returns NOT_RUN. A directory with
 * no compliance marker reports certificates_found: 0 and entities_tagged: N
 * — never "0 violations", which would assert a health check that never ran.
 *
 * Exit codes:
 *   0  every rule ran AND every rule passed
 *   1  at least one rule FAILed
 *   2  no rule FAILed, but at least one rule did not run (fail closed)
 *
 * Usage:
 *   node scripts/r-hardening-scan.mjs           # human-readable + exit code
 *   node scripts/r-hardening-scan.mjs --json    # machine-readable verdict
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');

/** status: PASS | FAIL | NOT_RUN */
const R = (id, status, reason, extra = {}) => ({ id, status, reason, ...extra });
const rel = (p) => p.replace(ROOT + '/', '').replace(ROOT + '\\', '');

function sha256(file) {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
  catch { return null; }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* ---------------------------------------------------------------- R2 ----- */
/* Revocation scope: only report revocation for credentials that exist.      */
function ruleR2Revocation() {
  const found = [];

  // 1. Prisma datasource url
  const schemaPath = join(ROOT, 'prisma', 'schema.prisma');
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, 'utf8');
    const urlLine = schema.match(/^\s*url\s*=\s*(.+)$/m);
    if (urlLine) found.push({ where: 'prisma/schema.prisma', target: 'datasource url' });
  }

  // 2. Environment credentials
  const ENV_PAT = /^(DATABASE_URL|NEON_.*|SUPABASE_.*|BASE44_.*|STRIPE_.*|RESEND_.*|VERCEL_.*(TOKEN|KEY|ID)|.*_API_KEY|.*_TOKEN|PUTER_AUTH_TOKEN)$/;
  for (const name of Object.keys(process.env)) {
    if (ENV_PAT.test(name) && process.env[name]) found.push({ where: 'env', target: name });
  }

  // 3. .env* files
  for (const cand of ['.env', '.env.local', '.env.production']) {
    const p = join(ROOT, cand);
    if (existsSync(p)) found.push({ where: cand, target: 'file' });
  }

  if (found.length === 0) {
    return R('r2_token_revocation', 'NOT_RUN',
      'no third-party credential configured; nothing to revoke', { credentials_found: 0, credentials_revoked: 0 });
  }
  return R('r2_token_revocation', 'NOT_RUN',
    `${found.length} credential source(s) located; revocation requires owner authority (irreversible)`,
    { credentials_found: found.length, credentials_revoked: 0, inventory: found });
}

function ruleR2Registry() {
  return R('r2_registry_confrontation', 'NOT_RUN',
    'official State registry endpoint + credential not provided (FR SIRENE vs MA Registre du Commerce unresolved)',
    { step1: 'NOT_RUN' });
}

function ruleR2EID() {
  return R('r2_certified_eid', 'NOT_RUN',
    'no QWAC/QSEAL certificate available locally', { step2: 'NOT_RUN' });
}

/* ---------------------------------------------------------------- R3 ----- */
const CERT_PAT = /conformit[ée]|certificat|\bcertif(?:ication|ied)\b/i;
// Code that *mentions* conformity is not a certificate. Only document
// formats can carry proof; generators/manifests are excluded by design.
const DOC_EXT = new Set(['.md', '.txt', '.pdf', '.json', '.csv', '.html']);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.yml', '.yaml', '.sh', '.ps1']);

function ruleR3CertificateScan() {
  const dir = join(ROOT, 'audit', 'legal');
  if (!existsSync(dir)) {
    return R('r3_certificate_scan', 'FAIL', 'target directory audit/legal/ does not exist', { entities_total: 0 });
  }
  const files = walk(dir);
  const inventory = files.map((f) => ({ path: rel(f), size: statSync(f).size, sha256: sha256(f) }));

  // Code/generator files are not compliance entities; count them as excluded
  // rather than silently letting them satisfy (or fail) the certificate check.
  const ext = (f) => {
    const i = f.lastIndexOf('.');
    return i < 0 ? '' : f.slice(i).toLowerCase();
  };
  const documents = files.filter((f) => !CODE_EXT.has(ext(f)));
  const excluded = files.filter((f) => CODE_EXT.has(ext(f))).map(rel);
  const unsupported = documents.filter((f) => !DOC_EXT.has(ext(f))).map(rel);

  let certFound = 0;
  const suspects = [];
  for (const f of documents) {
    const e = ext(f);
    let body = '';
    if (e === '.pdf') {
      suspects.push(rel(f));           // binary: proof not machine-readable
      continue;
    }
    try { body = readFileSync(f, 'utf8'); } catch { body = ''; }
    if (body && CERT_PAT.test(body)) certFound++;
    else suspects.push(rel(f));
  }

  const complete = documents.length > 0 && certFound === documents.length;
  return R('r3_certificate_scan', complete ? 'PASS' : 'FAIL',
    `certificates_found: ${certFound}/${documents.length} documents; ` +
    `[SUSPECT]: ${suspects.length}; excluded_non_document: ${excluded.length}; unreadable: ${unsupported.length}`,
    {
      documents_total: documents.length,
      certificates_found: certFound,
      entities_tagged: suspects.length,
      suspects,
      excluded_non_document: excluded,
      unreadable: unsupported,
      inventory,
    });
}

function ruleR3QuarantineDir() {
  const q = join(ROOT, 'quarantine', 'legal');
  if (existsSync(q)) {
    return R('r3_quarantine_ready', 'PASS', 'quarantine/legal/ exists', { held: walk(q).length });
  }
  return R('r3_quarantine_ready', 'NOT_RUN',
    'quarantine/legal/ absent (created only on first confirmed move; no threat confirmed yet)', { held: 0 });
}

/* ---------------------------------------------------------------- R4 ----- */
const DOMAIN_COL = /\b(domain|url|website|hostname|host)\b/i;
const GEO_COL = /\b(ip|geo|latitude|longitude|city|region|country|address|seat)\b/i;

function loadCsvHeaders(file) {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return null;
  return { header: lines[0].split(',').map((h) => h.trim()), rows: lines.length - 1 };
}

function ruleR4DomainSpoofing() {
  const src = loadCsvHeaders(join(ROOT, 'data', 'local-suppliers-2026-09-01.csv'));
  if (!src) return R('r4_domain_spoofing', 'NOT_RUN', 'source CSV absent', { entities_evaluated: 0 });
  if (!DOMAIN_COL.test(src.header.join(' '))) {
    return R('r4_domain_spoofing', 'NOT_RUN',
      `no domain column in source (header: ${src.header.join(',')})`, { entities_evaluated: 0, rows_available: src.rows });
  }
  return R('r4_domain_spoofing', 'NOT_RUN', 'domain column present but no registered-domain dataset bound', { entities_evaluated: 0 });
}

function ruleR4GeoContradiction() {
  const src = loadCsvHeaders(join(ROOT, 'data', 'local-suppliers-2026-09-01.csv'));
  if (!src) return R('r4_geo_contradiction', 'NOT_RUN', 'source CSV absent', { entities_evaluated: 0 });
  if (!GEO_COL.test(src.header.join(' '))) {
    return R('r4_geo_contradiction', 'NOT_RUN',
      `no IP/geo/seat column in source (header: ${src.header.join(',')})`, { entities_evaluated: 0, rows_available: src.rows });
  }
  return R('r4_geo_contradiction', 'NOT_RUN', 'geo column present but no hosting dataset bound', { entities_evaluated: 0 });
}

/* ------------------------------------------------------------- verdict ---- */
function main() {
  const rules = [
    ruleR2Revocation(), ruleR2Registry(), ruleR2EID(),
    ruleR3CertificateScan(), ruleR3QuarantineDir(),
    ruleR4DomainSpoofing(), ruleR4GeoContradiction(),
  ];

  const counts = { PASS: 0, FAIL: 0, NOT_RUN: 0 };
  for (const r of rules) counts[r.status]++;

  const failed = counts.FAIL > 0;
  const unrun = counts.NOT_RUN > 0;
  const exitCode = failed ? 1 : unrun ? 2 : 0;

  const verdict = failed ? 'REJECT'
    : unrun ? 'REJECT (fail closed: unverified)'
    : 'ACCEPT';

  const summary = {
    verdict,
    exitCode,
    counts,
    coverage_note: counts.NOT_RUN > 0
      ? `${counts.NOT_RUN} rule(s) did not execute. 0 findings elsewhere does NOT imply compliance.`
      : 'all rules executed',
    rules,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('R2/R3/R4 HARDENING SCAN — fail-closed');
    console.log('='.repeat(64));
    for (const r of rules) {
      const tag = r.status === 'PASS' ? '  ok  ' : r.status === 'FAIL' ? ' FAIL ' : 'NRUN ';
      console.log(`[${tag}] ${r.id}`);
      console.log(`         ${r.reason}`);
    }
    console.log('='.repeat(64));
    console.log(`PASS ${counts.PASS} | FAIL ${counts.FAIL} | NOT_RUN ${counts.NOT_RUN}`);
    console.log(`verdict: ${verdict}`);
    console.log(summary.coverage_note);
  }
  process.exit(exitCode);
}

main();
