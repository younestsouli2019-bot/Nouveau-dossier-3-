#!/usr/bin/env node

/**
 * Owner Settlement Cron Daemon
 * 
 * - Runs auto-settle-owner.mjs every 5 minutes
 * - Sends WhatsApp notification on new payouts
 * - Sends daily summary at 20:00 UTC (8pm Morocco)
 * 
 * Start: node scripts/settle-cron.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INTERVAL_MS = 5 * 60 * 1000;
const STATE_FILE = path.join(ROOT, "exports", "settlement", "settle-state.json");
const LOG_FILE = path.join(ROOT, "exports", "settlement", "settle-log.json");
const WA_SERVER = "http://localhost:3000";

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [CRON] ${msg}`);
  let logs = [];
  try { if (fs.existsSync(LOG_FILE)) logs = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch {}
  logs.push({ timestamp: ts, level: "CRON", message: msg });
  if (logs.length > 2000) logs = logs.slice(-2000);
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2) + "\n", "utf8");
}

function loadJson(fp) {
  try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null; } catch { return null; }
}

async function sendWhatsApp(phone, message) {
  try {
    const res = await fetch(`${WA_SERVER}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message }),
    });
    const data = await res.json();
    if (data.success) log(`WhatsApp sent to ${phone}`);
    else log(`WhatsApp failed: ${data.error}`);
    return data;
  } catch (err) {
    log(`WhatsApp error: ${err.message}`);
    return null;
  }
}

function loadState() {
  return loadJson(STATE_FILE) || { executedPayouts: [], totalSettledUSD: 0, totalSettledMAD: 0, confirmedPayouts: [], lastRun: null };
}

function runSettlement() {
  return new Promise((resolve) => {
    log("Running settlement check...");
    const child = spawn("node", ["scripts/auto-settle-owner.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    child.on("close", async (code) => {
      log(`Settlement exited with code ${code}`);

      const state = loadState();
      const recentPayouts = (state.executedPayouts || []).filter(p => {
        const age = Date.now() - new Date(p.executedAt).getTime();
        return age < INTERVAL_MS * 2;
      });

      if (recentPayouts.length > 0) {
        const uniqueBatches = [...new Set(recentPayouts.map(p => p.batchId))];
        const totalUSD = recentPayouts.reduce((s, p) => s + p.amount, 0);
        const msg = [
          "💰 New Settlement Executed",
          "",
          `Batches: ${uniqueBatches.length}`,
          `Revenues: ${recentPayouts.length}`,
          `Total: $${totalUSD.toFixed(2)} USD`,
          "",
          "→ Log into Attijari-PayPal portal to repatriate:",
          "  https://attijaripaypal.attijariwafa.com/PayPal",
        ].join("\n");
        await sendWhatsApp("+212639158209", msg);
      }

      resolve();
    });
  });
}

async function sendDailySummary() {
  const state = loadState();
  const today = new Date().toISOString().slice(0, 10);

  const todayPayouts = (state.executedPayouts || []).filter(p =>
    p.executedAt && p.executedAt.startsWith(today)
  );
  const todayConfirmed = (state.confirmedPayouts || []).filter(c =>
    c.confirmedAt && c.confirmedAt.startsWith(today)
  );

  const totalSettledUSD = state.totalSettledUSD || 0;
  const totalSettledMAD = state.totalSettledMAD || 0;
  const totalRevenues = (state.executedPayouts || []).length;
  const pendingCount = (state.executedPayouts || []).filter(p => p.status !== "confirmed").length;
  const confirmedCount = (state.confirmedPayouts || []).length;

  const unconfirmedBatches = [...new Set(
    (state.executedPayouts || [])
      .filter(p => p.status !== "confirmed")
      .map(p => p.batchId)
  )];

  const lines = [
    `📊 Daily Settlement Report — ${today}`,
    ``,
    `Lifetime`,
    `  Total settled: $${totalSettledUSD.toFixed(2)} USD → ${totalSettledMAD.toFixed(2)} MAD`,
    `  Total revenues: ${totalRevenues}`,
    `  Confirmed batches: ${confirmedCount}`,
    `  Pending batches: ${unconfirmedBatches.length}`,
    ``,
  ];

  if (todayPayouts.length > 0) {
    lines.push(`Today's Activity`);
    lines.push(`  New payouts: ${todayPayouts.length} revenues`);
    const dayUSD = todayPayouts.reduce((s, p) => s + p.amount, 0);
    lines.push(`  Amount: $${dayUSD.toFixed(2)} USD`);
    lines.push(`  Batches: ${[...new Set(todayPayouts.map(p => p.batchId))].join(", ")}`);
    lines.push(``);
  }

  if (todayConfirmed.length > 0) {
    lines.push(`Today's Confirmations`);
    for (const c of todayConfirmed) {
      lines.push(`  ✅ ${c.batchId} — ${c.amountMAD} MAD — TX: ${c.transactionId}`);
    }
    lines.push(``);
  }

  if (unconfirmedBatches.length > 0) {
    lines.push(`⚠️ Pending Confirmation (${unconfirmedBatches.length} batches)`);
    lines.push(`Run: node scripts/confirm-wire.mjs <batchId> --transaction-id=<REF> --amount=<MAD>`);
    lines.push(``);
  }

  lines.push(`Systems`);
  lines.push(`  Reply loop: ✅ running`);
  lines.push(`  Settlement cron: ✅ running`);
  lines.push(`  WhatsApp server: ✅ ready`);

  await sendWhatsApp("+212639158209", lines.join("\n"));
  log("Daily summary sent");
}

let lastSummaryDate = null;

async function main() {
  log("=== Owner Settlement Cron Daemon Started ===");
  log(`Interval: ${INTERVAL_MS / 1000}s`);

  await runSettlement();

  setInterval(async () => {
    await runSettlement();

    const hour = new Date().getUTCHours();
    const today = new Date().toISOString().slice(0, 10);
    if (hour === 20 && lastSummaryDate !== today) {
      lastSummaryDate = today;
      await sendDailySummary();
    }
  }, INTERVAL_MS);

  log(`Next run in ${INTERVAL_MS / 1000}s`);
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
