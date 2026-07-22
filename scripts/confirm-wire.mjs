#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const STATE_FILE = path.join(ROOT, "exports", "settlement", "settle-state.json");
const INSTRUCTIONS_DIR = path.join(ROOT, "exports", "settlement", "instructions");
const LOG_FILE = path.join(ROOT, "exports", "settlement", "settle-log.json");

function loadJson(fp) {
  try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null; } catch { return null; }
}

function saveJson(fp, data) {
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function log(msg, level = "INFO") {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
  let logs = loadJson(LOG_FILE) || [];
  logs.push({ timestamp: ts, level, message: msg });
  if (logs.length > 2000) logs = logs.slice(-2000);
  saveJson(LOG_FILE, logs);
}

function parseArgs(args) {
  const result = { batchId: null, transactionId: null, amount: null, status: "confirmed" };
  for (const arg of args) {
    if (arg.startsWith("--transaction-id=")) result.transactionId = arg.split("=")[1];
    else if (arg.startsWith("--amount=")) result.amount = parseFloat(arg.split("=")[1]);
    else if (arg.startsWith("--status=")) result.status = arg.split("=")[1];
    else if (!arg.startsWith("--")) result.batchId = arg;
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.batchId) {
    console.log("Usage: node scripts/confirm-wire.mjs <batchId> --transaction-id=<REF> --amount=<MAD>");
    console.log("Example: node scripts/confirm-wire.mjs SETTLE_1784735054550_0 --transaction-id=TXN123456 --amount=50433.39");
    process.exit(1);
  }

  const state = loadJson(STATE_FILE);
  if (!state) { console.error("No settle state found"); process.exit(1); }

  const batchPayouts = state.executedPayouts.filter(p => p.batchId === args.batchId);
  if (batchPayouts.length === 0) { console.error(`Batch ${args.batchId} not found`); process.exit(1); }

  const now = new Date().toISOString();
  for (const payout of batchPayouts) {
    payout.status = args.status;
    payout.transactionId = args.transactionId || null;
    payout.confirmedAt = now;
    if (args.amount) payout.confirmedAmountMAD = args.amount;
  }

  state.confirmedPayouts = state.confirmedPayouts || [];
  state.confirmedPayouts.push({
    batchId: args.batchId,
    transactionId: args.transactionId,
    amountMAD: args.amount,
    revenueCount: batchPayouts.length,
    totalRevenueUSD: batchPayouts.reduce((s, p) => s + p.amount, 0),
    status: args.status,
    confirmedAt: now,
  });

  saveJson(STATE_FILE, state);

  const instrPath = path.join(INSTRUCTIONS_DIR, `wire_${args.batchId}.json`);
  const instr = loadJson(instrPath);
  if (instr) {
    instr.status = args.status;
    instr.transaction_id = args.transactionId;
    instr.confirmed_at = now;
    if (args.amount) instr.confirmed_amount_mad = args.amount;
    saveJson(instrPath, instr);
  }

  const totalUSD = batchPayouts.reduce((s, p) => s + p.amount, 0);
  log(`Wire confirmed: ${args.batchId} | TX: ${args.transactionId} | ${args.amount} MAD | ${batchPayouts.length} revenues | $${totalUSD.toFixed(2)} USD`);

  console.log("\n✅ WIRE CONFIRMED");
  console.log(`   Batch: ${args.batchId}`);
  console.log(`   Transaction: ${args.transactionId}`);
  console.log(`   Amount: ${args.amount} MAD`);
  console.log(`   Revenues: ${batchPayouts.length}`);
  console.log(`   Total USD: $${totalUSD.toFixed(2)}`);
  console.log(`   Status: ${args.status}`);
}

main();
