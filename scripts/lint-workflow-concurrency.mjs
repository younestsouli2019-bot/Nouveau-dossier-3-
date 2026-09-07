#!/usr/bin/env node
/**
 * ============================================================================
 * STATIC ENGINE — Pre-Flight Concurrency Sanitization (IaC gate)
 * ============================================================================
 * Treats .github/workflows/ as infrastructure-as-code and blocks (or repairs)
 * the structural SELF-DEADLOCK pattern:
 *
 *   A workflow declares `concurrency: group: X` at the WORKFLOW level, and a
 *   job inside it declares `concurrency: group: X` (SAME name) at the JOB
 *   level. GitHub acquires the workflow-level lock at run creation and holds
 *   it for the run's entire lifetime, so the job can never acquire the
 *   same-named group and is AUTO-FAILED AT CREATION:
 *     - runner_id = null (never assigned)
 *     - steps = 0
 *     - completed_at <= started_at (inverted timestamps)
 *     - logs = 404 (no runner ever provisioned)
 *
 * Usage:
 *   node scripts/lint-workflow-concurrency.mjs            # lint: exit 1 on violation (blocking CI gate)
 *   node scripts/lint-workflow-concurrency.mjs --fix strip  # repair: delete offending job-level blocks
 *   node scripts/lint-workflow-concurrency.mjs --fix suffix # repair: force-suffix group names instead
 *
 * Zero dependencies — plain Node, runs before `npm ci`.
 * ============================================================================
 */
import fs from "node:fs";
import path from "node:path";

const WORKFLOWS_DIR = path.join(process.cwd(), ".github", "workflows");

const stripQuotes = (s) => String(s).trim().replace(/^['"]|['"]$/g, "").trim();
const normalize = (g) => stripQuotes(g).replace(/\s+/g, " ");

/**
 * Parse a workflow file's concurrency structure (line-accurate, indentation-based).
 * Returns { wfGroup, jobBlocks } where jobBlocks = job-level concurrency blocks
 * [{ job, group, start, end }] with line indices into the ORIGINAL text.
 */
export function analyze(text) {
  const lines = text.split("\n");
  let inJobs = false;
  let currentJob = null;
  let block = null; // { scope: 'wf'|'job', job, start, end, group }
  const blocks = [];
  const flush = () => {
    if (block) {
      blocks.push(block);
      block = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] || "").replace(/\r$/, "");
    const indent = raw.search(/\S/);
    const content = indent === -1 ? "" : raw.slice(indent).trimEnd();

    if (content === "" || content.startsWith("#")) continue; // keep blanks/comments inside blocks

    if (indent === 0) {
      flush();
      const key = content.split(":")[0];
      inJobs = key === "jobs";
      currentJob = null;
      if (/^concurrency:/.test(content)) {
        block = { scope: "wf", job: null, start: i, end: i, group: null };
      }
      continue;
    }

    if (block && block.scope === "wf") {
      if (indent >= 2) {
        const m = content.match(/^group:\s*(.+)$/);
        if (m) block.group = stripQuotes(m[1]);
        block.end = i;
        continue;
      }
      flush();
    }

    if (inJobs && indent === 2 && /^([A-Za-z0-9_\-]+):/.test(content)) {
      flush();
      currentJob = content.split(":")[0];
      continue;
    }

    if (inJobs && currentJob && indent === 4 && /^concurrency:\s*(#.*)?$/.test(content)) {
      flush();
      block = { scope: "job", job: currentJob, start: i, end: i, group: null };
      continue;
    }

    if (block && block.scope === "job") {
      if (indent >= 6) {
        const m = content.match(/^group:\s*(.+)$/);
        if (m) block.group = stripQuotes(m[1]);
        block.end = i;
        continue;
      }
      flush();
    }
  }
  flush();

  const wfBlocks = blocks.filter((b) => b.scope === "wf");
  const wfGroup = wfBlocks.length ? wfBlocks[wfBlocks.length - 1].group : null;
  return { wfGroup, jobBlocks: blocks.filter((b) => b.scope === "job") };
}

/**
 * Deadlock violations in a workflow text: job-level concurrency groups whose
 * normalized name equals the workflow-level group name (or resolves to the
 * same interpolation).
 */
export function violations(text) {
  const { wfGroup, jobBlocks } = analyze(text);
  if (!wfGroup) return [];
  return jobBlocks
    .filter((b) => b.group !== null && normalize(b.group) === normalize(wfGroup))
    .map((b) => ({ job: b.job, jobGroup: b.group, wfGroup, lineStart: b.start, lineEnd: b.end }));
}

/**
 * Repair a workflow text. mode:
 *   "strip"  — delete the offending job-level concurrency block entirely
 *              (the workflow-level group already serializes runs; the
 *              duplicate is pure self-deadlock).
 *   "suffix" — force-suffix the job-level group name (e.g. `-auto`) so it
 *              can never collide with the workflow-level group.
 * Returns { text, fixed: [ {job, action} ] }.
 */
export function applyFix(text, mode = "strip") {
  const vs = violations(text);
  if (!vs.length) return { text, fixed: [] };
  const lines = text.split("\n");
  const remove = new Set();
  const edits = [];

  for (const v of vs) {
    if (mode === "strip") {
      for (let i = v.lineStart; i <= v.lineEnd; i++) remove.add(i);
      edits.push({
        job: v.job,
        action: `stripped duplicate job-level concurrency block (lines ${v.lineStart + 1}-${v.lineEnd + 1})`,
      });
    } else if (mode === "suffix") {
      for (let i = v.lineStart; i <= v.lineEnd; i++) {
        const m = (lines[i] || "").match(/^(\s*)group:\s*(.+)$/);
        if (m) {
          const val = stripQuotes(m[2]);
          if (normalize(val) === normalize(v.wfGroup)) {
            lines[i] = `${m[1]}group: ${val}-auto # force-suffixed by self-healing (was identical to workflow-level group)`;
            edits.push({ job: v.job, action: `suffixed job-level group to '${val}-auto'` });
          }
        }
      }
    }
  }

  const out = mode === "strip" ? lines.filter((_, i) => !remove.has(i)) : lines;
  return { text: out.join("\n"), fixed: edits };
}

function listWorkflowFiles(dir = WORKFLOWS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => path.join(dir, f));
}

/** CLI entry */
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const fixIdx = process.argv.indexOf("--fix");
  const fixMode = fixIdx >= 0 ? process.argv[fixIdx + 1] || "strip" : null;

  const files = listWorkflowFiles();
  let total = 0;
  const report = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const vs = violations(text);
    if (!vs.length) continue;
    total += vs.length;
    report.push({ file: path.basename(file), violations: vs });

    if (fixMode) {
      const { text: fixedText, fixed } = applyFix(text, fixMode);
      fs.writeFileSync(file, fixedText, "utf8");
      for (const f of fixed) console.log(`REPAIRED ${path.basename(file)} job '${f.job}': ${f.action}`);
    } else {
      for (const v of vs) {
        console.error(
          `✗ DEADLOCK-PATTERN ${path.basename(file)}: job '${v.job}' job-level concurrency group '${v.jobGroup}' is identical to workflow-level group '${v.wfGroup}' — the job can never be scheduled and auto-fails at creation (no runner, 0 steps, no logs).`
        );
      }
    }
  }

  if (!fixMode) {
    if (total > 0) {
      console.error(`\n${total} self-deadlocking job(s) found across ${report.length} workflow file(s).`);
      console.error("Fix: delete the job-level `concurrency:` block (the workflow-level group already serializes runs).");
      console.error("Auto-fix with: node scripts/lint-workflow-concurrency.mjs --fix strip");
      process.exit(1);
    }
    console.log(`✓ ${files.length} workflow file(s) scanned — no concurrency self-deadlocks.`);
  } else {
    console.log(`\nFix mode '${fixMode}' complete: ${total} violation(s) processed.`);
  }
}
