#!/usr/bin/env node

/**
 * Automated Attijariwafa Bank Wire Execution
 * Hands-free policy: Auto-detect revenues → Generate wire packets → Execute transfers
 * 
 * Owner Account:
 *   Bank: Attijariwafa Bank
 *   RIB: 007810000448500030594182
 *   SWIFT: BCMAMAMC
 *   Branch: RABAT AGDAL, 83 AV. FAL OULD OUMEIR
 *   Holder: M TSOULI YOUNES
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Owner Attijari Account Config ──────────────────────────────────────────
const OWNER_ACCOUNT = {
  beneficiaryName: "M TSOULI YOUNES",
  bankName: "Attijariwafa Bank",
  rib: "007810000448500030594182",
  swift: "BCMAMAMC",
  branch: "RABAT AGDAL, 83 AV. FAL OULD OUMEIR",
  country: "MA",
  city: "RABAT",
  currency: "MAD",
};

// ─── Policy Config ──────────────────────────────────────────────────────────
const POLICY = {
  minWireAmount: 100,           // Minimum USD per wire
  maxWireAmount: 50000,         // Maximum USD per wire (Morocco limit)
  batchTimeoutHours: 24,        // Auto-execute after this time
  confirmationDeadlineHours: 12, // Require confirmation within this time
  fxRate: 10.2,                 // USD to MAD approximate rate
  retentionPercentage: 0.70,    // 70% retention (Office des Changes)
  conversionPercentage: 0.30,   // 30% mandatory conversion
};

// ─── Paths ──────────────────────────────────────────────────────────────────
const LEDGER_PATH = path.join(ROOT, ".base44-offline-store.json");
const AUTONOMOUS_LEDGER_PATH = path.join(ROOT, ".autonomous-offline-store.json");
const WIRE_DIR = path.join(ROOT, "exports", "bank-wire");
const STATE_FILE = path.join(ROOT, "exports", "bank-wire", "auto-wire-state.json");
const LOG_FILE = path.join(ROOT, "exports", "bank-wire", "auto-wire-log.json");

// ─── Utilities ──────────────────────────────────────────────────────────────
function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function saveJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function log(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message };
  console.log(`[${timestamp}] [${level}] ${message}`);
  
  let logs = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    }
  } catch {}
  logs.push(entry);
  if (logs.length > 1000) logs = logs.slice(-1000);
  saveJson(LOG_FILE, logs);
}

function loadState() {
  const state = loadJson(STATE_FILE);
  return state || {
    lastProcessedIndex: 0,
    executedWires: [],
    pendingWires: [],
    totalExecutedUSD: 0,
    lastRun: null,
  };
}

function saveState(state) {
  state.lastRun = new Date().toISOString();
  saveJson(STATE_FILE, state);
}

// ─── Revenue Detection ──────────────────────────────────────────────────────
function getAvailableRevenues() {
  const store = loadJson(LEDGER_PATH);
  if (!store?.entities?.Earning?.records) return [];
  
  const earnings = store.entities.Earning.records;
  
  // Filter for completed earnings that haven't been wired yet
  const state = loadState();
  const wiredIds = new Set(state.executedWires.map(w => w.earningId));
  
  return earnings
    .filter(e => 
      e.status === "completed" && 
      e.beneficiary === "Owner" &&
      !wiredIds.has(e.id)
    )
    .map(e => ({
      id: e.id,
      amount: parseFloat(String(e.amount).replace(",", ".")),
      currency: e.currency || "USD",
      occurredAt: e.occurred_at,
    }));
}

// ─── Wire Calculation ────────────────────────────────────────────────────────
function calculateWireDetails(amountUSD) {
  const amountMAD = amountUSD * POLICY.fxRate;
  const retainedUSD = amountUSD * POLICY.retentionPercentage;
  const convertedUSD = amountUSD * POLICY.conversionPercentage;
  const convertedMAD = convertedUSD * POLICY.fxRate;
  
  return {
    grossUSD: amountUSD,
    grossMAD: amountMAD,
    retainedUSD,
    retainedNote: "70% Retention (Office des Changes - Compte en Devises)",
    convertedUSD,
    convertedMAD,
    convertedNote: "30% Mandatory Conversion (Compte Dirhams)",
    fxRate: POLICY.fxRate,
  };
}

// ─── Wire Packet Builder ────────────────────────────────────────────────────
function buildWirePacket(batchId, revenues, wireDetails) {
  const reference = `WIRES-${batchId}-${Date.now()}`;
  const totalAmount = revenues.reduce((sum, r) => sum + r.amount, 0);
  
  return {
    type: "attijari_auto_wire_packet",
    provider: "ATTIJARIWAFA_BANK",
    batch_id: batchId,
    reference,
    created_at: new Date().toISOString(),
    expected_confirmation_by: new Date(
      Date.now() + POLICY.confirmationDeadlineHours * 60 * 60 * 1000
    ).toISOString(),
    
    // Source revenues
    revenues: revenues.map(r => ({
      id: r.id,
      amount: r.amount,
      currency: r.currency,
      occurred_at: r.occurredAt,
    })),
    
    // Wire details
    wire: {
      total_revenue_usd: totalAmount,
      ...wireDetails,
    },
    
    // Destination (Owner Attijari Account)
    destination: {
      ...OWNER_ACCOUNT,
      account_label: "Owner Revenue Account",
    },
    
    // Execution instructions
    execution: {
      method: "ATTIJARI_ONLINE_PORTAL",
      portal_url: process.env.ATTIJARI_PORTAL_URL || "https://www.attijariwafabank.com",
      steps: [
        "Log into Attijariwafa Bank online portal",
        "Navigate to Wire Transfer / Virement",
        `Enter beneficiary: ${OWNER_ACCOUNT.beneficiaryName}`,
        `Enter RIB: ${OWNER_ACCOUNT.rib}`,
        `Enter SWIFT: ${OWNER_ACCOUNT.swift}`,
        `Enter amount: ${wireDetails.convertedMAD.toFixed(2)} MAD`,
        `Enter reference: ${reference}`,
        "Submit transfer",
        "Capture transaction reference",
      ],
    },
    
    // Confirmation command
    confirm_command: 
      `node scripts/confirm-auto-wire.mjs ${batchId} --transaction-id=<ATTIJARI_REF> --amount=${wireDetails.convertedMAD.toFixed(2)}`,
    
    // Status tracking
    status: "pending_execution",
    executed_at: null,
    confirmed_at: null,
    transaction_id: null,
  };
}

// ─── Wire Execution ─────────────────────────────────────────────────────────
function executeWire(packet) {
  log(`Executing wire: ${packet.batch_id} - ${packet.wire.total_revenue_usd} USD → ${packet.wire.convertedMAD.toFixed(2)} MAD`);
  
  // Save wire packet
  const packetPath = path.join(WIRE_DIR, `auto_wire_packet_${packet.batch_id}.json`);
  saveJson(packetPath, packet);
  
  // Generate manual wire instructions (copy-paste ready)
  const instructionsPath = path.join(WIRE_DIR, `auto_wire_instructions_${packet.batch_id}.txt`);
  const instructions = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                    ATTIJARIWAFA BANK WIRE TRANSFER INSTRUCTIONS              ║
╚══════════════════════════════════════════════════════════════════════════════╝

Reference: ${packet.reference}
Created: ${packet.created_at}
Confirm by: ${packet.expected_confirmation_by}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1: LOG INTO ATTIJARI PORTAL
   URL: https://www.attijariwafabank.com
   Navigate to: Virements / Wire Transfers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 2: FILL IN BENEFICIARY DETAILS (Copy-Paste each field)

   Bénéficiaire / Beneficiary Name:
   ┌─────────────────────────────────────────────────────┐
   │ ${OWNER_ACCOUNT.beneficiaryName.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

   RIB / Account Number:
   ┌─────────────────────────────────────────────────────┐
   │ ${OWNER_ACCOUNT.rib.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

   Code SWIFT / BIC:
   ┌─────────────────────────────────────────────────────┐
   │ ${OWNER_ACCOUNT.swift.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

   Banque / Bank Name:
   ┌─────────────────────────────────────────────────────┐
   │ ${OWNER_ACCOUNT.bankName.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

   Agence / Branch:
   ┌─────────────────────────────────────────────────────┐
   │ ${OWNER_ACCOUNT.branch.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

   Pays / Country:
   ┌─────────────────────────────────────────────────────┐
   │ ${OWNER_ACCOUNT.country.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

   Ville / City:
   ┌─────────────────────────────────────────────────────┐
   │ ${OWNER_ACCOUNT.city.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 3: FILL IN TRANSFER DETAILS

   Montant / Amount:
   ┌─────────────────────────────────────────────────────┐
   │ ${packet.wire.convertedMAD.toFixed(2).padEnd(46)} MAD │
   └─────────────────────────────────────────────────────┘

   Devise / Currency:
   ┌─────────────────────────────────────────────────────┐
   │ MAD (Dirham Marocain)                               │
   └─────────────────────────────────────────────────────┘

   Référence / Reference (IMPORTANT - Copy exactly):
   ┌─────────────────────────────────────────────────────┐
   │ ${packet.reference.padEnd(52)} │
   └─────────────────────────────────────────────────────┘

   Motif / Reason:
   ┌─────────────────────────────────────────────────────┐
   │ Revenue Settlement - Owner Account                  │
   └─────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 4: CONFIRM AND SUBMIT
   - Review all details
   - Submit the transfer
   - Save the transaction reference

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 5: CONFIRM IN SYSTEM (after transfer is sent)

   Run this command:
   node scripts/confirm-auto-wire.mjs ${packet.batch_id} --transaction-id=<YOUR_TRANSACTION_REF> --amount=${packet.wire.convertedMAD.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REVENUE BREAKDOWN:
   Total Revenue: $${packet.wire.total_revenue_usd.toFixed(2)} USD
   FX Rate: ${POLICY.fxRate} MAD/USD
   Gross MAD: ${packet.wire.grossMAD.toFixed(2)} MAD
   
   Office des Changes Split:
   - 70% Retained: $${packet.wire.retainedUSD.toFixed(2)} USD (Compte en Devises)
   - 30% Converted: $${packet.wire.convertedUSD.toFixed(2)} USD → ${packet.wire.convertedMAD.toFixed(2)} MAD (Compte Dirhams)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  IMPORTANT: 
   - Keep this reference for confirmation: ${packet.reference}
   - Confirmation deadline: ${packet.expected_confirmation_by}
   - After transfer, run confirm command with your transaction reference

╚══════════════════════════════════════════════════════════════════════════════╝
`;
  fs.writeFileSync(instructionsPath, instructions, "utf8");
  
  // Also generate a simple copy-paste card
  const cardPath = path.join(WIRE_DIR, `auto_wire_card_${packet.batch_id}.txt`);
  const card = `
COPY-PASTE CARD FOR ATTIJARI PORTAL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bénéficiaire: ${OWNER_ACCOUNT.beneficiaryName}
RIB: ${OWNER_ACCOUNT.rib}
SWIFT: ${OWNER_ACCOUNT.swift}
Banque: ${OWNER_ACCOUNT.bankName}
Montant: ${packet.wire.convertedMAD.toFixed(2)} MAD
Référence: ${packet.reference}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  fs.writeFileSync(cardPath, card, "utf8");
  
  log(`Wire packet saved: ${packetPath}`);
  log(`Manual instructions saved: ${instructionsPath}`);
  log(`Copy-paste card saved: ${cardPath}`);
  log(`Amount: ${packet.wire.convertedMAD.toFixed(2)} MAD (${packet.wire.total_revenue_usd} USD @ ${POLICY.fxRate})`);
  
  return {
    packetPath,
    instructionsPath,
    cardPath,
    reference: packet.reference,
  };
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────
async function main() {
  if (process.env.ALLOW_OFFLINE_LEDGER !== 'true') {
    log("Offline-ledger Attijari wire automation is disabled in live mode. Use Base44-driven bank wire scripts instead.", "ERROR");
    process.exit(1);
  }

  log("Starting automated Attijari wire pipeline");
  
  const state = loadState();
  const revenues = getAvailableRevenues();
  
  if (revenues.length === 0) {
    log("No new revenues available for wiring");
    return;
  }
  
  log(`Found ${revenues.length} new revenue(s) totaling ${revenues.reduce((s, r) => s + r.amount, 0)} USD`);
  
  // Group revenues into batches
  const batches = [];
  let currentBatch = [];
  let currentAmount = 0;
  
  for (const revenue of revenues) {
    if (currentAmount + revenue.amount > POLICY.maxWireAmount && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentAmount = 0;
    }
    currentBatch.push(revenue);
    currentAmount += revenue.amount;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  
  log(`Grouped into ${batches.length} wire batch(es)`);
  
  // Process each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchId = `BATCH_${Date.now()}_${i}`;
    const totalAmount = batch.reduce((s, r) => s + r.amount, 0);
    
    log(`Processing batch ${batchId}: ${batch.length} revenues, ${totalAmount} USD`);
    
    // Calculate wire details
    const wireDetails = calculateWireDetails(totalAmount);
    
    // Build wire packet
    const packet = buildWirePacket(batchId, batch, wireDetails);
    
    // Execute wire (generate instructions)
    const result = executeWire(packet);
    
    // Update state
    for (const revenue of batch) {
      state.executedWires.push({
        earningId: revenue.id,
        amount: revenue.amount,
        batchId,
        reference: result.reference,
        executedAt: new Date().toISOString(),
      });
    }
    state.totalExecutedUSD += totalAmount;
    
    log(`Batch ${batchId} executed - Reference: ${result.reference}`);
  }
  
  // Save state
  saveState(state);
  
  // Summary
  log("=== Wire Execution Summary ===");
  log(`Total batches: ${batches.length}`);
  log(`Total revenues processed: ${revenues.length}`);
  log(`Total USD wired: ${state.totalExecutedUSD}`);
  log(`Total MAD generated: ${(state.totalExecutedUSD * POLICY.fxRate).toFixed(2)}`);
  log("Wire instructions generated - ready for execution via Attijari portal");
}

// ─── Run ────────────────────────────────────────────────────────────────────
main().catch(error => {
  log(`Pipeline error: ${error.message}`, "ERROR");
  process.exit(1);
});
