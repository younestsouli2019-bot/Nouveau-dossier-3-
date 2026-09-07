#!/usr/bin/env node
/**
 * ============================================================================
 * DYNAMIC ENGINE + ACTIVE REPAIRMAN + CIRCUIT BREAKER
 * — Logless GitHub Actions Deadlock Scraping & Self-Healing —
 * ============================================================================
 * GitHub kills self-deadlocked jobs BEFORE a runner is provisioned, so
 * in-runner monitoring (Datadog / New Relic / OpenTelemetry) sees nothing.
 * This engine works at the CONTROL-PLANE level (GitHub Actions REST API).
 *
 * Deadlock signature (from /actions/runs/{id}/jobs):
 *   conclusion     = "failure"
 *   runner_id      = null              (healthy: assigned runner id)
 *   steps.length   = 0                (healthy: >= 1)
 *   completed_at   <= started_at      (inverted timestamps; healthy: > 2s delta)
 *   job logs       = 404 BlobNotFound (healthy: streamable)
 *
 * Pipeline per cycle:
 *   1. PASSIVE SCANNER   — scan recent failed runs for the signature (hourly cron).
 *   2. TRIAGE            — map failed job -> workflow file -> static-engine
 *                          analysis (scripts/lint-workflow-concurrency.mjs).
 *   3. ACTIVE REPAIRMAN  — strip the duplicate job-level concurrency block,
 *                          commit + push the patch (needs a PAT with
 *                          repo+workflow scope — GITHUB_TOKEN cannot modify
 *                          workflow files).
 *   4. CIRCUIT BREAKER   — if repairs fire >3 cycles in a row, raise an
 *                          alert (external webhook + GitHub issue) and latch.
 *
 * Env:
 *   GITHUB_REPOSITORY            owner/repo (set by Actions)
 *   GITHUB_TOKEN                 API read token (Actions default)
 *   SELF_HEALING_TOKEN           PAT with repo+workflow scope for repair pushes
 *                                (falls back to GITHUB_PAT_WORKFLOW_SCOPE)
 *   SELF_HEALING_ALERT_WEBHOOK   optional external emergency webhook
 *   GITHUB_API_BASE              optional API base override
 *
 * Flags:
 *   --dry-run   scan + triage only; no writes, no commits, no push
 * ============================================================================
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { violations, applyFix } from "./lint-workflow-concurrency.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const REPO = process.env.GITHUB_REPOSITORY || "younestsouli2019-bot/Nouveau-dossier-3-";
const API_BASE = (process.env.GITHUB_API_BASE || "https://api.github.com") + "/repos/" + REPO;
const TOKEN = process.env.GITHUB_TOKEN || "";
const REPAIR_TOKEN = process.env.SELF_HEALING_TOKEN || process.env.GITHUB_PAT_WORKFLOW_SCOPE || "";
const ALERT_WEBHOOK = process.env.SELF_HEALING_ALERT_WEBHOOK || "";
const STATE_FILE = path.join(process.cwd(), "out", "self-healing", "state.json");
const SCAN_WINDOW_H = 24;
const CIRCUIT_BREAKER_THRESHOLD = 3;
// Files the repairman must NEVER auto-modify. The healer may not repair its
// own safety controls: changes to the healer, breaker, permissions, or
// payment authorization require OWNER approval (escalated via GitHub issue).
const PROTECTED_FILES = [".github/workflows/devops-self-healing.yml"];
// Durable breaker state: a pinned GitHub issue (survives runner death; the
// out/ file is a local cache only — out/ is gitignored).
const STATE_ISSUE_TITLE = "SWARM SELF-HEALING — circuit breaker state";

if (!TOKEN) {
  console.error("FATAL: GITHUB_TOKEN not set (control-plane scan requires it).");
  process.exit(1);
}

async function gh(pathname, init = {}) {
  const res = await fetch(API_BASE + pathname, {
    ...init,
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "swarm-self-healing",
      ...(init.headers || {}),
    },
  });
  if (res.status === 404 || res.status === 204) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${pathname}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** The logless deadlock signature. */
function isDeadlockJob(j) {
  if (j.conclusion !== "failure") return false; // 'skipped' shares the shape but is not a failure
  if (j.runner_id !== null && j.runner_id !== undefined) return false;
  if ((j.steps || []).length !== 0) return false;
  const started = Date.parse(j.started_at || "");
  const completed = Date.parse(j.completed_at || "");
  if (Number.isNaN(started) || Number.isNaN(completed)) return false;
  return completed <= started; // inverted / zero delta
}

async function scanDeadlocks() {
  const runs = await gh(`/actions/runs?per_page=100`);
  const since = Date.now() - SCAN_WINDOW_H * 3600 * 1000;
  const hits = new Map(); // run.path -> { path, jobs:Set, runs:Set, events:Set }
  let scanned = 0;

  for (const run of (runs && runs.workflow_runs) || []) {
    if (run.conclusion !== "failure") continue;
    if (Date.parse(run.created_at) < since) continue;
    scanned++;
    let jobs;
    try {
      jobs = await gh(`/actions/runs/${run.id}/jobs`);
    } catch (err) {
      console.error(`WARN: could not fetch jobs for run ${run.id}: ${err.message}`);
      continue;
    }
    for (const j of (jobs && jobs.jobs) || []) {
      if (!isDeadlockJob(j)) continue;
      if (!hits.has(run.path)) hits.set(run.path, { path: run.path, jobs: new Set(), runs: new Set(), events: new Set() });
      const h = hits.get(run.path);
      h.jobs.add(j.name);
      h.runs.add(run.id);
      h.events.add(run.event);
    }
  }
  return { scanned, hits: [...hits.values()] };
}

function git(args) {
  try {
    return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() }).toString();
  } catch (err) {
    throw new Error(`git ${args.join(" ")} failed: ${(err.stderr || err.stdout || err.message || "").toString().slice(0, 300)}`);
  }
}

function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

async function alertEngineering(report, state) {
  const summary = `🚨 [SWARM SELF-HEALING CIRCUIT BREAKER] ${state.consecutiveRepairs} consecutive repair cycles (threshold ${CIRCUIT_BREAKER_THRESHOLD}). The repository is experiencing an engine-level malfunction: workflow concurrency deadlocks keep reappearing. Last repairs: ${report.repairs.map((r) => `${r.file} (job '${r.job}')`).join(", ") || "n/a"}. Investigate what keeps reintroducing duplicate job-level concurrency groups.`;
  if (ALERT_WEBHOOK) {
    try {
      await fetch(ALERT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: summary, severity: "critical", source: "devops-self-healing", report }),
      });
      console.log("ALERT: external webhook notified.");
    } catch (err) {
      console.error(`WARN: alert webhook failed: ${err.message}`);
    }
  }
  try {
    await fetch(`${API_BASE}/issues`, {
      method: "POST",
      headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "swarm-self-healing" },
      body: JSON.stringify({
        title: "🚨 Self-healing circuit breaker: recurring workflow deadlocks",
        labels: ["self-healing", "circuit-breaker"],
        body: `${summary}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``,
      }),
    });
    console.log("ALERT: GitHub issue created.");
  } catch (err) {
    console.error(`WARN: could not create alert issue: ${err.message}`);
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { consecutiveRepairs: 0, alertFired: false, lastCycleAt: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Durable control-plane state: JSON in a pinned GitHub issue body. */
async function findStateIssue() {
  const issues = await gh("/issues?state=all&per_page=100");
  for (const i of issues || []) if (i.title === STATE_ISSUE_TITLE) return i;
  return null;
}

async function loadDurableState() {
  try {
    const issue = await findStateIssue();
    if (issue && issue.body) {
      const m = issue.body.match(/```json\n([\s\S]*?)\n```/);
      if (m) return { ...JSON.parse(m[1]), _issue: issue };
    }
  } catch (err) {
    console.error(`WARN: durable state read failed (${err.message}); using file cache`);
  }
  return null;
}

async function saveDurableState(state) {
  const body = `Pinned circuit-breaker state — do not close. Updated each self-healing cycle.\n\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`;
  try {
    const existing = await findStateIssue();
    if (existing) {
      await gh(`/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ body }) });
      return;
    }
    await fetch(`${API_BASE}/issues`, {
      method: "POST",
      headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "swarm-self-healing" },
      body: JSON.stringify({ title: STATE_ISSUE_TITLE, labels: ["self-healing", "state"], body }),
    });
  } catch (err) {
    console.error(`WARN: durable state write failed: ${err.message}`);
  }
}

async function main() {
  console.log(
    `[self-healing] repo=${REPO} mode=${DRY_RUN ? "DRY-RUN" : "LIVE"} repairToken=${REPAIR_TOKEN ? "present" : "ABSENT (repairs reported but not pushed)"}`
  );
  const { scanned, hits } = await scanDeadlocks();
  console.log(
    `[self-healing] scanned ${scanned} failed runs in last ${SCAN_WINDOW_H}h -> ${hits.length} workflow file(s) with deadlock-signature jobs`
  );

  const report = {
    repo: REPO,
    mode: DRY_RUN ? "dry-run" : "live",
    scannedFailedRuns: scanned,
    deadlockedWorkflows: [],
    repairs: [],
    notes: [],
  };

  for (const hit of hits) {
    const file = hit.path; // e.g. ".github/workflows/owner-crypto-withdraw.yml"
    if (!fs.existsSync(file)) {
      report.notes.push(`${file}: signature seen in API history but file missing from checkout (deleted/renamed?)`);
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    const vs = violations(text);
    report.deadlockedWorkflows.push({
      file,
      signatureJobs: [...hit.jobs],
      events: [...hit.events],
      runs: [...hit.runs].slice(0, 5),
      staticViolations: vs.map((v) => ({ job: v.job, group: v.jobGroup })),
    });

    if (!vs.length) {
      report.notes.push(
        `${file}: deadlock signature in API history but static engine finds no duplicate concurrency — already fixed, or a novel failure mode. Manual review advised.`
      );
      continue;
    }

    const { text: fixedText, fixed } = applyFix(text, "strip");
    const jobNames = fixed.map((f) => f.job).join(", ");

    if (DRY_RUN) {
      for (const f of fixed) report.repairs.push({ file, job: f.job, action: f.action, pushed: false, reason: "dry-run" });
      continue;
    }

    // SAFETY: the repairman may only ever delete concurrency-block lines.
    const removed = text.split("\n").filter((l) => !fixedText.split("\n").includes(l));
    const illegal = removed.filter((l) => l.trim() !== "" && !/^\s*(#.*)?$/.test(l) && !/^\s*(concurrency:|group:|cancel-in-progress:)/.test(l));
    if (illegal.length) {
      report.notes.push(`SAFETY ABORT ${file}: repair would remove non-concurrency lines: ${JSON.stringify(illegal.slice(0, 3))}`);
      continue;
    }
    if (PROTECTED_FILES.includes(file)) {
      report.notes.push(`OWNER APPROVAL REQUIRED: ${file} carries a violation, but the repairman never modifies the healer or its own safety controls. Escalating instead.`);
      report.repairs.push({ file, job: jobNames, action: "escalated for owner approval", pushed: false, reason: "protected file" });
      continue;
    }
    fs.writeFileSync(file, fixedText, "utf8");
    for (const f of fixed) console.log(`[self-healing] REPAIRED ${file} job '${f.job}': ${f.action}`);

    if (!REPAIR_TOKEN) {
      for (const f of fixed)
        report.repairs.push({
          file,
          job: f.job,
          action: f.action,
          pushed: false,
          reason: "no SELF_HEALING_TOKEN (PAT with repo+workflow scope required to push workflow-file changes)",
        });
      continue;
    }

    const branch = process.env.GITHUB_REF_NAME || "main";
    try {
      git(["config", "user.name", "github-actions[bot]"]);
      git(["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
      git(["add", file]);
      git([
        "commit",
        "-m",
        `fix(ci): self-healing — strip self-deadlocking job-level concurrency (job '${jobNames}'); GitHub can never schedule a job whose concurrency group is already held by its own run`,
        "--no-verify",
      ]);
      git(["push", `https://x-access-token:${REPAIR_TOKEN}@github.com/${REPO}.git`, `HEAD:${branch}`]);
      for (const f of fixed) report.repairs.push({ file, job: f.job, action: f.action, pushed: true });
      console.log(`[self-healing] PUSHED repair commit for ${file}`);
    } catch (err) {
      for (const f of fixed) report.repairs.push({ file, job: f.job, action: f.action, pushed: false, reason: `push failed: ${err.message}` });
      report.notes.push(`REPAIR PUSH FAILED for ${file}: ${err.message} — ensure SELF_HEALING_TOKEN has repo+workflow scope.`);
    }
  }


  // ---- Proactive sweep -------------------------------------------------
  // The duplicate-group pattern is deterministically fatal (proven via
  // control-plane forensics), so repair static violations even in workflows
  // that have not fired recently (e.g., rarely-dispatched money paths like
  // owner-payout.yml would otherwise wait for their first dead run).
  {
    const wfDir = path.join(process.cwd(), ".github", "workflows");
    const files = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")) : [];
    for (const f of files) {
      const file = `.github/workflows/${f}`;
      if (report.repairs.some((r) => r.file === file && (r.pushed || DRY_RUN))) continue;
      const text = fs.readFileSync(file, "utf8");
      const { text: fixedText, fixed } = applyFix(text, "strip");
      if (!fixed.length) continue;
      const jobNames = fixed.map((x) => x.job).join(", ");
      if (PROTECTED_FILES.includes(file)) {
        report.notes.push(`OWNER APPROVAL REQUIRED (proactive sweep): ${file} carries a violation; healer never self-repairs. Escalating.`);
        report.repairs.push({ file, job: fixed.map((x) => x.job).join(", "), action: "escalated for owner approval", pushed: false, reason: "protected file" });
        continue;
      }
      if (!DRY_RUN) {
        fs.writeFileSync(file, fixedText, "utf8");
        for (const x of fixed) console.log(`[self-healing] PROACTIVE REPAIR ${file} job '${x.job}': ${x.action}`);
        if (REPAIR_TOKEN) {
          const branch = process.env.GITHUB_REF_NAME || "main";
          try {
            git(["config", "user.name", "github-actions[bot]"]);
            git(["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
            git(["add", file]);
            git(["commit", "-m", `fix(ci): self-healing — strip self-deadlocking job-level concurrency (job '${jobNames}')`, "--no-verify"]);
            git(["push", `https://x-access-token:${REPAIR_TOKEN}@github.com/${REPO}.git`, `HEAD:${branch}`]);
            for (const x of fixed) report.repairs.push({ file, job: x.job, action: x.action, pushed: true, reason: "proactive static sweep" });
            console.log(`[self-healing] PUSHED proactive repair commit for ${file}`);
          } catch (err) {
            for (const x of fixed) report.repairs.push({ file, job: x.job, action: x.action, pushed: false, reason: `push failed: ${err.message}` });
            report.notes.push(`PROACTIVE REPAIR PUSH FAILED for ${file}: ${err.message}`);
          }
        } else {
          for (const x of fixed) report.repairs.push({ file, job: x.job, action: x.action, pushed: false, reason: "no SELF_HEALING_TOKEN" });
        }
      } else {
        for (const x of fixed) report.repairs.push({ file, job: x.job, action: x.action, pushed: false, reason: "dry-run proactive sweep" });
      }
    }
  }

  // ---- Circuit breaker ----
  let state = loadState();
  const durable = await loadDurableState();
  if (durable) state = { ...durable, ...state, _issue: undefined, alertFired: durable.alertFired, consecutiveRepairs: durable.consecutiveRepairs ?? state.consecutiveRepairs };
  const repairsThisCycle = report.repairs.filter((r) => r.action && r.action !== "escalated for owner approval").length;
  state.lastCycleAt = new Date().toISOString();
  state.consecutiveRepairs = repairsThisCycle > 0 ? (state.consecutiveRepairs || 0) + 1 : 0;
  if (state.consecutiveRepairs === 0) state.alertFired = false;

  if (state.consecutiveRepairs > CIRCUIT_BREAKER_THRESHOLD && !state.alertFired) {
    await alertEngineering(report, state);
    state.alertFired = true;
    report.circuitBreaker = "OPEN — engineering alerted";
  } else if (state.consecutiveRepairs > 0) {
    report.circuitBreaker = `watching: ${state.consecutiveRepairs}/${CIRCUIT_BREAKER_THRESHOLD + 1} consecutive repair cycles`;
  }
  saveState(state);
  if (!DRY_RUN) await saveDurableState(state);

  // Checkpoint the breaker state (non-workflow file — GITHUB_TOKEN may push it).
  if (!DRY_RUN) {
    gitOrNull(["config", "user.name", "github-actions[bot]"]);
    gitOrNull(["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
    gitOrNull(["add", "out/self-healing/state.json"]);
    const st = gitOrNull(["status", "--porcelain"]);
    if (st && st.trim()) {
      gitOrNull(["commit", "-m", "chore(self-healing): checkpoint circuit-breaker state", "--no-verify"]);
      const pushToken = REPAIR_TOKEN || TOKEN;
      const branch = process.env.GITHUB_REF_NAME || "main";
      try {
        git(["push", `https://x-access-token:${pushToken}@github.com/${REPO}.git`, `HEAD:${branch}`]);
      } catch (err) {
        report.notes.push(`state checkpoint push failed: ${err.message}`);
      }
    }
  }

  console.log("\n==== SELF-HEALING REPORT ====");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
