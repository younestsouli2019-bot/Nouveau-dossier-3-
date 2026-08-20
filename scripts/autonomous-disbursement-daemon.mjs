/**
 * autonomous-disbursement-daemon.mjs
 * ==================================
 * Hands-free autonomous disbursement daemon.
 * Runs on schedule (cron or pm2), polls the Base44 backend function,
 * and auto-disburses settled transactions to pre-set owner accounts.
 *
 * No manual action required. Configure once, runs forever.
 *
 * Usage:
 *   node scripts/autonomous-disbursement-daemon.mjs                    # single run
 *   node scripts/autonomous-disbursement-daemon.mjs --watch --interval=4h  # daemon mode
 *   pm2 start scripts/autonomous-disbursement-daemon.mjs -- --watch --interval=4h  # production
 *
 * The Base44 scheduled workflow also fires this every 4 hours — this daemon
 * is for local/cron redundancy and faster cycles if needed.
 */

const BACKEND_URL = process.env.AUTO_DISBURSE_URL ||
  "https://superagent-d5a9f123.base44.app/functions/autoDisbursePipeline";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function parseInterval(str) {
  const m = String(str).match(/^(\d+)(s|m|h|d)$/);
  if (!m) return 4 * 60 * 60 * 1000; // default 4h
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return n * mult;
}

async function runCycle() {
  const now = new Date().toISOString();
  console.log(`\n[${now}] ▶ Auto-disbursement cycle starting...`);

  try {
    const resp = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const result = await resp.json();

    if (result.status === "completed") {
      console.log(`[${now}] ✅ Disbursed ${result.disbursed} transaction(s)`);
      console.log(`    Total: $${result.total_disbursed_usd} | Fees: $${result.total_fees_usd}`);
      for (const r of result.results || []) {
        console.log(`    → ${r.transaction_id}: $${r.net_amount} via ${r.rail}`);
      }
    } else if (result.status === "idle") {
      console.log(`[${now}] ⏸ Idle — ${result.message}`);
    } else if (result.status === "needs_config") {
      console.log(`[${now}] ⚠️ Config needed — ${result.message}`);
    } else {
      console.log(`[${now}] ❓ Unknown status: ${result.status} — ${result.message || ""}`);
    }

    return result;
  } catch (err) {
    console.error(`[${now}] ❌ Error: ${err.message}`);
    return { status: "error", message: err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.watch) {
    const interval = parseInterval(args.interval || "4h");
    console.log(`🤖 Autonomous Disbursement Daemon — watch mode`);
    console.log(`   Interval: every ${args.interval || "4h"}`);
    console.log(`   Backend: ${BACKEND_URL}`);
    console.log(`   Press Ctrl+C to stop\n`);

    await runCycle();

    setInterval(async () => {
      await runCycle();
    }, interval);
  } else {
    await runCycle();
  }
}

main();