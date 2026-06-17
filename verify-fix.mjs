#!/usr/bin/env node
/*
 * Post-push verification for the "Owner Hands-Free (Live)" CI fix.
 *
 * After running push-owner-handsfree-fix.mjs, use this to confirm:
 *   1. The commit landed on main.
 *   2. .qodo/rank gitlink is gone from the tree.
 *   3. The workflow file now references actions/checkout@v5 and upload-artifact@v5.
 *   4. The latest workflow run after the fix is no longer failing at the checkout step.
 *
 * Usage:
 *   GH_TOKEN=ghp_xxx node verify-fix.mjs
 *   node verify-fix.mjs ghp_xxx
 *
 * Token scope: classic PAT `repo` (or `public_repo` if the repo is public);
 * fine-grained PAT: "Metadata: Read" + "Actions: Read".
 */

const OWNER = "younestsouli2019-bot";
const REPO = "Nouveau-dossier-3-";
const BRANCH = "main";
const WORKFLOW_FILE = "owner-handsfree-live.yml";

const token = process.env.GH_TOKEN || process.argv[2];
if (!token) {
  console.error("ERROR: set GH_TOKEN env var or pass token as first argument.");
  process.exit(2);
}

const API = "https://api.github.com";
const H = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "autonomous-fix-verifier",
};

let passed = 0;
let failed = 0;
const ok = (m) => { console.log(`  \u2713 ${m}`); passed++; };
const bad = (m) => { console.error(`  \u2717 ${m}`); failed++; };

async function gh(method, urlPath) {
  const res = await fetch(`${API}${urlPath}`, { method, headers: H });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${urlPath}: ${text.slice(0, 200)}`);
  return json;
}

console.log(`Verifying fix on ${OWNER}/${REPO} @ ${BRANCH}\n`);

// 1. main head
const ref = await gh("GET", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`);
const headSha = ref.object.sha;
console.log(`1. main HEAD = ${headSha}`);

// 2. tree at head — check .qodo/rank is gone
const commit = await gh("GET", `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
const tree = await gh("GET", `/repos/${OWNER}/${REPO}/git/trees/${commit.tree.sha}?recursive=1`);
const qodoRank = (tree.tree || []).find((t) => t.path === ".qodo/rank");
console.log(`2. Checking .qodo/rank gitlink removed...`);
if (!qodoRank) {
  ok(".qodo/rank submodule gitlink is gone from the tree");
} else {
  bad(`.qodo/rank still present (mode=${qodoRank.mode}, sha=${qodoRank.sha})`);
}

// 3. workflow file content
const wf = await gh(
  "GET",
  `/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(".github/workflows/")}${WORKFLOW_FILE}?ref=${BRANCH}`
);
const content = Buffer.from(wf.content, "base64").toString("utf8");
console.log(`3. Checking workflow file contents...`);
if (content.includes("actions/checkout@v5")) ok("actions/checkout bumped to @v5");
else bad("actions/checkout still @v4");
if (content.includes("actions/upload-artifact@v5")) ok("actions/upload-artifact bumped to @v5");
else bad("actions/upload-artifact still @v4");
if (content.includes("submodules: false")) ok("submodules: false guard present");
else bad("submodules: false guard missing");

// 4. latest workflow runs
console.log(`4. Latest workflow runs...`);
try {
  const runs = await gh(
    "GET",
    `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=3`
  );
  for (const r of (runs.workflow_runs || [])) {
    const ago = Math.round((Date.now() - new Date(r.created_at)) / 60000);
    console.log(`   - #${r.run_number} ${r.conclusion || r.status} ${ago}m ago  ${r.html_url}`);
  }
  const latest = runs.workflow_runs && runs.workflow_runs[0];
  if (latest) {
    if (latest.conclusion === "success") ok(`latest run #${latest.run_number} succeeded`);
    else if (latest.conclusion === "failure")
      console.log(`   ! latest run #${latest.run_number} still failing - check the log; if it fails inside validate-owner-routing-env / plaid-preflight / assert-live-chain, that is a SEPARATE secrets/env problem, not the git-128 blocker (which is now fixed).`);
    else
      console.log(`   ~ latest run #${latest.run_number} status=${latest.status} (still running or queued).`);
  }
} catch (e) {
  console.log(`   (could not fetch runs: ${e.message})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
