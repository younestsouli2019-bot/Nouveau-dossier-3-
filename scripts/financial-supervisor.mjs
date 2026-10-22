#!/usr/bin/env node
/**
 * financial-supervisor.mjs — infra-upgrade allocation supervisor.
 *
 * Reads REAL revenue (Bitget USDT balance + course-orders ledger) and computes
 * the infrastructure budget per the documented allocation (reserve share of
 * revenue, default 30% — the 70/30 reinvest/reserve split from the revenue
 * runner). When the accumulated budget crosses the configured upgrade cost
 * threshold, it emits an UPGRADE_DUE decision.
 *
 * The actual purchase at billing.base44.com is a payment action on the
 * owner's account: this supervisor NEVER executes it. It decides, records,
 * and hands the owner a one-click link. Fail-closed by construction.
 *
 * Usage:
 *   node scripts/financial-supervisor.mjs                # evaluate + print
 *   node scripts/financial-supervisor.mjs --record       # append decision to ledger
 * Env: INFRA_BUDGET_PCT (default 30), UPGRADE_COST_USD (default 20),
 *      BUDGET_LEDGER (default data/out/infra-budget-ledger.ndjson)
 */
import fs from "fs";
import path from "path";

const PCT = Number(process.env.INFRA_BUDGET_PCT || 30);
const COST = Number(process.env.UPGRADE_COST_USD || 20);
const LEDGER = path.resolve(process.env.BUDGET_LEDGER || "data/out/infra-budget-ledger.ndjson");
const RECORD = process.argv.includes("--record");

async function bitgetUsdt() {
  const { default: ccxt } = await import("ccxt");
  const ex = new ccxt.bitget({
    apiKey: process.env.BITGET_API_KEY, secret: process.env.BITGET_API_SECRET,
    password: process.env.BITGET_PASSPHRASE, enableRateLimit: true,
  });
  const bal = await ex.fetchBalance();
  const usdt = bal?.total?.USDT ? Number(bal.total.USDT) : 0;
  return usdt;
}

function readLedgerGross() {
  // gross recorded sales from the course-orders ledger (if present)
  try {
    const rows = fs.readFileSync("data/out/course-orders.ndjson", "utf-8").split("\n").filter(Boolean);
    let gross = 0;
    for (const r of rows) { try { gross += Number(JSON.parse(r).amount || 0); } catch {} }
    return gross;
  } catch { return 0; }
}

function prevBudget() {
  try {
    const rows = fs.readFileSync(LEDGER, "utf-8").split("\n").filter(Boolean);
    const last = JSON.parse(rows[rows.length - 1]);
    return last.budget_after ?? 0;
  } catch { return 0; }
}

const main = async () => {
  let bitget = 0;
  try { bitget = await bitgetUsdt(); } catch (e) { console.log("bitget unreachable:", e.message.slice(0, 80)); }
  const ledgerGross = readLedgerGross();
  const gross = bitget; // real on-chain/custodial revenue today
  const budget = prevBudget() + (gross * PCT) / 100;
  const due = budget >= COST;
  const decision = {
    at: new Date().toISOString(),
    gross_revenue_usdt: Math.round(gross * 10000) / 10000,
    ledger_gross_usdt: Math.round(ledgerGross * 10000) / 10000,
    alloc_pct: PCT,
    budget_before: Math.round(prevBudget() * 10000) / 10000,
    budget_after: Math.round(budget * 10000) / 10000,
    upgrade_cost_usd: COST,
    decision: due ? "UPGRADE_DUE" : "HOLD",
    action_owner: "owner — purchase at https://billing.base44.com (supervisor never executes payments)",
  };
  console.log(JSON.stringify(decision, null, 2));
  if (RECORD) {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify(decision) + "\n");
    console.log("→ appended to", LEDGER);
  }
  process.exit(0);
};
main();
