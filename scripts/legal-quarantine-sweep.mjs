// scripts/legal-quarantine-sweep.mjs  (R3 · DRY by default)
//
// Implements the 2026-10-06 owner directive — Agent R3 (Compliance & Audit):
//   1. Freeze + recursive scan of audit/legal/ (SHA-256 inventory, hash-chained).
//   2. Sort: an entity/file is VALID only if it carries a compliance
//      certificate whose fingerprint is pinned in audit/legal/certificates.json.
//      Anything not validated at 100% is tagged [SUSPECT].
//   3. With --apply only: move [SUSPECT] files to data/quarantine/legal/ and
//      revoke their read/write ACLs (Windows: icacls inheritance-off, admin-only;
//      POSIX: chmod 000). Manifest records original path + hash for restoration.
//   DRY mode (default) changes nothing — it only writes the report.
//
//   node scripts/legal-quarantine-sweep.mjs            (dry)
//   node scripts/legal-quarantine-sweep.mjs --apply    (move + revoke)
//
// Produces: data/out/legal-quarantine-sweep.json (+ data/quarantine/legal/MANIFEST.json on --apply)

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync, statSync, chmodSync } from 'fs';
import { resolve, dirname, join, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEGAL_DIR = resolve(ROOT, 'audit', 'legal');
const CERTS_FILE = resolve(LEGAL_DIR, 'certificates.json');
const QUARANTINE_DIR = resolve(ROOT, 'data', 'quarantine', 'legal');
const OUT = resolve(ROOT, 'data', 'out');
const APPLY = process.argv.includes('--apply');

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const stOf = (p) => statSync(p);
const loadJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const pinned = loadJSON(CERTS_FILE) || { certificates: [] };
const pinnedPrints = new Set((pinned.certificates || []).map((c) => String(c.fingerprint).toLowerCase()));

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(LEGAL_DIR).filter((p) => basename(p) !== 'certificates.json');
const prevHashRef = loadJSON(resolve(QUARANTINE_DIR, 'MANIFEST.json'))?.chainTip || 'genesis';
let chain = prevHashRef;

const inventory = [];
const suspects = [];
for (const p of files) {
  const rel = relative(LEGAL_DIR, p).split('\\').join('/');
  const hash = sha256File(p);
  const o = loadJSON(p);
  let valid = false;
  let reason = 'not_json_or_no_certificate';
  const cert = o?.complianceCertificate || (Array.isArray(o) ? null : null);
  if (cert?.fingerprint) {
    if (pinnedPrints.has(String(cert.fingerprint).toLowerCase())) {
      valid = true;
      reason = 'certificate_pinned';
    } else {
      reason = 'certificate_fingerprint_not_pinned';
    }
  }
  const entry = { file: rel, sha256: hash, bytes: stOf(p).size, mtime: stOf(p).mtime.toISOString(), tagged: valid ? null : '[SUSPECT]', reason };
  chain = createHash('sha256').update(chain + hash).digest('hex');
  inventory.push(entry);
  if (!valid) suspects.push(entry);
}

const report = {
  at: new Date().toISOString(),
  engine: 'legal-quarantine-sweep (R3)',
  mode: APPLY ? 'APPLY' : 'DRY',
  directory: 'audit/legal/',
  filesScanned: files.length,
  valid: files.length - suspects.length,
  suspects: suspects.length,
  suspectFiles: suspects.map((s) => s.file),
  chainTip: chain,
  quarantineTarget: 'data/quarantine/legal/',
  note: 'DRY by default. --apply moves [SUSPECT] files to quarantine and revokes read/write ACLs. Hash-chain preserves the pre-move inventory.',
};
writeFileSync(resolve(OUT, 'legal-quarantine-sweep.json'), JSON.stringify(report, null, 2));

if (APPLY && suspects.length) {
  mkdirSync(QUARANTINE_DIR, { recursive: true });
  const moved = [];
  for (const s of suspects) {
    const src = resolve(LEGAL_DIR, s.file);
    const flat = s.file.split('/').join('__');
    const dest = resolve(QUARANTINE_DIR, `${Date.now()}__${flat}`);
    try {
      renameSync(src, dest);
      if (process.platform === 'win32') {
        // Revoke read/write for everyone except Administrators (no inheritance).
        execSync(`icacls "${dest}" /inheritance:r /grant:r "*S-1-5-32-544:F"`, { stdio: 'ignore' });
      } else {
        chmodSync(dest, 0o000);
      }
      moved.push({ from: s.file, to: relative(ROOT, dest), sha256: s.sha256 });
    } catch (e) {
      moved.push({ from: s.file, error: String(e?.message || e).slice(0, 160) });
    }
  }
  const manifest = {
    at: new Date().toISOString(),
    directive: 'R3 2026-10-06 — suspects quarantined, read/write revoked',
    prevChainTip: prevHashRef,
    chainTip: chain,
    moved,
    restore: 'Move file back to audit/legal/<original> and re-apply ACLs; verify sha256 against this manifest.',
  };
  writeFileSync(resolve(QUARANTINE_DIR, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ applied: true, moved: moved.length, chainTip: chain }, null, 2));
} else {
  console.log(JSON.stringify({ applied: false, mode: report.mode, filesScanned: files.length, suspects: suspects.length }, null, 2));
}
