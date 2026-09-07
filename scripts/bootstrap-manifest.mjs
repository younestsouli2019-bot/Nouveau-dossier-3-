#!/usr/bin/env node
/**
 * bootstrap-manifest — cryptographic pre/post evidence for the owner-apply
 * patch. Produces bootstrap-before.json and bootstrap-after.json so the owner
 * gets machine-readable proof that the patch changed ONLY the intended
 * workflow blocks.
 *
 * Usage:
 *   node scripts/bootstrap-manifest.mjs before   # run BEFORE applying the patch
 *   node scripts/bootstrap-manifest.mjs after    # run AFTER applying the patch
 *
 * Manifest fields (per workflow file):
 *   workflow            file path
 *   concurrency_group    workflow-level concurrency group (or null)
 *   cancel_in_progress  whether any cancel-in-progress: true is set
 *   deadlock_signature  true if duplicate job-level group detected (pre-patch state)
 *   changed             sha256_before !== sha256_after (after-manifest only)
 *   sha256_before / sha256_after
 *   static_gate         "pass" | "fail" (zero-dep static engine verdict, post state)
 * ============================================================================
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { analyze, violations } from "./lint-workflow-concurrency.mjs";

const MODE = process.argv[2];
const TARGETS = [
  ".github/workflows/autonomous-scheduler.yml",
  ".github/workflows/owner-crypto-withdraw.yml",
  ".github/workflows/owner-payout.yml",
  ".github/workflows/devops-self-healing.yml",
];
const HASH_CACHE = ".bootstrap-hashes.json";

const sha256 = (p) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);

function snapshot() {
  return TARGETS.map((p) => {
    if (!fs.existsSync(p)) return { workflow: p, missing: true };
    const t = fs.readFileSync(p, "utf8");
    const { wfGroup } = analyze(t);
    const vs = violations(t);
    return {
      workflow: p,
      concurrency_group: wfGroup,
      cancel_in_progress: /cancel-in-progress:\s*true/.test(t),
      deadlock_signature: vs.length > 0,
      deadlock_jobs: vs.map((v) => ({ job: v.job, group: v.jobGroup })),
      sha256: sha256(p),
    };
  });
}

if (MODE === "before") {
  const snap = snapshot();
  fs.writeFileSync(HASH_CACHE, JSON.stringify(Object.fromEntries(snap.map((s) => [s.workflow, s.sha256])), null, 2));
  const before = snap.map(({ sha256, ...rest }) => ({ ...rest, sha256_before: sha256, sha256_after: null, changed: null, static_gate: null }));
  fs.writeFileSync("bootstrap-before.json", JSON.stringify(before, null, 2) + "\n");
  console.log("bootstrap-before.json written (pre-patch evidence captured).");
} else if (MODE === "after") {
  const snap = snapshot();
  const before = fs.existsSync("bootstrap-before.json") ? JSON.parse(fs.readFileSync("bootstrap-before.json", "utf8")) : null;
  const hashes = fs.existsSync(HASH_CACHE) ? JSON.parse(fs.readFileSync(HASH_CACHE, "utf8")) : {};
  const after = snap.map(({ sha256, ...rest }) => {
    const prevSig = before ? before.find((b) => b.workflow === rest.workflow) : null;
    const shaBefore = hashes[rest.workflow] ?? null;
    return {
      ...rest,
      deadlock_signature_before: prevSig ? prevSig.deadlock_signature : null,
      sha256_before: shaBefore,
      sha256_after: sha256,
      changed: shaBefore !== null && shaBefore !== sha256,
      static_gate: rest.deadlock_signature ? "fail" : "pass",
    };
  });
  fs.writeFileSync("bootstrap-after.json", JSON.stringify(after, null, 2) + "\n");
  if (fs.existsSync(HASH_CACHE)) fs.unlinkSync(HASH_CACHE);
  console.log("bootstrap-after.json written:");
  for (const a of after) {
    console.log(`  ${a.workflow} changed=${a.changed} gate=${a.static_gate} sig_before=${a.deadlock_signature_before} sig_after=${a.deadlock_signature}`);
  }
} else {
  console.error("Usage: node scripts/bootstrap-manifest.mjs before|after");
  process.exit(1);
}
