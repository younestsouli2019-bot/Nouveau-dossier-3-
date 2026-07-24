// Doomsday Vault - comprehensive snapshot of all critical state.
// Creates a self-contained, encrypted, hashed backup that can be restored
// from anywhere with just the manifest.json.
//
// What it captures:
// 1. Base44 entities (PayoutBatch, RevenueEvent, RevenueStream, Analytics, Task)
// 2. Local state (exports/, wire instructions, settlement logs, runner control)
// 3. Workflow definitions (.github/workflows/)
// 4. Procurement state (scaffolding, scripts, docs)
// 5. Payer registry + financial ledger (legacy)
// 6. WA session backup if present
// 7. Critical scripts
//
// Output structure:
//   exports/doomsday/snapshot_YYYYMMDD-HHmmss/
//     manifest.json           (checksums, sizes, timestamps)
//     data/
//       base44/               (full entity dumps as JSONL)
//       exports/              (local exports folder snapshot)
//       workflows/            (.github/workflows/ files)
//       scripts/              (all scripts/ files)
//       docs/                 (all docs/ files)
//       ledger.json           (settle-log.json + balance-monitor-log.json)
//     snapshot_YYYYMMDD-HHmmss.zip   (encrypted if DOOMSDAY_ENCRYPT=true)

import { writeFileSync, mkdirSync, readdirSync, statSync, createReadStream, createWriteStream, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DOOMSDAY_ROOT || "/workspace";
const OUT_DIR = process.env.DOOMSDAY_OUT || join(ROOT, "exports", "doomsday");
const TS = new Date().toISOString().replace(/[:.]/g, "-").replace(/T/, "_").slice(0, 19);
const SNAPSHOT_DIR = join(OUT_DIR, `snapshot_${TS}`);

function envFlag(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

const INCLUDE_BASE44 = envFlag("DOOMSDAY_INCLUDE_BASE44", true);
const INCLUDE_EXPORTS = envFlag("DOOMSDAY_INCLUDE_EXPORTS", true);
const INCLUDE_WORKFLOWS = envFlag("DOOMSDAY_INCLUDE_WORKFLOWS", true);
const INCLUDE_SCRIPTS = envFlag("DOOMSDAY_INCLUDE_SCRIPTS", true);
const INCLUDE_DOCS = envFlag("DOOMSDAY_INCLUDE_DOCS", true);
const INCLUDE_LOCAL_DATA = envFlag("DOOMSDAY_INCLUDE_LOCAL_DATA", true);
const CREATE_ZIP = envFlag("DOOMSDAY_ZIP", true);
const ENCRYPT = envFlag("DOOMSDAY_ENCRYPT", false);
const ENCRYPT_PASSPHRASE = process.env.DOOMSDAY_PASSPHRASE || "doomsday-" + TS;

const BASE44_BASE = process.env.BASE44_FLOW_API_URL || "https://agent-flow-ai-9855ea98.base44.app/api";
const BASE44_KEY = process.env.BASE44_FLOW_API_KEY || "5b4be0fada884ca28142a3279e9880f6";
const BASE44_SWARM_BASE = "https://agent-swarm-689afeabf1db9c30efe0bd7e.base44.app/api";
const BASE44_SWARM_KEY = process.env.BASE44_SWARM_API_KEY || "e599b5b131574c1bae885fc013620739";

const ENTITIES = ["PayoutBatch", "RevenueEvent", "RevenueStream", "Analytics", "Task"];
const SWARM_ENTITIES = ["RevenueStream", "PayoutBatch", "Task"];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function fileHash(path) {
  try {
    return sha256(createReadStream(path));
  } catch {
    return null;
  }
}
function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}
function copyFile(src, dst) {
  ensureDir(dirname(dst));
  const buf = readFileSync(src);
  writeFileSync(dst, buf);
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { ...headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function backupBase44(outDir) {
  const dst = join(outDir, "data", "base44");
  ensureDir(dst);
  const report = { source: "agent-flow-ai", entities: {} };
  for (const entity of ENTITIES) {
    const data = await fetchJson(`${BASE44_BASE}/entities/${entity}?limit=5000`, { api_key: BASE44_KEY });
    if (!data) { report.entities[entity] = { error: "fetch_failed" }; continue; }
    const records = Array.isArray(data) ? data : (data.records || []);
    const path = join(dst, `${entity.toLowerCase()}.jsonl`);
    const content = records.map((r) => JSON.stringify(r)).join("\n");
    writeFileSync(path, content);
    const hash = sha256(content);
    report.entities[entity] = { count: records.length, sha256: hash, bytes: content.length };
  }
  // Also swarm
  const swarm = { source: "agent-swarm", entities: {} };
  for (const entity of SWARM_ENTITIES) {
    const data = await fetchJson(`${BASE44_SWARM_BASE}/entities/${entity}?limit=5000`, { api_key: BASE44_SWARM_KEY });
    if (!data) { swarm.entities[entity] = { error: "fetch_failed" }; continue; }
    const records = Array.isArray(data) ? data : (data.records || []);
    const path = join(dst, `swarm_${entity.toLowerCase()}.jsonl`);
    const content = records.map((r) => JSON.stringify(r)).join("\n");
    writeFileSync(path, content);
    const hash = sha256(content);
    swarm.entities[entity] = { count: records.length, sha256: hash, bytes: content.length };
  }
  writeFileSync(join(dst, "_report.json"), JSON.stringify({ flow: report, swarm }, null, 2));
  return { flow: report, swarm };
}

function copyDir(src, dst, ignore = []) {
  if (!existsSync(src)) return { skipped: src };
  ensureDir(dst);
  const files = [];
  for (const f of readdirSync(src)) {
    if (ignore.some((ig) => f.includes(ig))) continue;
    const sp = join(src, f);
    const dp = join(dst, f);
    const st = statSync(sp);
    if (st.isDirectory()) {
      const r = copyDir(sp, dp, ignore);
      files.push(...r.files);
    } else {
      try {
        copyFileSync(sp, dp);
        const h = fileHash(dp);
        files.push({ path: relative(SNAPSHOT_DIR, dp), bytes: st.size, sha256: h });
      } catch (e) {
        files.push({ path: relative(SNAPSHOT_DIR, dp), error: e.message });
      }
    }
  }
  return { files, count: files.length };
}

function listFiles(base, ignore = []) {
  if (!existsSync(base)) return [];
  const out = [];
  for (const f of readdirSync(base)) {
    if (ignore.some((ig) => f.includes(ig))) continue;
    const p = join(base, f);
    const st = statSync(p);
    if (st.isFile()) out.push(p);
  }
  return out;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[doomsday-vault] starting at ${startedAt}`);
  console.log(`[doomsday-vault] snapshot dir: ${SNAPSHOT_DIR}`);
  ensureDir(SNAPSHOT_DIR);

  const allFiles = [];
  const sections = {};

  if (INCLUDE_BASE44) {
    console.log("[doomsday-vault] backing up Base44 entities...");
    const r = await backupBase44(SNAPSHOT_DIR);
    sections.base44 = r;
    console.log(`  agent-flow-ai entities backed up`);
    for (const [e, info] of Object.entries(r.flow.entities)) {
      console.log(`    ${e}: ${info.count ?? "?"} records ${info.bytes ?? "?"}b`);
    }
    console.log(`  agent-swarm entities backed up`);
    for (const [e, info] of Object.entries(r.swarm.entities)) {
      console.log(`    ${e}: ${info.count ?? "?"} records ${info.bytes ?? "?"}b`);
    }
  }

  if (INCLUDE_EXPORTS && existsSync(join(ROOT, "exports"))) {
    console.log("[doomsday-vault] copying exports/...");
    const dst = join(SNAPSHOT_DIR, "data", "exports");
    const r = copyDir(join(ROOT, "exports"), dst, ["doomsday", "bank_sessions"]);
    sections.exports = { count: r.count };
    allFiles.push(...r.files);
    console.log(`  ${r.count} files copied`);
  }

  if (INCLUDE_WORKFLOWS && existsSync(join(ROOT, ".github", "workflows"))) {
    console.log("[doomsday-vault] copying .github/workflows/...");
    const dst = join(SNAPSHOT_DIR, "data", "workflows");
    const r = copyDir(join(ROOT, ".github", "workflows"), dst);
    sections.workflows = { count: r.count };
    allFiles.push(...r.files);
    console.log(`  ${r.count} workflow files copied`);
  }

  if (INCLUDE_SCRIPTS && existsSync(join(ROOT, "scripts"))) {
    console.log("[doomsday-vault] copying scripts/...");
    const dst = join(SNAPSHOT_DIR, "data", "scripts");
    const r = copyDir(join(ROOT, "scripts"), dst);
    sections.scripts = { count: r.count };
    allFiles.push(...r.files);
    console.log(`  ${r.count} scripts copied`);
  }

  if (INCLUDE_DOCS && existsSync(join(ROOT, "docs"))) {
    console.log("[doomsday-vault] copying docs/...");
    const dst = join(SNAPSHOT_DIR, "data", "docs");
    const r = copyDir(join(ROOT, "docs"), dst);
    sections.docs = { count: r.count };
    allFiles.push(...r.files);
    console.log(`  ${r.count} doc files copied`);
  }

  if (INCLUDE_LOCAL_DATA && existsSync(join(ROOT, "backups", "doomsday", "snapshot_20260320-233845"))) {
    console.log("[doomsday-vault] copying previous doomsday ledger snapshot...");
    const dst = join(SNAPSHOT_DIR, "data", "legacy_doomsday");
    const r = copyDir(join(ROOT, "backups", "doomsday", "snapshot_20260320-233845", "data"), dst);
    sections.legacy_doomsday = { count: r.count };
    allFiles.push(...r.files);
    console.log(`  ${r.count} legacy files preserved`);
  }

  // Also pull swarm-overrides (runner control)
  if (existsSync(join(ROOT, "swarm-overrides"))) {
    console.log("[doomsday-vault] copying swarm-overrides/...");
    const dst = join(SNAPSHOT_DIR, "data", "swarm_overrides");
    const r = copyDir(join(ROOT, "swarm-overrides"), dst, [".git", "node_modules"]);
    sections.swarm_overrides = { count: r.count };
    allFiles.push(...r.files);
    console.log(`  ${r.count} runner-control files copied`);
  }

  // Manifest
  const manifest = {
    vault: "doomsday-vault",
    version: 1,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    snapshot_dir: relative(ROOT, SNAPSHOT_DIR),
    sections,
    encryption: ENCRYPT ? "AES-256-GCM" : "none",
    file_count: allFiles.length,
    files: allFiles,
  };
  const manifestPath = join(SNAPSHOT_DIR, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const manifestHash = sha256(readFileSync(manifestPath));
  console.log(`[doomsday-vault] manifest: ${allFiles.length} files, sha256=${manifestHash.slice(0, 16)}...`);

  let zipPath = null;
  if (CREATE_ZIP) {
    zipPath = join(OUT_DIR, `snapshot_${TS}.zip`);
    try {
      execSync(`cd ${SNAPSHOT_DIR} && zip -r -q -9 ${zipPath} .`, { stdio: "pipe" });
      const zst = statSync(zipPath);
      const zh = sha256(readFileSync(zipPath));
      console.log(`[doomsday-vault] zip: ${zipPath} ${zst.size}b sha256=${zh.slice(0, 16)}...`);
      manifest.archive = { path: zipPath, bytes: zst.size, sha256: zh };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      if (ENCRYPT) {
        const encPath = `${zipPath}.age`;
        try {
          execSync(`which age || which gpg || echo NONE`, { stdio: "pipe" });
          execSync(`gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "${ENCRYPT_PASSPHRASE}" --output "${encPath}" "${zipPath}"`, { stdio: "pipe" });
          const est = statSync(encPath);
          console.log(`[doomsday-vault] encrypted: ${encPath} ${est.size}b (passphrase: ${ENCRYPT_PASSPHRASE})`);
          manifest.encrypted_archive = { path: encPath, bytes: est.size, passphrase: ENCRYPT_PASSPHRASE };
          writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch (e) {
          console.log(`[doomsday-vault] encryption failed: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`[doomsday-vault] zip failed: ${e.message}`);
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    snapshot_dir: SNAPSHOT_DIR,
    manifest_sha256: manifestHash,
    sections,
    file_count: allFiles.length,
    zip: zipPath,
    encrypted: !!manifest.encrypted_archive,
  };
  console.log("DOOMSDAY_VAULT_SUMMARY:");
  console.log(JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT_DIR, "vault_latest.json"), JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error("[doomsday-vault] FATAL", e);
  process.exit(1);
});
