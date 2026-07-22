#!/usr/bin/env node

/**
 * Owner Settlement Cron Daemon
 * 
 * Runs auto-settle-owner.mjs every 5 minutes
 * Also sends WhatsApp notification when payout is ready for Attijari repatriation
 * 
 * Start: node scripts/settle-cron.mjs
 * Stop: Ctrl+C or kill process
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INTERVAL_MS = 5 * 60 * 1000;
const STATE_FILE = path.join(ROOT, "exports", "settlement", "settle-state.json");
const WA_SERVER = "http://localhost:3000";

function log(msg) {
  console.log(`[${new Date().toISOString()}] [CRON] ${msg}`);
}

async function sendWhatsAppNotification(message) {
  try {
    const res = await fetch(`${WA_SERVER}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: "+212639158209",
        message,
      }),
    });
    if (res.ok) log("WhatsApp notification sent");
    else log(`WhatsApp notification failed: ${res.status}`);
  } catch (err) {
    log(`WhatsApp notification error: ${err.message}`);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { executedPayouts: [], totalSettledUSD: 0, lastRun: null };
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

      // Check if new payouts were made
      const state = loadState();
      if (state.executedPayouts.length > 0) {
        const lastPayout = state.executedPayouts[state.executedPayouts.length - 1];
        const now = Date.now();
        const payoutAge = now - new Date(lastPayout.executedAt).getTime();
        if (payoutAge < INTERVAL_MS * 2) {
          const msg = [
            "💰 Owner Settlement Complete",
            "",
            `Batch: ${lastPayout.batchId}`,
            `Amount: $${lastPayout.amount.toFixed(2)} USD`,
            `To: younestsouli2019@gmail.com`,
            "",
            "Next step: Log into Attijari-PayPal portal",
            "https://attijaripaypal.attijariwafa.com/PayPal",
            "",
            "Repatriate the balance to your Moroccan account.",
            "70% stays in USD, 30% converts to MAD.",
          ].join("\n");
          await sendWhatsAppNotification(msg);
        }
      }

      resolve();
    });
  });
}

async function main() {
  log("=== Owner Settlement Cron Daemon Started ===");
  log(`Interval: ${INTERVAL_MS / 1000}s`);

  // Run immediately
  await runSettlement();

  // Then on interval
  setInterval(runSettlement, INTERVAL_MS);
  log(`Next run in ${INTERVAL_MS / 1000}s`);
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
