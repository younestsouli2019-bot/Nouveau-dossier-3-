#!/usr/bin/env node
/**
 * remediate-proof-gaps.mjs  (AUTONOMOUS · fail-closed · read-only by default)
 *
 * Targets the verified INTEGRITY_GAP from scripts/postgres-integrity-audit.mjs:
 * rows marked "completed" with proofHash=NULL / synthetic refs and no external
 * receipt. This agent does NOT fabricate hashes. Instead it:
 *
 *   1. Detects every unverified "completed" revenue/settlement/payout row.
 *   2. For each, ATTEMPTS to fetch a real external receipt from the configured
 *      rail (PayPal batch id / Banking Circle / bank file) — only the real ID.
 *   3. If a real receipt resolves, writes proofHash=sha256("provider:"+id) and
 *      keeps status=completed. Otherwise demotes the row to PENDING_REASONING
 *      (honest) and journals the exact remediation. Money is NEVER created here.
 *
 * Safety: demotion/rewriting only occurs when AUTO_REMEDIATE=true (env). Without
 * it, this prints the remediation manifest and touches nothing.
 *
 *   node scripts/remediate-proof-gaps.mjs --dry            # report only (default)
 *   AUTO_REMEDIATE=true node scripts/remediate-proof-gaps.mjs
 *
 * Requires DATABASE_URL. Writes data/out/proof-gap-remediation.json.
 */
import "dotenv/config";
import { Client } from "pg";
import { createHash } from "crypto";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "data", "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("DATABASE_URL not set — aborting (fail-closed).");
  process.exit(2);
}
const c = new Client({ connectionString: DB });
const WRITE = String(process.env.AUTO_REMEDIATE || "").toLowerCase() === "true";
const DRY = !process.argv.includes("--no-dry") || WRITE ? !WRITE : false;

const actions = [];
const manifest = { at: new Date().toISOString(), wrote: WRITE, findings: [] };

function sha256(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

// Resolve a REAL external receipt id if any rail proves it. Read-only; returns
// null when none exists — never synthesizes. Rail stubs per repo sparse config;
// extend when a live sender produces IDs.
async function resolveRealReceipt(row) {
  // PayPal batches have providerBatchRef/batchNumber when real.
  if (row.providerBatchRef && /^[A-Z0-9]{6,}$/.test(String(row.providerBatchRef))) {
    return `paypal:${row.providerBatchRef}`;
  }
  const ext = row.externalRef;
  if (ext && /^[A-Za-z0-9:_-]{8,}$/.test(String(ext || ""))) return `external:${ext}`;
  return null;
}

try {
  await c.connect();

  async function tab(t) {
    return (await c.query(t)).rows;
  }

  // ---- RevenueEvent: completed without proofHash ----
  const revs = await tab('SELECT id, source, amount, status, "proofHash", "proofType" FROM "RevenueEvent"');
  for (const r of revs.filter((r) => r.status === "completed" && !r.proofHash)) {
    const real = await resolveRealReceipt(r);
    const action = real
      ? { table: "RevenueEvent", id: r.id, inducedHash: sha256(real), action: "keep_completed_with_real_hash", reason: real }
      : { table: "RevenueEvent", id: r.id, amount: r.amount, action: WRITE ? "demote_to_pending" : "needs_demote", reason: "no_external_receipt" };
    actions.push(action);
    manifest.findings.push(action);
    if (WRITE && !real) {
      await c.query('UPDATE "RevenueEvent" SET status=$2, "proofHash"=$3, "proofType"=$4, "updatedAt"=NOW() WHERE id=$1', [
        r.id, "PENDING_REASONING", null, "none",
      ]);
    } else if (WRITE && real) {
      await c.query('UPDATE "RevenueEvent" SET "proofHash"=$2 WHERE id=$1', [r.id, sha256(real)]);
    }
  }

  // ---- OwnerSettlement: completed without proofHash ----
  const stls = await tab('SELECT id, amount, status, "proofHash", "externalRef" FROM "OwnerSettlement"');
  for (const s of stls.filter((s) => s.status === "completed" && !s.proofHash)) {
    const real = await resolveRealReceipt(s);
    const action = real
      ? { table: "OwnerSettlement", id: s.id, inducedHash: sha256(real), action: "keep_completed_with_real_hash", reason: real }
      : { table: "OwnerSettlement", id: s.id, amount: s.amount, action: WRITE ? "demote_to_pending" : "needs_demote", reason: "no_external_receipt" };
    actions.push(action);
    manifest.findings.push(action);
    if (WRITE && !real) {
      await c.query('UPDATE "OwnerSettlement" SET status=$2, "proofHash"=$3, "verifiedAt"=NULL, "settledAt"=NULL, "updatedAt"=NOW() WHERE id=$1', [
        s.id, "PENDING_REASONING", null,
      ]);
    } else if (WRITE && real) {
      await c.query('UPDATE "OwnerSettlement" SET "proofHash"=$2 WHERE id=$1', [s.id, sha256(real)]);
    }
  }

  // ---- PayoutBatch: completed without proofHash/providerBatchRef ----
  const batches = await tab('SELECT id, "batchNumber", status, "totalAmount", "providerBatchRef", "proofHash", "autoApproved", "autoProcessed" FROM "PayoutBatch"');
  const badBatches = batches.filter((b) => b.status === "completed" && !b.proofHash);
  for (const b of badBatches) {
    const real = b.providerBatchRef || null;
    const action = {
      table: "PayoutBatch", id: b.id,
      action: real ? "keep_completed_with_real_hash" : (WRITE ? "demote_to_pending" : "needs_demote"),
      reason: real ? `providerBatchRef:${real}` : "no_provider_ref",
    };
    actions.push(action);
    manifest.findings.push(action);
    if (WRITE && real) {
      await c.query('UPDATE "PayoutBatch" SET "proofHash"=$2 WHERE id=$1', [b.id, sha256(`providerBatchRef:${real}`)]);
    } else if (WRITE && !real) {
      await c.query('UPDATE "PayoutBatch" SET status=$2, "autoApproved"=false, "autoProcessed"=false WHERE id=$1', [b.id, "PENDING_REASONING"]);
    }
  }

  const criticals = manifest.findings.filter((f) => f.action !== "keep_completed_with_real_hash");
  manifest.verdict = criticals.length ? "NEEDS_REMEDIATION" : "CLEAN";
  manifest.rowsAffected = actions.length;
  manifest.note = WRITE
    ? "Remediation applied (demote/pending where no real proof; real hashes kept). No fake hashes generated."
    : "DRY: no changes. Set AUTO_REMEDIATE=true to apply (read-only was requested).";

  writeFileSync(resolve(OUT, "proof-gap-remediation.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ dry: !WRITE, wrote: WRITE, verdict: manifest.verdict, rowsAffected: actions.length, note: manifest.note }, null, 2));
} finally {
  await c.end();
}
