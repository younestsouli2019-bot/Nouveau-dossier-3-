#!/usr/bin/env node

/**
 * Automated Owner Settlement Pipeline (Multi-Rail)
 * 
 * Reads from ledger → tries payment rails in priority order:
 * 1. Bank Wire (Banking Circle → Attijari Morocco)
 * 2. PayPal Payout (if PPP2 approved)
 * 3. Crypto (USDT/BEP20)
 * 
 * Owner Account: Attijariwafa Bank, RIB 007810000448500030594182
 * Intermediary: Banking Circle LU774080000041265646 (SWIFT BCIRLULL)
 * 
 * Run: node scripts/auto-settle-owner.mjs
 * Cron: node scripts/auto-settle-owner.mjs --cron
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { executeCryptoPayout } from "./crypto-payout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Config ──────────────────────────────────────────────────────────────────
const OWNER = {
  paypalEmail: process.env.OWNER_PAYPAL_EMAIL || "younestsouli2019@gmail.com",
  rib: process.env.MOROCCAN_BANK_RIB || "007810000448500030594182",
  bankIban: process.env.IBAN_BC || "LU774080000041265646",
  bankSwift: process.env.OWNER_SWIFT || "BCIRLULL",
  beneficiaryName: process.env.OWNER_BENEFICIARY_NAME || "Mr Younes Tsouli",
  bankName: process.env.BANK_NAME_BC || "Banking Circle S.A.",
  bankAddress: process.env.BANK_ADDRESS_BC || "2, Boulevard de la Foire L-1528 LUXEMBOURG",
  // Crypto deposit address (owner wallet that receives USDT/USDC/NATIVE)
  cryptoAddress: process.env.OWNER_CRYPTO_ADDRESS || "",
  cryptoChain: (process.env.OWNER_CRYPTO_CHAIN || "bsc").toLowerCase(),
  cryptoToken: (process.env.OWNER_CRYPTO_TOKEN || "USDT").toUpperCase(),
};

const POLICY = {
  minPayoutUSD: 50,
  maxSinglePayoutUSD: 5000,
  fxRate: 10.2,
  cronIntervalMs: 5 * 60 * 1000,
};

const PAYPAL_BASE = process.env.PAYPAL_API_BASE_URL?.trim() || "https://api-m.paypal.com";

// ─── Paths ───────────────────────────────────────────────────────────────────
const LEDGER_BASE44 = path.join(ROOT, ".base44-offline-store.json");
const LEDGER_AUTONOMOUS = path.join(ROOT, ".autonomous-offline-store.json");
const STATE_FILE = path.join(ROOT, "exports", "settlement", "settle-state.json");
const LOG_FILE = path.join(ROOT, "exports", "settlement", "settle-log.json");
const INSTRUCTIONS_DIR = path.join(ROOT, "exports", "settlement", "instructions");

// ─── Utilities ───────────────────────────────────────────────────────────────
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

function loadState() {
  return loadJson(STATE_FILE) || {
    executedPayouts: [],
    totalSettledUSD: 0,
    totalSettledMAD: 0,
    lastRun: null,
  };
}

// ─── Ledger Reader ───────────────────────────────────────────────────────────
function getUnsettledRevenues() {
  const state = loadState();
  const settledIds = new Set(state.executedPayouts.map(p => p.earningId));

  // Also check legacy auto-wire-state to prevent double-processing
  const legacyState = loadJson(path.join(ROOT, "exports", "bank-wire", "auto-wire-state.json"));
  if (legacyState?.executedWires) {
    for (const w of legacyState.executedWires) settledIds.add(w.earningId);
  }

  const revenues = [];

  for (const storePath of [LEDGER_BASE44, LEDGER_AUTONOMOUS]) {
    const store = loadJson(storePath);
    if (!store?.entities?.Earning?.records) continue;

    for (const e of store.entities.Earning.records) {
      if (settledIds.has(e.id)) continue;
      const amount = parseFloat(String(e.amount).replace(",", "."));
      if (!amount || amount <= 0) continue;

      const retained = Number((amount * 0.70).toFixed(2));
      const converted = Number((amount * 0.30).toFixed(2));
      const convertedMAD = Number((converted * POLICY.fxRate).toFixed(2));

      revenues.push({
        id: e.id,
        amount,
        currency: e.currency || "USD",
        occurredAt: e.occurred_at || e.created_at,
        split: { retained, converted, convertedMAD },
      });
    }
  }
  return revenues;
}

// ─── Rail: Bank Wire (Banking Circle → Attijari) ─────────────────────────────
async function executeBankWire(payoutAmount, batchId, revenues, totalUSD) {
  const reference = `WIRES-${batchId}-${Date.now()}`;
  const totalRetained = revenues.reduce((s, r) => s + r.split.retained, 0);
  const totalConverted = revenues.reduce((s, r) => s + r.split.converted, 0);
  const totalMAD = Number((totalConverted * POLICY.fxRate).toFixed(2));

  const instruction = {
    type: "bank_wire_settlement",
    rail: "bank_wire",
    batch_id: batchId,
    reference,
    status: "ready_for_portal",
    created_at: new Date().toISOString(),

    source: {
      bank: OWNER.bankName,
      address: OWNER.bankAddress,
      iban: OWNER.bankIban,
      swift: OWNER.bankSwift,
      beneficiary: OWNER.beneficiaryName,
    },

    destination: {
      bank: "Attijariwafa Bank",
      rib: OWNER.rib,
      swift: "BCMAMAMC",
      branch: "RABAT AGDAL, 83 AV. FAL OULD OUMEIR",
      beneficiary: "M TSOULI YOUNES",
      country: "MA",
      city: "RABAT",
    },

    amount: {
      payout_usd: payoutAmount,
      total_revenue_usd: totalUSD,
      retained_usd: totalRetained,
      converted_usd: totalConverted,
      converted_mad: totalMAD,
      fx_rate: POLICY.fxRate,
    },

    attijari_portal: "https://attijaripaypal.attijariwafa.com/PayPal",
    attijari_steps: [
      "1. Log into Attijari-PayPal portal",
      "2. Navigate to Virements / Repatriation",
      "3. Select incoming wire from Banking Circle",
      "4. Confirm the 70/30 split (Office des Changes)",
      "5. 70% → Compte en Devises (USD retained)",
      "6. 30% → Compte Dirhams (converted to MAD)",
      "7. Save transaction reference",
    ],

    revenue_ids: revenues.map(r => r.id),
    wallet: null,
  };

  const filePath = path.join(INSTRUCTIONS_DIR, `wire_${batchId}.json`);
  saveJson(filePath, instruction);

  return {
    rail: "bank_wire",
    batchId,
    reference,
    amount: payoutAmount,
    currency: "USD",
    retained: totalRetained,
    converted: totalConverted,
    convertedMAD: totalMAD,
    filePath,
    status: "ready_for_portal",
  };
}

// ─── Rail: PayPal Payout ─────────────────────────────────────────────────────
async function getPayPalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("Missing PayPal credentials in .env");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function executePayPalPayout(token, payoutAmount, batchId, revenues, totalUSD) {
  const reference = `SETTLE-${batchId}`;
  const totalConverted = revenues.reduce((s, r) => s + r.split.converted, 0);
  const totalMAD = Number((totalConverted * POLICY.fxRate).toFixed(2));

  const res = await fetch(`${PAYPAL_BASE}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: "Owner Revenue Settlement",
        email_message: `Settlement: $${payoutAmount.toFixed(2)} USD from ${revenues.length} revenues. Ref: ${reference}`,
      },
      items: [{
        recipient_type: "EMAIL",
        amount: { value: payoutAmount.toFixed(2), currency: "USD" },
        receiver: OWNER.paypalEmail,
        note: `Revenue settlement. Ref: ${reference}`,
        sender_item_id: `settle_${Date.now()}`,
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal payout ${res.status}: ${JSON.stringify(data)}`);

  return {
    rail: "paypal",
    batchId,
    reference,
    amount: payoutAmount,
    currency: "USD",
    converted: totalConverted,
    convertedMAD: totalMAD,
    paypalBatchId: data?.batch_header?.batch_id,
    status: "in_transit",
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const isCron = process.argv.includes("--cron");

  if (process.env.ALLOW_OFFLINE_LEDGER !== 'true') {
    log('Offline-ledger owner settlement is disabled in live mode. Use Base44-driven bank wire scripts instead.', 'ERROR');
    process.exit(1);
  }

  log("=== Automated Owner Settlement Pipeline ===");
  log(`Owner: ${OWNER.paypalEmail} | RIB: ${OWNER.rib} | IBAN: ${OWNER.bankIban}`);

  const state = loadState();
  const revenues = getUnsettledRevenues();

  if (revenues.length === 0) {
    log("No unsettled revenues found");
    if (isCron) setTimeout(main, POLICY.cronIntervalMs);
    return;
  }

  const totalUSD = revenues.reduce((s, r) => s + r.amount, 0);
  const totalConverted = revenues.reduce((s, r) => s + r.split.converted, 0);
  log(`Found ${revenues.length} unsettled revenues: $${totalUSD.toFixed(2)} USD total, $${totalConverted.toFixed(2)} USD convertible (30%)`);

  // Group into batches
  const batches = [];
  let currentBatch = [];
  let currentAmount = 0;
  for (const rev of revenues) {
    if (currentAmount + rev.split.converted > POLICY.maxSinglePayoutUSD && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentAmount = 0;
    }
    currentBatch.push(rev);
    currentAmount += rev.split.converted;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  log(`Split into ${batches.length} batch(es)`);

  // Try payment rails in order
  const bankWireEnabled = process.env.BANK_WIRE_ENABLE === "true" && process.env.BANK_WIRE_PROVIDER === "LIVE";
  const paypalEnabled = !!process.env.PAYPAL_CLIENT_ID;
  const cryptoEnabled = process.env.CRYPTO_ENABLE === "true"
    && !!OWNER.cryptoAddress
    && !!process.env.CRYPTO_OWNER_PRIVATE_KEY;

  log(`Rails available: bank_wire=${bankWireEnabled}, paypal=${paypalEnabled}, crypto=${cryptoEnabled} (chain=${OWNER.cryptoChain}, token=${OWNER.cryptoToken}, to=${OWNER.cryptoAddress || "<unset>"})`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchTotal = batch.reduce((s, r) => s + r.amount, 0);
    const batchConverted = batch.reduce((s, r) => s + r.split.converted, 0);
    const batchMAD = Number((batchConverted * POLICY.fxRate).toFixed(2));
    const batchId = `SETTLE_${Date.now()}_${i}`;

    log(`Batch ${i + 1}/${batches.length}: ${batch.length} revenues, $${batchTotal.toFixed(2)} USD (30% = $${batchConverted.toFixed(2)} → ${batchMAD} MAD)`);

    let result = null;

    // Try bank wire first (most reliable for Morocco)
    if (bankWireEnabled && batchConverted >= POLICY.minPayoutUSD) {
      try {
        log(`Attempting bank wire rail...`);
        result = await executeBankWire(batchConverted, batchId, batch, batchTotal);
        log(`Bank wire ready: ${result.reference} — $${result.amount.toFixed(2)} USD → ${result.convertedMAD.toFixed(2)} MAD`);
      } catch (err) {
        log(`Bank wire failed: ${err.message}`, "WARN");
      }
    }

    // Fall back to PayPal if bank wire failed
    if (!result && paypalEnabled && batchConverted >= POLICY.minPayoutUSD) {
      try {
        log(`Attempting PayPal rail...`);
        const token = await getPayPalToken();
        result = await executePayPalPayout(token, batchConverted, batchId, batch, batchTotal);
        log(`PayPal payout executed: $${result.amount.toFixed(2)} USD → ${OWNER.paypalEmail}`);
      } catch (err) {
        log(`PayPal failed: ${err.message}`, "WARN");
      }
    }

    // Final fallback: Crypto (USDT/USDC/NATIVE on the configured chain)
    if (!result && cryptoEnabled && batchConverted >= POLICY.minPayoutUSD) {
      try {
        log(`Attempting crypto rail (${OWNER.cryptoChain}/${OWNER.cryptoToken})...`);
        const cryptoResult = await executeCryptoPayout({
          chain: OWNER.cryptoChain,
          token: OWNER.cryptoToken,
          to: OWNER.cryptoAddress,
          amount: batchConverted,
          batchId,
          reference: `CRYPTO-${batchId}`,
        });
        result = {
          rail: "crypto",
          batchId,
          reference: cryptoResult.reference,
          amount: batchConverted,
          currency: "USD",
          chain: cryptoResult.chain,
          token: cryptoResult.token,
          txHash: cryptoResult.txHash,
          explorerUrl: cryptoResult.explorerUrl,
          status: cryptoResult.status,
        };
        log(`Crypto payout: ${batchConverted} ${cryptoResult.token} on ${cryptoResult.chain} → ${OWNER.cryptoAddress} (tx=${cryptoResult.txHash || "dry-run"})`);
      } catch (err) {
        log(`Crypto failed: ${err.message}`, "WARN");
      }
    }

    if (!result) {
      log(`No rail available for batch ${batchId}. Skipping.`, "WARN");
      continue;
    }

    // Record execution
    for (const rev of batch) {
      state.executedPayouts.push({
        earningId: rev.id,
        amount: rev.amount,
        batchId: result.batchId,
        reference: result.reference,
        rail: result.rail,
        executedAt: new Date().toISOString(),
      });
    }
    state.totalSettledUSD += batchTotal;
    state.totalSettledMAD += batchMAD;
  }

  state.lastRun = new Date().toISOString();
  saveJson(STATE_FILE, state);

  log("=== Settlement Summary ===");
  log(`Revenues processed: ${revenues.length}`);
  log(`Total USD: $${totalUSD.toFixed(2)}`);
  log(`Total settled: $${state.totalSettledUSD.toFixed(2)} USD`);
  log(`Total MAD: ${state.totalSettledMAD.toFixed(2)} MAD`);
  log(`Attijari portal: https://attijaripaypal.attijariwafa.com/PayPal`);
  log(`RIB: ${OWNER.rib}`);

  if (isCron) setTimeout(main, POLICY.cronIntervalMs);
}

main().catch(err => { log(`Fatal: ${err.message}`, "ERROR"); process.exit(1); });
