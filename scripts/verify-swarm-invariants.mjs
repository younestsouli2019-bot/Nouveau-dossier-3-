#!/usr/bin/env node
/**
 * ============================================================================
 * SWARM INVARIANT VERIFIER — post-repair gate (production-completeness check)
 * ============================================================================
 * Run AFTER the owner-apply patch (or any workflow change) to assert the
 * repository-wide invariants. Exit 0 = safe to proceed down the settlement
 * sequence; exit 1 = invariant broken.
 *
 * Invariants:
 *   I1  No workflow in the repo contains the concurrency self-deadlock
 *       signature (job-level concurrency group identical to workflow-level).
 *   I2  The healer workflow itself is concurrency-safe and does not touch
 *       payment execution (healer restores pipes; it never decides money).
 *   I3  Payment workflows retain their authorization gates:
 *       - owner-crypto-withdraw.yml: WITHDRAW_ENABLE gate + allowlist + audit path
 *       - owner-payout.yml: guardrails dependency + safe!=1 execution gate
 *       - autonomous-scheduler.yml: payout tick is fail-closed (secret-guarded)
 *   I4  No payment-critical workflow step has acquired an unsafe automatic
 *       retry (continue-on-error on payout/withdraw/disburse/tick steps).
 *   I5  Node engine floor remains pinned as intended (major >= 20).
 *
 * Usage:
 *   node scripts/verify-swarm-invariants.mjs            # human-readable + exit code
 *   node scripts/verify-swarm-invariants.mjs --json     # machine-readable verdict
 * ============================================================================
 */
import fs from "node:fs";
import path from "node:path";
import { violations } from "./lint-workflow-concurrency.mjs";

const JSON_MODE = process.argv.includes("--json");
const WF_DIR = path.join(process.cwd(), ".github", "workflows");
const MONEY_WORKFLOWS = ["owner-crypto-withdraw.yml", "owner-payout.yml", "autonomous-scheduler.yml"];
const PAYMENT_STEP_RX = /payout|withdraw|disburse|settle|owner-payout|crypto/i;

const read = (f) => {
  try {
    return fs.readFileSync(path.join(WF_DIR, f), "utf8");
  } catch {
    return null;
  }
};

/** Split a workflow file into job-step chunks: [{name, block}] */
function stepsOf(text) {
  const steps = [];
  const lines = text.split("\n");
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- name:\s*(.+)$/);
    if (m) {
      cur = { name: m[2].trim(), lines: [lines[i]], indent: m[1].length };
      steps.push(cur);
    } else if (cur) {
      // step block continues while indent >= step's `- name:` indent
      const ind = lines[i].match(/^(\s*)\S/);
      if (ind && ind[1].length >= cur.indent) cur.lines.push(lines[i]);
      else if (lines[i].trim() === "") cur.lines.push(lines[i]);
      else cur = null;
    }
  }
  return steps;
}

const results = [];
const check = (id, pass, detail) => results.push({ invariant: id, pass, detail });

function main() {
  // I1 — repo-wide deadlock signature
  const files = fs.existsSync(WF_DIR) ? fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")) : [];
  const allViolations = [];
  for (const f of files) {
    const t = fs.readFileSync(path.join(WF_DIR, f), "utf8");
    for (const v of violations(t)) allViolations.push({ file: f, job: v.job, group: v.jobGroup });
  }
  check("I1:repo-wide-no-deadlock", allViolations.length === 0,
    allViolations.length ? `deadlocked jobs: ${allViolations.map((v) => `${v.file}#${v.job}`).join(", ")}` : `all ${files.length} workflows concurrency-safe`);

  // I2 — healer self-safety + payment separation
  const healer = read("devops-self-healing.yml");
  if (healer === null) {
    check("I2:healer-present", false, "devops-self-healing.yml not committed yet (owner-apply patch pending)");
  } else {
    const hv = violations(healer);
    check("I2:healer-concurrency-safe", hv.length === 0, hv.length ? `healer deadlocks: ${JSON.stringify(hv)}` : "healer is concurrency-safe");
    const healerRuns = healer.split("\n").filter((l) => /^\s*run:/i.test(l) || /^\s+node |^\s+npx /.test(l)).join("\n");
    const touchesMoney = /payout|withdraw|disburse|execute-pos|owner-payout|releaseOwnerFunds/i.test(healerRuns);
    check("I2:healer-never-executes-payments", !touchesMoney,
      touchesMoney ? "healer run steps reference payment execution" : "healer restores pipes only — no payment execution in its run steps");
  }

  // I3 — payment authorization gates intact
  const ocw = read("owner-crypto-withdraw.yml") || "";
  check("I3:crypto-gates", /WITHDRAW_ENABLE/.test(ocw) && /CRYPTO_ALLOWED_ADDRESSES/.test(ocw) && /dry-run/.test(ocw),
    "owner-crypto-withdraw.yml: WITHDRAW_ENABLE gate + allowlist + audit dry-run path present");

  const op = read("owner-payout.yml") || "";
  const opGates = /needs:\s*guardrails/.test(op) && /safe\s*!=\s*'1'/.test(op);
  check("I3:paypal-gates", opGates, "owner-payout.yml: guardrails dependency + safe!=1 execution gate present");

  const sched = read("autonomous-scheduler.yml") || "";
  const tickFailClosed = /PAYOUT_TICK_SECRET/.test(sched) && /fail-closed/.test(sched);
  check("I3:tick-fail-closed", tickFailClosed,
    "autonomous-scheduler.yml: payout tick guarded by PAYOUT_TICK_SECRET fail-closed check");

  // I4 — no unsafe automatic retry on payment-critical steps
  const unsafeRetries = [];
  for (const f of MONEY_WORKFLOWS) {
    const t = read(f);
    if (!t) continue;
    for (const s of stepsOf(t)) {
      if (!PAYMENT_STEP_RX.test(s.name)) continue;
      const isWatchdog = /watchdog/i.test(s.name); // settlement watchdog is diagnose-only BY DESIGN
      if (isWatchdog) continue;
      if (/continue-on-error:\s*true/.test(s.lines.join("\n"))) unsafeRetries.push(`${f} step '${s.name}'`);
    }
  }
  check("I4:no-unsafe-auto-retry", unsafeRetries.length === 0,
    unsafeRetries.length ? `continue-on-error on payment steps: ${unsafeRetries.join(", ")}` : "no payment-critical step carries continue-on-error");

  // I5 — Node engine floor pinned
  let nodeFloor = null;
  try {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    nodeFloor = pkg.engines && pkg.engines.node;
  } catch {}
  const floorMajor = nodeFloor ? parseInt((nodeFloor.match(/(\d+)/) || [])[1], 10) : 0;

  // I6 — no simulated settlement success (Resilient-Architecture rule):
  // a rail without live wiring must throw, never write SUCCESS_* artifacts.
  const SIMULATED_SUCCESS_RX = /SUCCESS_(GASLESS|DEFI|RELAY|AMM)/;
  const simulated = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(full); }
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
        const t = fs.readFileSync(full, "utf8");
        if (SIMULATED_SUCCESS_RX.test(t)) simulated.push(path.relative(process.cwd(), full));
      }
    }
  };
  for (const top of ["src", "scripts"]) if (fs.existsSync(top)) walk(top);

  check("I6:no-simulated-settlement-success", simulated.length === 0,
    simulated.length ? `SUCCESS_* settlement artifacts found: ${simulated.join(", ")}` : "no rail fabricates settlement success");

  check("I5:node-floor-20", floorMajor >= 20, `package.json engines.node = ${nodeFloor || "MISSING"} (expected floor major >= 20)`);

  // ---- verdict ----
  const failed = results.filter((r) => !r.pass);
  const verdict = { ok: failed.length === 0, checked: results.length, failed: failed.length, results };
  if (JSON_MODE) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.invariant} — ${r.detail}`);
    console.log(`\nVERDICT: ${verdict.ok ? "ALL INVARIANTS HOLD — safe to proceed: bootstrap → tests → API health → audit-only settlement → reconcile → bounded live payout" : failed.length + " INVARIANT(S) BROKEN — do not enable payment automation"}`);
  }
  process.exit(verdict.ok ? 0 : 1);
}

main();
