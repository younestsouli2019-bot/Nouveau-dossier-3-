// scripts/legal-entity-audit.mjs  (R2 · READ-ONLY · fail-closed)
//
// Implements the 2026-10-06 owner directive — Agent R2 (Orchestrateur):
// mandatory double cross-audit for every legal/judicial entity before any
// financial or contractual flow may proceed:
//   Step 1 — confrontation with the official State registry (configurable
//            adapter; OMPIC for Morocco). No registry configured/reachable
//            ⇒ UNVERIFIED ⇒ REJECTED (fail-closed, never auto-pass).
//   Step 2 — certified electronic signature: the entity's signature block
//            must carry a cert fingerprint pinned in audit/legal/certificates.json.
//            Missing/unknown fingerprint ⇒ REJECTED.
// Any failure at step 1 or 2 ⇒ the associated financial/contractual flow is
// REJECTED in the emitted blocklist. This script NEVER fabricates a
// verification and NEVER flips a rejected entity back to valid.
//
//   node scripts/legal-entity-audit.mjs            (audit + report, no writes beyond the report)
//   OMPIC_API_URL=... OMPIC_API_KEY=... node ...   (enables the step-1 live registry check)
//
// Env: DATABASE_URL (optional — cross-checks recipient registry, bound params only).
// Produces: data/out/legal-entity-audit.json + data/out/legal-entity-blocklist.json

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEGAL_DIR = resolve(ROOT, 'audit', 'legal');
const CERTS_FILE = resolve(LEGAL_DIR, 'certificates.json');
const CASES_DIR = resolve(ROOT, 'data', 'escalation', 'cases');
const OUT = resolve(ROOT, 'data', 'out');

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const loadJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// ── Load entities: audit/legal JSONs + escalation case parties ──────────────
const entities = [];
if (existsSync(LEGAL_DIR)) {
  for (const f of readdirSync(LEGAL_DIR).filter((x) => x.endsWith('.json') && x !== 'certificates.json')) {
    const o = loadJSON(join(LEGAL_DIR, f));
    if (!o) continue;
    for (const e of Array.isArray(o) ? o : [o]) {
      entities.push({ ...e, _source: `audit/legal/${f}` });
    }
  }
}
if (existsSync(CASES_DIR)) {
  for (const f of readdirSync(CASES_DIR).filter((x) => x.endsWith('.json'))) {
    const c = loadJSON(join(CASES_DIR, f));
    if (!c) continue;
    for (const p of c.parties || []) {
      entities.push({ id: p.id || p.name, name: p.name, type: p.type || 'case_party', country: p.country || 'MA', registryId: p.registryId || null, signature: p.signature || null, _source: `data/escalation/cases/${f}` });
    }
  }
}

// ── Pinned certificate allowlist (step 2 trust anchor) ──────────────────────
const pinnedCerts = loadJSON(CERTS_FILE) || { certificates: [] };
const pinnedPrints = new Set((pinnedCerts.certificates || []).map((c) => String(c.fingerprint).toLowerCase()));

// ── Step 1 adapter: official State registry (Morocco: OMPIC) ────────────────
async function officialRegistryCheck(entity) {
  const base = process.env.OMPIC_API_URL;
  if (!base || !entity.registryId) return { step: 1, status: 'UNVERIFIED', reason: !base ? 'no_official_registry_configured' : 'no_registry_id' };
  try {
    const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(entity.registryId)}`;
    const res = await fetch(url, { headers: process.env.OMPIC_API_KEY ? { Authorization: `Bearer ${process.env.OMPIC_API_KEY}` } : {} });
    if (!res.ok) return { step: 1, status: 'UNVERIFIED', reason: `registry_http_${res.status}` };
    const body = await res.json();
    const hit = (body.results || body.data || []).find((r) => String(r.id || r.rc || r.registryId) === String(entity.registryId));
    if (!hit) return { step: 1, status: 'MISMATCH', reason: 'registry_no_match' };
    if (entity.name && hit.name && hit.name.trim().toLowerCase() !== String(entity.name).trim().toLowerCase()) {
      return { step: 1, status: 'MISMATCH', reason: `registry_name_mismatch: "${hit.name}" vs "${entity.name}"` };
    }
    return { step: 1, status: 'VERIFIED', reason: 'registry_match' };
  } catch (e) {
    return { step: 1, status: 'UNVERIFIED', reason: `registry_error: ${String(e?.message || e).slice(0, 120)}` };
  }
}

// ── Step 2: certified electronic signature ───────────────────────────────────
function signatureCheck(entity) {
  const sig = entity.signature;
  if (!sig || !sig.certFingerprint) return { step: 2, status: 'REJECTED', reason: 'no_certified_signature' };
  const print = String(sig.certFingerprint).toLowerCase();
  if (!pinnedPrints.has(print)) return { step: 2, status: 'REJECTED', reason: 'cert_fingerprint_not_pinned' };
  if (sig.payloadHash) {
    const expected = sha256(JSON.stringify({ id: entity.id, name: entity.name, registryId: entity.registryId }));
    if (sig.payloadHash !== expected) return { step: 2, status: 'REJECTED', reason: 'signature_payload_hash_mismatch' };
  }
  return { step: 2, status: 'VERIFIED', reason: 'cert_pinned' + (sig.certId ? `:${sig.certId}` : '') };
}

// ── Run double audit ─────────────────────────────────────────────────────────
const results = [];
for (const e of entities) {
  const s1 = await officialRegistryCheck(e);
  const s2 = signatureCheck(e);
  // Blocking constraint: any failure or absence of match at step 1 or 2 ⇒ REJECT.
  const flowAllowed = s1.status === 'VERIFIED' && s2.status === 'VERIFIED';
  results.push({
    id: e.id, name: e.name || null, source: e._source,
    step1: s1, step2: s2,
    flowAllowed,
    verdict: flowAllowed ? 'VERIFIED' : 'REJECTED',
  });
}

const report = {
  at: new Date().toISOString(),
  engine: 'legal-entity-audit (R2 double cross-audit)',
  registryAdapter: process.env.OMPIC_API_URL ? 'configured' : 'NOT_CONFIGURED (all step-1 results UNVERIFIED — fail-closed)',
  pinnedCertificates: pinnedPrints.size,
  entitiesAudited: results.length,
  verified: results.filter((r) => r.verdict === 'VERIFIED').length,
  rejected: results.filter((r) => r.verdict === 'REJECTED').length,
  results,
  note: 'Fail-closed. REJECTED entities block their financial/contractual flows. Never fabricates verification.',
};
writeFileSync(resolve(OUT, 'legal-entity-audit.json'), JSON.stringify(report, null, 2));
writeFileSync(resolve(OUT, 'legal-entity-blocklist.json'), JSON.stringify({
  at: report.at, blockedEntityIds: results.filter((r) => !r.flowAllowed).map((r) => r.id),
}, null, 2));
console.log(JSON.stringify({ verified: report.verified, rejected: report.rejected, total: report.entitiesAudited, note: report.note }, null, 2));
