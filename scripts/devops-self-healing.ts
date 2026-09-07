/**
 * devops-self-healing — CLI for the Autonomous Self-Healing Blueprint.
 *
 *   Static Engine (pre-flight):
 *     npx tsx scripts/devops-self-healing.ts sanitize --check .github/workflows
 *     npx tsx scripts/devops-self-healing.ts sanitize --fix    .github/workflows
 *
 *   Dynamic Engine (control-plane scan, no repair):
 *     npx tsx scripts/devops-self-healing.ts scan
 *       env: GH_TOKEN, REPOSITORY (= "owner/repo")
 *
 *   Self-Healing loop (scan + repair + circuit breaker):
 *     npx tsx scripts/devops-self-healing.ts heal
 *       env: GH_TOKEN, REPOSITORY,
 *            SELF_HEAL_STATE_FILE (default logs/devops-self-healing/state.json)
 *            SELF_HEAL_ALERT_WEBHOOK (optional emergency channel)
 *
 * Exit codes: 0 clean / repairs applied successfully; 1 offenses found
 * (--check) or hard error.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeWorkflow, fixWorkflow } from '../src/devops/workflow-sanitize';
import {
  advanceBreaker, alertEmergencyChannel, repairWorkflowFile,
  scanDeadlocks, DEFAULT_STATE, type BreakerState,
} from '../src/devops/deadlock-heal';

interface Args {
  command?: string;
  check?: boolean;
  fix?: boolean;
  dir?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  const rest = [...argv];
  out.command = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (a === '--check') out.check = true;
    else if (a === '--fix') out.fix = true;
    else if (a && !a.startsWith('--')) out.dir = a;
  }
  return out;
}

const USAGE = [
  'usage: npx tsx scripts/devops-self-healing.ts <sanitize|scan|heal> [flags]',
  '  sanitize [--check|--fix] <dir> — static AST/pattern analysis of workflow files',
  '  scan                         — control-plane logless-deadlock scan (read-only)',
  '  heal                         — scan + repair + circuit breaker (self-healing loop)',
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'sanitize':
      process.exit(sanitize(args));
    case 'scan':
      scan(false).catch((e) => { console.error(e); process.exit(1); });
      break;
    case 'heal':
      scan(true).catch((e) => { console.error(e); process.exit(1); });
      break;
    default:
      console.log(USAGE.join('\n'));
      process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Static engine
// ---------------------------------------------------------------------------

function sanitize(args: Args): number {
  const dir = args.dir ?? '.github/workflows';
  if (!fs.existsSync(dir)) {
    console.log(`no workflow directory ${dir} — nothing to sanitize (graceful skip)`);
    return 0;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  let offenses = 0;
  for (const f of files) {
    const full = path.join(dir, f);
    const text = fs.readFileSync(full, 'utf8');
    const found = analyzeWorkflow(full, text);
    for (const o of found) {
      offenses++;
      console.log(
        `OFFENSE ${full}: job '${o.job}' child concurrency group '${o.childGroup}' ` +
        `duplicates workflow-level group '${o.parentGroup}' (line ${o.line}) — deadlock hazard`
      );
    }
    if (args.fix && found.length > 0) {
      const r = fixWorkflow(text);
      fs.writeFileSync(full, r.text);
      console.log(`REPAIRED ${full}: removed ${r.fixed.length} duplicate child concurrency block(s)`);
    }
  }
  if (offenses === 0) {
    console.log(`clean: no duplicate child concurrency groups in ${dir}`);
    return 0;
  }
  if (args.fix) {
    console.log(`${offenses} hazard(s) repaired.`);
    return 0;
  }
  if (args.check) {
    console.log(`${offenses} hazard(s) found${args.check ? ' — BLOCKING (pre-flight)' : ''}`);
    return 1;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Dynamic engine + repair loop
// ---------------------------------------------------------------------------

async function scan(heal: boolean): Promise<void> {
  const token = process.env.GH_TOKEN;
  const repo = process.env.REPOSITORY;
  if (!token || !repo) {
    console.log('GH_TOKEN / REPOSITORY not set — control-plane scan skipped (graceful skip).');
    process.exit(0);
  }

  const deadlocks = await scanDeadlocks({ repo, token });
  if (deadlocks.length === 0) {
    console.log('no logless deadlocks in recent failures — control plane healthy.');
    if (heal) await updateState(false, deadlocks, repo, token);
    process.exit(0);
  }

  console.log(`deadlock signature detected in ${deadlocks.length} run(s):`);
  for (const d of deadlocks) {
    console.log(`  run #${d.runId} (${d.name}) → ${d.workflowPath ?? 'unknown path'} — ${d.reason}`);
  }

  if (!heal) process.exit(1);

  // Active repairman: repair each distinct workflow file once.
  const targets = [...new Set(deadlocks.map((d) => d.workflowPath).filter((p): p is string => !!p))];
  let repairs = 0;
  for (const wfPath of targets) {
    if (!fs.existsSync(wfPath)) {
      console.log(`  repair: ${wfPath} not on disk — skipping`);
      continue;
    }
    const text = fs.readFileSync(wfPath, 'utf8');
    const r = repairWorkflowFile(wfPath, text);
    if (r.changed) {
      fs.writeFileSync(wfPath, r.text);
      repairs++;
      console.log(`  REPAIRED ${wfPath}: removed ${r.offenses.length} duplicate child concurrency block(s)`);
    } else {
      console.log(`  ${wfPath}: no duplicate child concurrency present — deadlock persists for another reason; flagging for engineering`);
    }
  }

  const tripped = await updateState(true, deadlocks, repo, token);
  process.exit(repairs > 0 ? 0 : 1);
}

async function updateState(
  triggered: boolean,
  deadlocks: Awaited<ReturnType<typeof scanDeadlocks>>,
  repo: string,
  token: string
): Promise<boolean> {
  const stateFile = process.env.SELF_HEAL_STATE_FILE ?? 'logs/devops-self-healing/state.json';
  let state: BreakerState = DEFAULT_STATE;
  try {
    if (fs.existsSync(stateFile)) {
      state = { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
    }
  } catch {
    state = DEFAULT_STATE;
  }

  const r = advanceBreaker(state, triggered);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(r.state, null, 2) + '\n');
  } catch {
    console.log(`note: could not persist breaker state to ${stateFile}`);
  }

  console.log(
    `circuit breaker: ${r.state.consecutiveTriggers} consecutive trigger(s)` +
    (r.state.tripped ? ' — TRIPPED (engine-level malfunction suspected)' : '')
  );

  if (r.trippedNow) {
    const webhook = process.env.SELF_HEAL_ALERT_WEBHOOK;
    if (webhook) {
      void alertEmergencyChannel(webhook, {
        repo, consecutiveTriggers: r.state.consecutiveTriggers, lastRuns: deadlocks.slice(0, 5),
      }).then((ok) => {
        console.log(ok ? 'emergency alert delivered' : 'emergency alert FAILED to deliver');
        void token; // token unused for the alert channel; kept for signature symmetry
      });
    } else {
      console.log('SELF_HEAL_ALERT_WEBHOOK not set — breaker tripped without external alert (set the secret to wire emergency channels).');
    }
  }
  return r.trippedNow;
}

main();
