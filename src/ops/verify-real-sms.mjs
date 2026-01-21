import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createBase44RevenueEventIdempotent, getRevenueConfigFromEnv } from "../base44-revenue.mjs";
import { buildBase44Client } from "../base44-client.mjs";
import { MOROCCO_FOREX_POLICY } from "../policy/morocco-forex-compliance.mjs";

// Helper to ask questions
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function getClipboardContent() {
  try {
    // Attempt to read clipboard via PowerShell (Windows standard)
    const res = spawnSync("powershell", ["-command", "Get-Clipboard"], { encoding: "utf8" });
    if (res.error || res.status !== 0) return null;
    return res.stdout.trim();
  } catch {
    return null;
  }
}

async function main() {
  console.log("=== ATTIJARIWAFA REAL SMS VERIFICATION & COMPLIANCE PORTAL ===");
  console.log("Acquires REAL SMS proofs to ingest revenue or portal codes.");
  console.log("Enforces 'Office des Changes' 70/30 Retention Policy.");
  console.log("-----------------------------------------------------");

  try {
    const base44 = buildBase44Client();
    if (!base44) {
      console.error("Error: Base44 client not configured. Check env vars.");
      process.exit(1);
    }

    // 1. ACQUIRE CONTENT
    let smsContent = "";
    console.log("Attempting to acquire SMS from clipboard...");
    const clip = getClipboardContent();
    
    if (clip && clip.length > 5) {
      console.log("\n>>> CLIPBOARD CONTENT DETECTED <<<");
      console.log("----------------------------------");
      console.log(clip.substring(0, 100) + (clip.length > 100 ? "..." : ""));
      console.log("----------------------------------");
      
      const useClip = await question("Is this the SMS content? (Y/n) [Default: Y]: ");
      if (useClip.toLowerCase() !== "n") {
        smsContent = clip;
      }
    }

    if (!smsContent) {
      console.log("\n[!] Clipboard empty or rejected.");
      console.log("Please COPY the SMS to your clipboard and press Enter, OR paste it below.");
      smsContent = await question("SMS Content: ");
    }

    if (!smsContent.trim()) throw new Error("No content acquired. Cannot proceed.");

    // 2. ANALYZE CONTENT (Simple Heuristics)
    let amount = 0;
    let currency = "MAD";
    let isActivation = false;

    if (smsContent.match(/code|activation|mot de passe/i) && !smsContent.match(/virement|reçu|compte/i)) {
        isActivation = true;
        console.log("\n[i] Detected: PORTAL ACTIVATION CODE");
    } else {
        // Try to extract money
        const amountMatch = smsContent.match(/(\d+[,.]\d+)\s*(MAD|DH|USD|EUR)/i);
        if (amountMatch) {
            amount = parseFloat(amountMatch[1].replace(",", "."));
            currency = amountMatch[2].toUpperCase();
            if (currency === "DH") currency = "MAD";
        }
    }

    if (isActivation) {
        console.log("This appears to be an access credential for 'attijaripaypal.attijariwafa.com'.");
        console.log("It will be logged as a 'Security Event' rather than Revenue.");
        // We could store this in a secure credential store, but for now we just verify it exists.
        console.log("Proof Hash generated.");
    } else {
        if (amount === 0) {
            const amountStr = await question("2. Could not auto-detect Amount. Enter Amount (e.g. 1000.00): ");
            amount = parseFloat(amountStr);
        }
        if (!currency || currency === "MAD") { // Ask to confirm if default
             const curInput = await question(`3. Currency detected: ${currency}. Press Enter to confirm or type correct (USD/EUR): `);
             if (curInput.trim()) currency = curInput.trim().toUpperCase();
        }
    }

    if (isNaN(amount) || amount < 0) amount = 0; // Activation might be 0

    const dateStr = await question("4. Enter Date (YYYY-MM-DD) [Default: Today]: ");
    const date = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
    const sender = await question("5. SMS Sender (e.g. Attijari, 2323) [Default: Attijari]: ") || "Attijari";

    // Proof ID
    const proofHash = sha256(`${sender}:${date}:${amount}:${currency}:${smsContent.trim()}`).slice(0, 16);
    const externalId = `sms_${proofHash}`;

    // 3. COMPLIANCE CHECK
    let complianceNote = "";
    if (!isActivation && (currency === "USD" || currency === "EUR")) {
        console.log("\n--- OFFICE DES CHANGES COMPLIANCE (70/30) ---");
        const split = MOROCCO_FOREX_POLICY.calculateSplit(amount);
        console.log(`Total Repatriated: ${split.total} ${currency}`);
        console.log(`> Retain (Compte Devises): ${split.retained.amount} ${currency} (70%)`);
        console.log(`> Convert (Compte Dirham): ${split.converted.amount} ${currency} -> ~${(split.converted.amount * 10).toFixed(2)} MAD (30%)`);
        complianceNote = JSON.stringify(split);
    }

    console.log("\n--- VERIFYING ---");
    console.log(`External ID: ${externalId}`);
    console.log(`Type: ${isActivation ? "ACCESS_CREDENTIAL" : "REVENUE_DEPOSIT"}`);
    console.log(`Amount: ${amount} ${currency}`);
    
    const confirm = await question("\nProceed to ingest? (yes/no): ");
    if (confirm.toLowerCase() !== "yes") {
      console.log("Aborted.");
      process.exit(0);
    }

    const cfg = getRevenueConfigFromEnv();
    
    const event = {
      amount: amount > 0 ? amount : 0.01, // Track even 0 amount as 0.01 for signal if needed, or allow 0 if config allows
      currency,
      occurredAt: date,
      source: isActivation ? "attijari_portal_auth" : "attijari_sms_manual",
      externalId,
      metadata: {
        proof_type: isActivation ? "activation_sms" : "revenue_sms",
        sms_content_hash: proofHash,
        sms_sender: sender,
        compliance_split: complianceNote || null,
        sms_preview: smsContent.substring(0, 20) + "..."
      }
    };

    // Special handling for activation codes - maybe don't call createRevenue?
    // For now, we log it as a revenue event of 0.01 just to have it in the ledger as a "signal"
    // unless strictly forbidden.
    
    console.log("Ingesting...");
    const result = await createBase44RevenueEventIdempotent(base44, cfg, event, { dryRun: false });
    
    console.log("\nSUCCESS!");
    console.log(`Event Created: ${result.id}`);
    console.log("Reality synced.");

  } catch (err) {
    console.error("\nERROR:", err.message);
  } finally {
    rl.close();
  }
}

main();
