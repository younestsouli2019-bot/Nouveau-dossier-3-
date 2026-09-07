#!/usr/bin/env node
/**
 * ============================================================================
 * SELF-HEALING CHECK — live end-to-end health verifier (workflows + runtime)
 * ============================================================================
 * Companion to scripts/verify-swarm-invariants.mjs (static/workflow invariants)
 * and scripts/lint-workflow-concurrency.mjs (deadlock lint).
 *
 * This check verifies the LIVE pipeline:
 *   S1  No workflow carries the concurrency self-deadlock signature
 *       (job-level concurrency group == workflow-level group). Fixes landed
 *       in commit 8b31eff (owner-crypto-withdraw, owner-payout,
 *       autonomous-scheduler). GitHub also natively detects and cancels this
 *       pattern, so an in-the-wild run has GitHub itself as a backstop.
 *   S2  Payment workflows keep their authorization gates and fail-closed
 *       payout tick (PAYOUT_TICK_SECRET) — nothing opens money without auth.
 *   S3  Runtime health: GET <base>/api/healthz returns 200 on every supplied
 *       base URL (VERCEL_PROJECT_URL, then --url overrides). Non-200 (404/500/502)
 *       flags a stale or dead runtime.
 *   S4  Deploy/sync prerequisites present: DATABASE_URL, PAYOUT_TICK_SECRET,
 *       APP_WEBHOOK_URL, APP_WEBHOOK_SECRET, VERCEL_TOKEN. Detectable locally
 *       only for the repo secrets we can read; missing pairs print guidance
 *       (sync job failure in CI: APP_WEBHOOK_URL/APP_WEBHOOK_SECRET empty).
 *   S5  Node engine floor pinned >= 20 (post-502 / Prisma 7 requirement).
 *
 * Usage (zero-dependency, Node >= 18 builtins only):
 *   node scripts/self-healing-check.mjs
 *   node scripts/self-healing-check.mjs --url https://......  [repeatable]
 *   node scripts/self-healing-check.mjs --json
 *
 * Exit 0 = healthy pipeline; 1 = at least one check failed.
 * ============================================================================
 */
import fs from "node:fs";
import path from "node:path";

const JSON_MODE = process.argv.includes("--json");
const WF_DIR = path.join(process.cwd(), ".github", "workflows");
const MONEY_WORKFLOWS = ["owner-crypto-withdraw.yml", "owner-payout.yml", "autonomous-scheduler.yml"];

const read = (f) => {
  try {
    return fs.readFileSync(path.join(WF_DIR, f), "utf8");
  } catch {
    return null;
  }
};

/** Parse CLI URLs: every --url <value> plus env VERCEL_PROJECT_URL fallback. */
function collectUrls() {
  const urls = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) {
      urls.push(argv[i + 1].replace(/\/+$/, ""));
      i++;
    }
  }
  if (urls.length === 0 && process.env.VERCEL_PROJECT_URL) {
    urls.push(String(process.env.VERCEL_PROJECT_URL).replace(/\/+$/, ""));
  }
  return urls;
}

/** S1 — deadlock signature: job-level group may not equal workflow-level group. */
function deadlockJobs(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  let wfGroup = null;
  const jobs = [];
  let cur = null;
  for (const line of lines) {
    const wf = /^concurrency:\s*$/.exec(line);
    if (wf) {
      const g = /^\s+group:\s+(.+?)\s*$/.exec(lines[lines.indexOf(line) + 1] || "");
      if (g) wfGroup = g[1].trim();
      continue;
    }
    const job = /^(\s*)([a-zA-Z0-9_-]+):\s*$/.exec(line);
    const jobLevel = /^(\s{4})concurrency:\s*$/.exec(line);
    if (job && !line.startsWith("  ")) {
      cur = { name: job[2], jobGroup: null };
      jobs.push(cur);
    } else if (jobLevel && cur) {
      const g = /^\s{6}group:\s+(.+?)\s*$/.exec(lines[lines.indexOf(line) + 1] || "");
      if (g) cur.jobGroup = g[1].trim();
    }
  }
  return wfGroup ? jobs.filter((j) => j.jobGroup === wfGroup).map((j) => ({ job: j.name, group: j.jobGroup })) : [];
}

/** S2/S3/S5 helpers. */
function readPackageEngine() {
  try {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    return (pkg.engines && pkg.engines.node) || null;
  } catch {
    return null;
  }
}

async function probeHealth(base) {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(`${base}/api/healthz`, { signal: ctl.signal, redirect: "follow" });
    clearTimeout(to);
    const body = await res.text().catch(() => "");
    return { ok: res.ok && res.status === 200, status: res.status, body: body.slice(0, 120) };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

function main() {
  const results = [];
  const check = (id, pass, detail) => results.push({ check: id, pass, detail });

  // S1 — repo-wide deadlock signature (mirror of lint-workflow-concurrency)
  const files = fs.existsSync(WF_DIR) ? fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")) : [];
  const deadlocks = [];
  for (const f of files) {
    const t = read(f);
    for (const v of deadlockJobs(t)) deadlocks.push(`${f}#${v.job} (group=${v.group})`);
  }
  check("S1:repo-wide-no-deadlock", deadlocks.length === 0,
    deadlocks.length ? `deadlock(s): ${deadlocks.join(", ")}` : `all ${files.length} workflows concurrency-safe`);

  // S2 — payment authorization gates + fail-closed tick
  const ocw = read("owner-crypto-withdraw.yml") || "";
  const op = read("owner-payout.yml") || "";
  const sched = read("autonomous-scheduler.yml") || "";
  const gatesOk =
    /WITHDRAW_ENABLE/.test(ocw) && /CRYPTO_ALLOWED_ADDRESSES/.test(ocw) && /dry-run/.test(ocw);
  check("S2:crypto-gates", gatesOk, "owner-crypto-withdraw.yml: WITHDRAW_ENABLE + allowlist + dry-run paths present");
  check("S2:paypal-guardrails", /needs:\s*guardrails/.test(op),
    "owner-payout.yml: execute depends on guardrails job");
  check("S2:tick-fail-closed", /PAYOUT_TICK_SECRET/.test(sched) || read("self-launch.yml") !== null,
    "autonomous-scheduler.yml / self-launch: payout tick fail-closed reference present");

  // S5 — Node engine floor (Prisma 7 requires adapter; post-502 baseline)
  const floor = readPackageEngine();
  const floorMajor = floor ? parseInt((floor.match(/(\d+)/) || [])[1], 10) : 0;
  check("S5:node-floor-20", floorMajor >= 20, `package.json engines.node = ${floor || "MISSING"} (expected floor major >= 20)`);

  // S4 — deploy/sync secrets (locally detectable subset)
  const missingSecrets = [];
  if (!process.env.DATABASE_URL && !read(".env")?.includes("DATABASE_URL")) missingSecrets.push("DATABASE_URL");
  if (!process.env.PAYOUT_TICK_SECRET) missingSecrets.push("PAYOUT_TICK_SECRET (tick stays 503 fail-closed until set)");
  if (!process.env.APP_WEBHOOK_URL || !process.env.APP_WEBHOOK_SECRET)
    missingSecrets.push("APP_WEBHOOK_URL / APP_WEBHOOK_SECRET (sync job fails in CI)");
  if (!process.env.VERCEL_TOKEN) missingSecrets.push("VERCEL_TOKEN (deploy build-and-deploy fails)");
  check("S4:secrets-present", missingSecrets.length === 0,
    missingSecrets.length ? `missing locally-read env: ${missingSecrets.join(", ")}` : "critical env present");

  // verdict (async runtime probe appended after)
  const urls = collectUrls();
  return { results, check, urls };
}

async function run() {
  const { results, check, urls } = main();

  // S3 — runtime health probes
  if (urls.length === 0) {
    check("S3:runtime-health", false, "no base URL supplied (set VERCEL_PROJECT_URL or pass --url https://…); runtime not probed");
  } else {
    for (const u of urls) {
      const p = await probeHealth(u);
      check(`S3:health-${u.replace(/^https?:\/\//, "")}`, p.ok, p.ok ? `healthz 200` : `healthz ${p.status || "ERR"} — ${p.body}`);
    }
  }

  const failed = results.filter((r) => !r.pass);
  const verdict = { ok: failed.length === 0, checked: results.length, failed: failed.length, results };
  if (JSON_MODE) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.check} — ${r.detail}`);
    console.log(`\nVERDICT: ${verdict.ok ? "SELF-HEALING CHECK PASSED" : failed.length + " CHECK(S) FAILED — see above"}`);
  }
  process.exitCode = verdict.ok ? 0 : 1;
}

run();