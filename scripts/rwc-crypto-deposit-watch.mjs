#!/usr/bin/env node
/**
 * rwc-crypto-deposit-watch.mjs — matches incoming Bitget USDT deposits to
 * course orders by exact-amount fingerprint (Stripe-free crypto checkout).
 *
 * The crypto checkout page shows each buyer a course-specific exact amount:
 *   price = BASE + (slugHash % 10000) / 10000   (e.g. 19.3753 USDT)
 * This script recomputes the fingerprint for all 298 catalog slugs and
 * matches confirmed Bitget deposits by exact amount → identifies the course
 * automatically. Buyer identity arrives by email (order reference flow);
 * the watcher records the order as PAID with delivery PENDING until the
 * mail provider key exists (replayable via rwc-flush-pending-deliveries.mjs).
 *
 * FAIL-CLOSED: read-only against Bitget by default. --record appends matched
 * orders to data/out/course-orders.ndjson (idempotent by txid). No funds are
 * ever moved by this script.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import ccxt from "ccxt";

const BASE = Number(process.env.RWC_BASE_PRICE_USD) || 19;
const LEDGER = path.resolve("data", "out", "course-orders.ndjson");
const RECORD = process.argv.includes("--record");

function fingerprintCents(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 10000;
  return Math.round((BASE + h / 10000) * 10000);
}

function loadCatalog() {
  const snap = JSON.parse(fs.readFileSync("src/data/rwc-catalog-snapshot.json", "utf8"));
  const byCents = new Map();
  for (const c of snap) {
    const cents = fingerprintCents(c.s);
    if (!byCents.has(cents)) byCents.set(cents, []);
    byCents.get(cents).push(c);
  }
  return { byCents };
}

function existingTxids() {
  try {
    return new Set(
      fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => {
        try { return JSON.parse(l).txid; } catch { return null; }
      }).filter(Boolean),
    );
  } catch { return new Set(); }
}

async function main() {
  const { byCents } = loadCatalog();
  const ex = new ccxt.bitget({
    apiKey: process.env.BITGET_API_KEY,
    secret: process.env.BITGET_API_SECRET,
    password: process.env.BITGET_PASSPHRASE,
    enableRateLimit: true,
    timeout: 30000,
  });

  const deposits = await ex.fetchDeposits("USDT");
  console.log(`deposits found: ${deposits.length}`);
  const seen = existingTxids();
  let matched = 0;
  for (const d of deposits) {
    const statusOk = ["ok", "success", "finished", "credited"].includes(String(d.status ?? "").toLowerCase());
    const txid = d.txid ?? d.id ?? "";
    if (!txid) continue;
    const cents = Math.round(Number(d.amount) * 10000);
    const candidates = byCents.get(cents) ?? [];
    if (candidates.length === 0) continue; // not a course-fingerprint deposit
    matched++;
    const isKnown = seen.has(txid);
    const label = candidates.map((c) => c.t).join(" | ");
    console.log(
      `${isKnown ? "recorded" : "NEW"} deposit ${d.amount} USDT (${txid.slice(0, 18)}…${txid.slice(-6)}) status=${d.status} → course(s): ${label}`,
    );
    if (RECORD && !isKnown && statusOk) {
      const order = {
        ts: new Date().toISOString(),
        event_id: `crypto-deposit-${txid.slice(0, 12)}`,
        session_id: txid,
        email: "",
        slug: candidates.length === 1 ? candidates[0].s : candidates.map((c) => c.s).join(","),
        title: candidates.length === 1 ? candidates[0].t : label,
        amount_total: Number(d.amount),
        currency: "usdt",
        status: "PAID",
        delivery: "PENDING",
        delivery_detail: "crypto deposit matched by fingerprint; buyer email pending order reference",
        network: d.network ?? "",
      };
      fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
      fs.appendFileSync(LEDGER, JSON.stringify(order) + "\n", "utf8");
      console.log("  → recorded to course-orders ledger");
    } else if (RECORD && !statusOk) {
      console.log("  → not recorded (deposit not confirmed yet)");
    }
  }
  console.log(`fingerprint-matched deposits: ${matched} (${RECORD ? "record mode" : "dry-run — pass --record to append"})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
