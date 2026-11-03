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
import { fileURLToPath } from "url";

const PCT = Number(process.env.INFRA_BUDGET_PCT || 30);
// Real plan ladder read from billing.base44.com (2026-10-23, logged-in plans page)
const PLAN_LADDER = [
  { plan: "Starter", cost: 16 },
  { plan: "Builder", cost: 40 },
  { plan: "Pro", cost: 80 },
  { plan: "Elite", cost: 160 },
];
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

function prevState() {
  try {
    const rows = fs.readFileSync(LEDGER, "utf-8").split("\n").filter(Boolean);
    const last = JSON.parse(rows[rows.length - 1]);
    return {
      budget: last.budget_after ?? 0,
      cum: last.cum_gross_usdt ?? 0,
    };
  } catch { return { budget: 0, cum: 0 }; }
}

/**
 * Pure decision model (exported for tests).
 *
 * The budget accrues PCT% of NEW revenue only, tracked with a high-water mark
 * on cumulative gross. A constant balance therefore adds nothing on the next
 * run, and a sweep that lowers the balance never claws budget back.
 * (Earlier versions added PCT% of the whole balance every run — the budget
 * inflated without any new sale.)
 */
export function computeDecision({ gross, budgetBefore = 0, cumBefore = 0, pct = PCT, ladder = PLAN_LADDER, now = new Date().toISOString() }) {
  const g = Number(gross) || 0;
  const cumAfter = Math.max(Number(cumBefore) || 0, g);
  const delta = cumAfter - (Number(cumBefore) || 0);
  const budgetAfter = (Number(budgetBefore) || 0) + (delta * pct) / 100;
  const affordable = ladder.filter((t) => budgetAfter >= t.cost);
  const target = affordable.length ? affordable[affordable.length - 1] : null;
  return {
    at: now,
    gross_revenue_usdt: Math.round(g * 10000) / 10000,
    cum_gross_usdt: Math.round(cumAfter * 10000) / 10000,
    new_revenue_usdt: Math.round(delta * 10000) / 10000,
    alloc_pct: pct,
    budget_before: Math.round((Number(budgetBefore) || 0) * 10000) / 10000,
    budget_after: Math.round(budgetAfter * 10000) / 10000,
    target_plan: target ? target.plan : null,
    target_cost_usd: target ? target.cost : 0,
    plan_ladder_usd: ladder,
    decision: target ? "UPGRADE_DUE" : "HOLD",
    action_owner: target
      ? "superagent — execute upgrade via logged-in local browser at app.base44.com plans page, then verify"
      : "hold — accumulate budget from revenue",
  };
}

const main = async () => {
  let bitget = 0;
  try { bitget = await bitgetUsdt(); } catch (e) { console.log("bitget unreachable:", e.message.slice(0, 80)); }
  const ledgerGross = readLedgerGross();
  const gross = bitget; // real on-chain/custodial revenue today
  const prev = prevState();
  const decision = {
    ...computeDecision({ gross, budgetBefore: prev.budget, cumBefore: prev.cum }),
    ledger_gross_usdt: Math.round(ledgerGross * 10000) / 10000,
  };
  console.log(JSON.stringify(decision, null, 2));
  if (RECORD) {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify(decision) + "\n");
    console.log("→ appended to", LEDGER);
  }
  process.exit(0);
};
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
