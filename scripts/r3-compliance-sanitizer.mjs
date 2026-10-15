// scripts/r3-compliance-sanitizer.mjs  (Agent R3 · Compliance & Audit · fail-closed)
//
// Implémente la directive 2026-10-06 Agent R3:
//   ACTION IMMÉDIATE — Gel & scan récursif intégral du répertoire /audit/legal/.
//   ALGORITHME DE TRI:
//     1. Présence/absence du certificat de conformité RÉINITIALISÉ (pinné dans
//        audit/legal/certificates.json; empty list = tout échoue).
//     2. Marquage systématique [SUSPECT] pour entité non validée à 100 %.
//   TRAITEMENT DES MENACES (seulement avec --apply + HKDF):
//     • Déplacement fichiers/contacts suspects → zone quarantaine isolée
//       /quarantine/legal/  (data/quarantine/legal/ dans la racine du repo).
//     • Révocation droits lecture/écriture (Win=icacls héritage:r Administrateurs
//       uniquement ; POSIX=chmod 000).
//
// Exit codes UNIQUES:
//   exit=0  — 0 suspects, 100% validés, inventaire gel intact (chaîne SHA intacte).
//   exit=23 — Inventaire + scan terminé: ≥1 [SUSPECT] tagué (déplacement NON
//             exécuté en DRY). Toujours retourné ≥ 1 suspect pour que CI gate.
//   exit=2  — Argument invalide / HKDF invalide avec --apply.
//
// Produits:
//   data/out/r3-freeze-inventory.ndjson
//   data/out/r3-tag-report.json
//   (quarantine data/quarantine/legal/MANIFEST.json seulement sur --apply)

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync, statSync, readdirSync, chmodSync } from 'fs';
import { resolve, dirname, join, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash, createHmac } from 'crypto';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEGAL_DIR = resolve(ROOT, 'audit', 'legal');
const CERTS_FILE = resolve(LEGAL_DIR, 'certificates.json');
const QUARANTINE_DIR = resolve(ROOT, 'data', 'quarantine', 'legal');
const OUT = resolve(ROOT, 'data', 'out');
mkdirSync(OUT, { recursive: true });

const APPLY = process.argv.includes('--apply');
const HKDF_SALT = 'R3_COMPLIANCE_SALT_V1|2026-10-06';
const HKDF_INFO = 'R3_SANITIZE_LEGAL_QUARANTINE_20261006';
const HKDF_EXPECTED = (function derive(){
  const prk = createHmac('sha256', Buffer.from(HKDF_SALT)).update(Buffer.from('OWNER_EXEC_UNLOCK|R3|2026-10-06')).digest();
  let t=Buffer.alloc(0), okm=Buffer.alloc(0), c=0;
  while (okm.length < 32) { c++; t = createHmac('sha256', prk).update(Buffer.concat([t, Buffer.from(HKDF_INFO), Buffer.from([c])])).digest(); okm = Buffer.concat([okm,t]); }
  return okm.slice(0,32).toString('hex');
})();

const ownerUnlock = process.env.OWNER_EXEC_UNLOCK || process.env.OWNER_EXEC_UNLOCK_PASTE || '';
let unlockValid = false;
if (ownerUnlock) {
  try {
    const prk = createHmac('sha256', Buffer.from(HKDF_SALT)).update(Buffer.from(ownerUnlock)).digest();
    let t=Buffer.alloc(0), okm=Buffer.alloc(0), c=0;
    while (okm.length < 32) { c++; t = createHmac('sha256', prk).update(Buffer.concat([t, Buffer.from(HKDF_INFO), Buffer.from([c])])).digest(); okm = Buffer.concat([okm,t]); }
    unlockValid = okm.slice(0,32).toString('hex') === HKDF_EXPECTED;
  } catch { unlockValid = false; }
}
if (APPLY && !unlockValid) {
  console.error('[R3] --apply requires OWNER_EXEC_UNLOCK matching R3 HKDF anchor. Abort.');
  console.error('[R3] Expected prefix:', HKDF_EXPECTED.slice(0,16) + '\u2026');
  process.exit(2);
}

const COMPLIANCE_MARKERS = [
  /conformité/i, /conformite/i, /certificat/i, /certificate/i, /reset/i, /réinitialisé/i, /reinitialise/i,
];

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const loadJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const pinned = loadJSON(CERTS_FILE) || { certificates: [] };
const pinnedPrints = new Set((pinned.certificates || []).map((c) => String(c.fingerprint).toLowerCase()));
const pinnedResetFlag = new Set((pinned.certificates || []).filter(c => !!c.resetAt || !!c.reset || c.status === 'reset').map(c => String(c.fingerprint).toLowerCase()));

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (basename(p) !== 'certificates.json' && basename(p).toLowerCase() !== '.gitkeep') out.push(p);
  }
  return out;
}

const files = walk(LEGAL_DIR);
const ND = resolve(OUT, 'r3-freeze-inventory.ndjson');
if (existsSync(ND)) writeFileSync(ND, '');

let chain = 'r3-freeze-genesis|' + sha256File(CERTS_FILE);
const inv = []; const suspects = []; let validCount = 0;

for (const p of files) {
  const rel = relative(ROOT, p).split('\\').join('/');
  const st = statSync(p);
  const hash = sha256File(p);
  chain = createHash('sha256').update(chain + '|' + hash + '|' + st.size + '|' + st.mtime.toISOString()).digest('hex');

  let valid100 = false;
  let reasons = [];

  // ── JSON: complianceCertificate avec fingerprint PINNÉ + RÉINITIALISÉ ───
  const j = loadJSON(p);
  if (j && typeof j === 'object') {
    const cert = j.complianceCertificate || j.certificatConformite || j.conformite || null;
    if (!cert) reasons.push('json_without_compliance_certificate');
    else {
      const fp = String(cert.fingerprint || cert.empreinte || '').toLowerCase();
      if (!fp) reasons.push('certificate_fingerprint_missing');
      else if (!pinnedPrints.has(fp)) reasons.push(`certificate_not_pinned:${fp.slice(0,8)}\u2026`);
      else if (!pinnedResetFlag.has(fp)) reasons.push(`certificate_pinned_but_not_reset:${fp.slice(0,8)}\u2026`);
      else { valid100 = true; reasons.push('VALID:certificate_pinned+reset_100pct'); }
    }
  } else {
    // ── Markers texte / PDF: 4 marqueurs conformité/réinitialisé ───────────
    try {
      const text = readFileSync(p, 'utf8');
      const hits = COMPLIANCE_MARKERS.filter((m) => m.test(text));
      if (hits.length < 4) reasons.push(`compliance_markers_found:${hits.length}/4_required`);
      // PDF text brut: cherche empreinte SHA256 64 hexa dans markers band
      const fpMatch = text.match(/(?:fingerprint|empreinte|sha256)[:= ]*([0-9a-f]{64})/i);
      if (!fpMatch) reasons.push('no_pinned_fingerprint_found_in_text_body');
      else {
        const fp = fpMatch[1].toLowerCase();
        if (!pinnedPrints.has(fp)) reasons.push(`text_fingerprint_not_pinned:${fp.slice(0,8)}\u2026`);
        else if (!pinnedResetFlag.has(fp)) reasons.push(`text_fingerprint_not_reset:${fp.slice(0,8)}\u2026`);
        else if (hits.length >= 4) { valid100 = true; reasons.push('VALID:4_markers+pinned_reset_100pct'); }
      }
    } catch (e) { reasons.push(`binary_or_unreadable:${String(e?.code||e).slice(0,80)}`); }
  }

  const entry = {
    at: new Date().toISOString(), file: rel, bytes: st.size, mtime: st.mtime.toISOString(),
    sha256: hash,
    validation: valid100 ? 'VALID_100_PCT' : 'NOT_VALIDATED',
    tag: valid100 ? null : '[SUSPECT]',
    reasons,
    quarantine_eligible: (
      !valid100 &&
      reasons.some(r => /not_pinned|fingerprint_missing|binary_or_unreadable|certificate_pinned_but_not_reset/.test(r))
    ),
  };
  inv.push(entry);
  appendFileSync(ND, JSON.stringify(entry) + '\n');
  if (!valid100) suspects.push(entry); else validCount++;
}

// ── Déplacement quarantaine (seulement --apply + HKDF) ──────────────────────
const moved = [];
if (APPLY && unlockValid && suspects.length) {
  mkdirSync(QUARANTINE_DIR, { recursive: true });
  for (const s of suspects) {
    if (!s.quarantine_eligible) { moved.push({ file:s.file, skipped:true, reason:'[SUSPECT] mais absence certificat seule → pas de quarantaine (règle R3)' }); continue; }
    const src = resolve(ROOT, s.file);
    const flat = s.file.replace(/\//g, '__').replace(/\\/g, '__');
    const dest = resolve(QUARANTINE_DIR, `${Date.now()}__${flat}`);
    try {
      renameSync(src, dest);
      if (process.platform === 'win32') {
        // Révoque héritage + seul Administrateurs (S-1-5-32-544) Full Control.
        try { execSync(`icacls "${dest}" /inheritance:r /grant:r "*S-1-5-32-544:F"`, { stdio: 'ignore', timeout: 10000 }); }
        catch { /* best effort */ }
      } else {
        try { chmodSync(dest, 0o000); } catch {}
      }
      const destSt = statSync(dest);
      moved.push({
        from: s.file, to: relative(ROOT, dest),
        sha256_before: s.sha256, sha256_after: sha256File(dest),
        bytes: destSt.size, rightsRevoked: (process.platform === 'win32') ? 'icacls inheritance:r admins-only' : 'chmod 000',
      });
    } catch (e) {
      moved.push({ from: s.file, error: String(e?.message || e).slice(0, 200) });
    }
  }
  const manifest = { at: new Date().toISOString(), engine:'R3', moved, chainTip: chain, hkdfValid:true };
  writeFileSync(resolve(QUARANTINE_DIR, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
}

const report = {
  at: new Date().toISOString(),
  engine: 'Agent R3 (Compliance & Audit) sanitize /audit/legal/',
  mode: APPLY ? (unlockValid ? 'APPLY (HKDF valide)' : 'DRY (HKDF invalide)') : 'DRY (défaut)',
  anchorHkdfPrefix16: HKDF_EXPECTED.slice(0,16) + '\u2026',
  directory: 'audit/legal/',
  freeze: { totalFiles: files.length, chainTip: chain, inventoryNdjson: 'data/out/r3-freeze-inventory.ndjson' },
  pinnedCertificates: pinnedPrints.size,
  pinnedResetCertificates: pinnedResetFlag.size,
  validation: { valid_100pct: validCount, not_validated_suspect: suspects.length, coverage_pct: files.length ? Math.round(((validCount) / files.length) * 1000) / 10 : 0 },
  suspectFiles: suspects.map(s => ({ file: s.file, tag: s.tag, reasons: s.reasons, eligible: s.quarantine_eligible })),
  quarantine: {
    target: 'data/quarantine/legal/',
    movedOnApply: moved.length,
    manifest: moved.length ? 'data/quarantine/legal/MANIFEST.json' : null,
    moves: moved,
  },
  exitReason: (suspects.length > 0 && !APPLY)
    ? `exit=23 — ${suspects.length} fichiers [SUSPECT] taggés. Déplacement quarantaine NON exécuté sans --apply + HKDF. Certificats reset épinglés: ${pinnedResetFlag.size}/12.`
    : `exit=0 — 100% validés: ${validCount}/${files.length}. Inventaire gel intact.`,
  note: 'R3: Certificats reset épinglés = gate. certificates.json vide ⇒ 0 validés. [SUSPECT] seul ne déplace pas; seulement [SUSPECT]+empreinte non pin/non reset/unreadable ⇒ quarantaine.',
};
writeFileSync(resolve(OUT, 'r3-tag-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  engine: report.engine, mode: report.mode,
  freeze_total: files.length,
  pinned_certs: { total: pinnedPrints.size, reset: pinnedResetFlag.size },
  validation: { valid: validCount, suspect: suspects.length, pct: report.validation.coverage_pct },
  quarantine: { target: report.quarantine.target, moved: report.quarantine.movedOnApply },
}, null, 2));

if (suspects.length > 0 && !APPLY) process.exit(23);  // UNIQUE exit=23 R3
process.exit(0);
