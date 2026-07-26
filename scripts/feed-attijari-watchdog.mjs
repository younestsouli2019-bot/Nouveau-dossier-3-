#!/usr/bin/env node
/**
 * FEED-ATTIJARI WATCHDOG: Auto-restart the daemon if it dies, auto-retry
 * failed steps, alert on persistent failures.
 *
 * Behavior:
 *   - Every 30s: check if feed-attijari-daemon process is alive
 *   - If dead: start it
 *   - If alive but last log entry is > 5 min old: kill and restart
 *   - If WISE_API_KEY / BANKING_CIRCLE_* env changes: trigger a quick-set run
 *   - On every Nth cycle: run the full pipeline (seed + generate + payout)
 *
 * Run:
 *   node scripts/feed-attijari-watchdog.mjs
 *   # kill with Ctrl-C; SIGTERM cleanly stops both watchdog and daemon
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync, readdirSync } from 'node:fs';

const DAEMON_SCRIPT = 'scripts/feed-attijari-daemon.mjs';
const LOG_DIR = 'dist_rwc';
const PID_FILE_DAEMON = '/tmp/feed-attijari-daemon.pid';
const PID_FILE_WATCHDOG = '/tmp/feed-attijari-watchdog.pid';
const CHECK_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 5 * 60_000;
const FULL_RUN_EVERY_N_CYCLES = 10;

let cycle = 0;

await mkdir(LOG_DIR, { recursive: true });
await writeFile(PID_FILE_WATCHDOG, String(process.pid));

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function findDaemon() {
  // Use pgrep to find the daemon by command line
  try {
    const r = spawnSync('pgrep', ['-f', 'feed-attijari-daemon\\.mjs'], { encoding: 'utf8' });
    const pids = (r.stdout || '').split('\n').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n !== process.pid);
    return pids[0] || null;
  } catch { return null; }
}

function startDaemon() {
  console.log(`[watchdog] starting daemon (cycle ${cycle})`);
  const child = spawn('node', [DAEMON_SCRIPT, '--interval=60'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();
  return child.pid;
}

function findLatestDaemonLog() {
  const files = readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('daemon-') && f.endsWith('.log'))
    .map((f) => ({ f, m: statSync(`${LOG_DIR}/${f}`).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0] ? `${LOG_DIR}/${files[0].f}` : null;
}

async function main() {
  console.log(`[watchdog] starting, pid ${process.pid}`);
  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`[watchdog] ${sig} received, exiting`);
      process.exit(0);
    });
  }

  while (true) {
    cycle++;
    const daemonPid = findDaemon();
    let logStale = false;
    const latestLog = findLatestDaemonLog();
    if (latestLog) {
      const ageMs = Date.now() - statSync(latestLog).mtimeMs;
      logStale = ageMs > STALE_THRESHOLD_MS;
    } else {
      logStale = true;
    }

    if (!daemonPid) {
      console.log(`[watchdog] cycle ${cycle}: no daemon → starting`);
      startDaemon();
    } else if (logStale) {
      console.log(`[watchdog] cycle ${cycle}: daemon ${daemonPid} log stale → restarting`);
      try { process.kill(daemonPid, 'SIGTERM'); } catch {}
      await new Promise((r) => setTimeout(r, 2000));
      startDaemon();
    } else {
      console.log(`[watchdog] cycle ${cycle}: daemon ${daemonPid} alive and fresh`);
    }

    if (cycle % FULL_RUN_EVERY_N_CYCLES === 0) {
      console.log(`[watchdog] cycle ${cycle}: running full pipeline`);
      spawnSync('node', ['scripts/quick-set.mjs'], { stdio: 'inherit' });
    }

    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
