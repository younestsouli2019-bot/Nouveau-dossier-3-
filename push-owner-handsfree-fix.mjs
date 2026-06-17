#!/usr/bin/env node
/*
 * Autonomous server-side push of the "Owner Hands-Free (Live)" CI fix.
 *
 * Replays commit 433ea48 onto main of younestsouli2019-bot/Nouveau-dossier-3-
 * via the GitHub Git Data API (no local git clone required):
 *   1. GET  refs/heads/main                 -> parent commit SHA
 *   2. GET  commits/{parent}                -> base tree SHA
 *   3. POST blobs                           -> new workflow file blob SHA
 *   4. POST trees {base_tree, tree:[...]}   -> new tree (update wf, delete .qodo/rank)
 *   5. POST commits                         -> new commit SHA
 *   6. PATCH refs/heads/main                -> fast-forward
 *
 * Usage:
 *   GH_TOKEN=ghp_xxx node push-owner-handsfree-fix.mjs
 *   node push-owner-handsfree-fix.mjs ghp_xxx
 *
 * Token scope: classic PAT needs `repo`; fine-grained PAT needs
 * "Contents: Read and write" + "Metadata: Read" on Nouveau-dossier-3-.
 */

import fs from "node:fs";
import path from "node:path";

const OWNER = "younestsouli2019-bot";
const REPO = "Nouveau-dossier-3-";
const BRANCH = "main";
const WORKFLOW_PATH = ".github/workflows/owner-handsfree-live.yml";
const REMOVE_PATH = ".qodo/rank"; // dangling submodule gitlink to delete

const token = process.env.GH_TOKEN || process.argv[2];
if (!token) {
  console.error("ERROR: set GH_TOKEN env var or pass token as first argument.");
  process.exit(2);
}

// Read the fixed workflow content from the sibling file written next to this script.
const wfPath = path.join(import.meta.dirname, "owner-handsfree-live.yml");
const workflowContent = fs.readFileSync(wfPath, "utf8");

const API = "https://api.github.com";
const H = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "autonomous-fix-pusher",
};

async function gh(method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep null */
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${urlPath}`);
    console.error(text.slice(0, 800));
    process.exit(1);
  }
  return json;
}

console.log(`Target: ${OWNER}/${REPO} @ ${BRANCH}`);

// 1. current ref
const ref = await gh("GET", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`);
const parentSha = ref.object.sha;
console.log(`Parent commit: ${parentSha}`);

// 2. parent commit -> base tree
const parentCommit = await gh("GET", `/repos/${OWNER}/${REPO}/git/commits/${parentSha}`);
const baseTree = parentCommit.tree.sha;
console.log(`Base tree: ${baseTree}`);

// 3. new blob for the updated workflow file
const blob = await gh("POST", `/repos/${OWNER}/${REPO}/git/blobs`, {
  content: workflowContent,
  encoding: "utf-8",
});
console.log(`New workflow blob: ${blob.sha}`);

// 4. new tree: update workflow file + delete .qodo/rank (sha:null removes entry)
const tree = await gh("POST", `/repos/${OWNER}/${REPO}/git/trees`, {
  base_tree: baseTree,
  tree: [
    {
      path: WORKFLOW_PATH,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    },
    {
      path: REMOVE_PATH,
      mode: "160000",
      type: "commit",
      sha: null, // null sha = delete this entry from the tree
    },
  ],
});
console.log(`New tree: ${tree.sha}`);

// 5. create commit
const commit = await gh("POST", `/repos/${OWNER}/${REPO}/git/commits`, {
  message:
    "fix(ci): remove dangling .qodo/rank submodule + bump checkout/artifact to v5\n\n" +
    "Run #172 of 'Owner Hands-Free (Live)' failed with git exit code 128 because\n" +
    ".qodo/rank was recorded as a submodule gitlink (mode 160000) but had no\n" +
    "entry in .gitmodules (no URL). actions/checkout could not resolve it.\n\n" +
    "- Remove dangling .qodo/rank gitlink.\n" +
    "- Bump actions/checkout@v4 -> @v5, actions/upload-artifact@v4 -> @v5\n" +
    "  (Node 20 actions forced to Node 24 from 2026-06-16).\n" +
    "- Add explicit submodules: false to both checkout steps.",
  tree: tree.sha,
  parents: [parentSha],
});
console.log(`New commit: ${commit.sha}`);

// 6. fast-forward the branch ref (force:false -> fails safely if not FF)
const updated = await gh("PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  sha: commit.sha,
  force: false,
});
console.log(`\n✅ Pushed. ${BRANCH} now at ${updated.object.sha}`);
console.log(`   https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
console.log(`   Workflow runs: https://github.com/${OWNER}/${REPO}/actions/workflows/owner-handsfree-live.yml`);
