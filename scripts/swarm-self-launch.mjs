// ============================================================
// SWARM SELF-LAUNCH — local watchdog that replaces the manual
// START-SWARM.cmd starter.
//
// The owner no longer needs to run START-SWARM.cmd. This daemon
// periodically invokes the deployed Autonomous Orchestration Engine
// (/api/swarm/daemon), which runs:
//    1. reconcile-loop  (assess state)
//    2. verifyPayoutGuard (real-proof gate)
//    3. deploy-loop      (autonomous redeploy)
//    4. delivery-loop    (mission/payout delivery)
//
// It also keeps the local sub-daemons (autonomy watchdog, improve
// loop) resurrected, so the swarm self-launches from any origin:
// Vercel Cron, GitHub Actions, or this local watcher.
// ============================================================
import { writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA = resolve(ROOT, "data", "swarm_autonomy");
const PID_DIR = resolve(DATA, "pids");
const LOG_DIR = resolve(DATA, "logs");
[PID_DIR, LOG_DIR].forEach((d) => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

const MY_PID = process.pid;
const NAME = "swarm-self-launch";
const PID_FILE = resolve(PID_DIR, `${NAME}.pid`);
const LOG_FILE = resolve(LOG_DIR, `${NAME}.log`);

function logFast(msg) {
  const line = `[${new Date().toISOString()}] [${MY_PID}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
  if (process.env.SWARM_VERBOSE === "1") process.stdout.write(line);
}

logFast(`=== ${NAME} starting pid=${MY_PID} ===`);
writeFileSync(PID_FILE, JSON.stringify({ pid: MY_PID, startedAt: Date.now(), node: process.version }));
process.on("exit", () => { try { unlinkSync(PID_FILE); } catch {} });

// ─── Config ───────────────────────────────────────────────────
const DAEMON_URL = (
  process.env.SWARM_DAEMON_URL ||
  process.env.VERCEL_PROJECT_URL ||
  "swarm-ops-project.vercel.app"
).replace(/^https?:\/\//, "");
const CRON_SECRET = process.env.CRON_SECRET || "";
const INTERVAL_MS = (Number(process.env.SWARM_TICK_MS) || 60_000) * 2; // default every 2 min
const DRY_RUN = process.env.SWARM_DRY_RUN === "true";

// ─── Local daemon resurrection (replaces manual START-SWARM) ──
const LOCAL_DAEMONS = ["swarm-autonomy-daemon.mjs", "swarm-improve-loop.mjs"];

function pidIsAlive(pid) {
  try {
    const out = execSync(
      `tasklist /FI "PID eq ${pid}" /FO CSV /NH | Select-String -Pattern "${pid}"`,
      { shell: "powershell", encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return String(out).includes(String(pid));
  } catch {
    return false;
  }
}
function ensureLocalDaemons() {
  for (const script of LOCAL_DAEMONS) {
    const pidFile = resolve(PID_DIR, script.replace(".mjs", ".pid"));
    let alive = false;
    try {
      const p = JSON.parse(readFileSync(pidFile, "utf-8"));
      alive = pidIsAlive(p.pid);
    } catch {
      alive = false;
    }
    if (!alive) {
      const full = resolve(__dirname, script);
      if (existsSync(full)) {
        logFast(`[SELF-LAUNCH] starting local daemon ${script}`);
        const child = spawn(process.execPath, [full], {
          cwd: ROOT,
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
          env: { ...process.env, SWARM_SILENT: "1" },
        });
        child.unref();
        writeFileSync(pidFile, JSON.stringify({ pid: child.pid, startedAt: Date.now() }));
      }
    }
  }
}

// ─── Remote daemon invocation ─────────────────────────────────
async function mintToken() {
  if (!CRON_SECRET) return null;
  try {
    const res = await fetch(`https://${DAEMON_URL}/api/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    return body.token || null;
  } catch {
    return null;
  }
}

async function invokeDaemon() {
  const url = `https://${DAEMON_URL}/api/swarm/daemon`;
  const started = Date.now();
  try {
    // Mint a short-lived KMS-signed daemon token, fall back to CRON_SECRET
    const kmsToken = await mintToken();
    const authHeader = kmsToken
      ? `Bearer ${kmsToken}`
      : CRON_SECRET
        ? `Bearer ${CRON_SECRET}`
        : "";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ dry_run: DRY_RUN }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => ({}));
    const ms = Date.now() - started;
    const guard = body.guard?.passed ? "PASSED" : "NOT-PASSED";
    logFast(
      `[SELF-LAUNCH] daemon HTTP ${res.status} auth=${kmsToken ? "KMS" : CRON_SECRET ? "CRON" : "none"} guard=${guard} ` +
      `reconcile=${body.reconcile?.ok ? "ok" : "err"} ` +
      `deploy=${body.deploy?.status ?? "halted"} ` +
      `delivery=${body.delivery?.ok ? "ok" : "err"} (${ms}ms)`
    );
  } catch (err) {
    logFast(`[SELF-LAUNCH] daemon invocation failed after ${Date.now() - started}ms: ${err?.message || err}`);
  }
}

// ─── Main loop ────────────────────────────────────────────────
ensureLocalDaemons();
invokeDaemon();
setInterval(() => {
  ensureLocalDaemons();
  invokeDaemon();
}, INTERVAL_MS);

process.on("unhandledRejection", (r) => logFast("UNHANDLED-REJ: " + String(r?.message || r)));
process.on("uncaughtException", (e) => logFast("UNCAUGHT-EXC: " + e.message));
