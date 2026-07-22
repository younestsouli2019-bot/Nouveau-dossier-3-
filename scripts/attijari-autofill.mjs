#!/usr/bin/env node

/**
 * Puppeteer Auto-Fill for Attijari-PayPal Portal
 * 
 * Opens the Attijari-PayPal repatriation portal, fills wire transfer fields
 * automatically. You still need to:
 * 1. Log in manually (solves WAF + 2FA)
 * 2. The script fills the rest
 * 
 * Usage:
 *   node scripts/attijari-autofill.mjs SETTLE_1784735054550_0
 *   node scripts/attijari-autofill.mjs --list
 *   node scripts/attijari-autofill.mjs --list --all
 * 
 * Requires: npm install puppeteer (already in fullgd/node_modules)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INSTRUCTIONS_DIR = path.join(ROOT, "exports", "settlement", "instructions");

const PORTAL_URL = "https://attijaripaypal.attijariwafa.com/PayPal";

// ─── CLI ──────────────────────────────────────────────────────────────────────
function listInstructions(all = false) {
  if (!fs.existsSync(INSTRUCTIONS_DIR)) {
    console.log("No instructions directory found");
    return [];
  }
  const files = fs.readdirSync(INSTRUCTIONS_DIR).filter(f => f.startsWith("wire_") && f.endsWith(".json"));
  const instructions = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(INSTRUCTIONS_DIR, f), "utf8"));
    if (!all && data.status === "confirmed") continue;
    instructions.push({ file: f, ...data });
    console.log(`  ${data.batch_id} | $${data.amount?.converted_usd || "?"} USD → ${data.amount?.converted_mad || "?"} MAD | ${data.status}`);
  }
  return instructions;
}

function loadInstruction(batchId) {
  const fp = path.join(INSTRUCTIONS_DIR, `wire_${batchId}.json`);
  if (!fs.existsSync(fp)) { console.error(`Instruction not found: ${batchId}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

// ─── Puppeteer Auto-Fill ──────────────────────────────────────────────────────
async function autoFill(instruction) {
  let puppeteer;
  try {
    puppeteer = await import("puppeteer");
  } catch {
    try {
      const puppeteerPath = path.join(ROOT, "fullgd", "node_modules", "puppeteer");
      if (fs.existsSync(puppeteerPath)) {
        puppeteer = await import(puppeteerPath);
      } else {
        console.error("Puppeteer not found. Install: npm install puppeteer");
        console.error("Or it may be in fullgd/node_modules/puppeteer");
        process.exit(1);
      }
    } catch {
      console.error("Puppeteer not available");
      process.exit(1);
    }
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--start-maximized", "--disable-blink-features=AutomationControlled"],
  });

  const page = await browser.newPage();

  console.log(`\nOpening ${PORTAL_URL}...`);
  await page.goto(PORTAL_URL, { waitUntil: "networkidle2", timeout: 30000 });

  console.log("\n⚠️  Please log in manually (WAF + 2FA).");
  console.log("    The script will detect when you're logged in and fill the form.\n");

  // Wait for the portal dashboard to load (look for a form or input fields)
  try {
    await page.waitForFunction(() => {
      // Look for common form elements that indicate we're past login
      return document.querySelector('input[type="text"]') ||
             document.querySelector('input[type="number"]') ||
             document.querySelector('select') ||
             document.querySelector('[class*="transfer"]') ||
             document.querySelector('[class*="virement"]') ||
             document.querySelector('[class*="repatriation"]');
    }, { timeout: 120000 }); // 2 min to log in

    console.log("✅ Login detected! Filling form...\n");

    // Wait a moment for page to fully render
    await new Promise(r => setTimeout(r, 2000));

    // Extract fields from instruction
    const fields = extractFields(instruction);

    // Try to fill common fields
    for (const field of fields) {
      try {
        const el = await findField(page, field.selector, field.label);
        if (el) {
          await el.click({ clickCount: 3 }); // Select all
          await el.type(field.value, { delay: 50 });
          console.log(`  ✅ ${field.label}: ${field.value}`);
        } else {
          console.log(`  ⚠️  Could not find: ${field.label} (${field.selector})`);
        }
      } catch (e) {
        console.log(`  ⚠️  Error filling ${field.label}: ${e.message}`);
      }
    }

    console.log("\n📋 Form filled! Please review and submit manually.");
    console.log("   Press Ctrl+C when done.\n");

    // Keep browser open
    await new Promise(() => {});

  } catch {
    console.log("\n⏰ Timeout waiting for login. Please log in and re-run.");
    console.log("   The browser is still open — you can fill manually.");
    await new Promise(() => {});
  }
}

function extractFields(instruction) {
  const src = instruction.source || {};
  const dst = instruction.destination || {};
  const amt = instruction.amount || {};
  const steps = instruction.attijari_steps || [];

  return [
    { label: "Source IBAN", selector: '[name*="iban"], [name*="IBAN"], input[placeholder*="IBAN"]', value: src.iban || "" },
    { label: "Source SWIFT/BIC", selector: '[name*="swift"], [name*="bic"], [name*="SWIFT"]', value: src.swift || "" },
    { label: "Source Bank Name", selector: '[name*="bank"], [name*="banque"]', value: src.bank || "" },
    { label: "Beneficiary Name", selector: '[name*="beneficiary"], [name*="titulaire"], [name*="name"]', value: dst.beneficiary || "" },
    { label: "RIB/Account", selector: '[name*="rib"], [name*="account"], [name*="compte"]', value: dst.rib || "" },
    { label: "Amount USD", selector: '[name*="amount"], [name*="montant"], input[type="number"]', value: String(amt.converted_usd || "") },
    { label: "Amount MAD", selector: '[name*="mad"], [name*="dirham"]', value: String(amt.converted_mad || "") },
    { label: "Reference", selector: '[name*="ref"], [name*="reference"], [name*="motif"]', value: instruction.reference || "" },
  ];
}

async function findField(page, selector, label) {
  // Try exact selector
  let el = await page.$(selector);
  if (el) return el;

  // Try partial match on all inputs
  const inputs = await page.$$('input, select, textarea');
  for (const inp of inputs) {
    const props = await page.evaluate(el => ({
      name: el.name || "",
      id: el.id || "",
      placeholder: el.placeholder || "",
      label: el.labels?.[0]?.textContent || "",
      ariaLabel: el.getAttribute("aria-label") || "",
    }), inp);

    const combined = `${props.name} ${props.id} ${props.placeholder} ${props.label} ${props.ariaLabel}`.toLowerCase();
    const labelWords = label.toLowerCase().split(/\s+/);
    if (labelWords.some(w => combined.includes(w))) return inp;
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes("--list")) {
    const all = process.argv.includes("--all");
    console.log("\n📋 Pending wire instructions:\n");
    listInstructions(all);
    return;
  }

  const batchId = process.argv[2];
  if (!batchId) {
    console.log("Usage:");
    console.log("  node scripts/attijari-autofill.mjs SETTLE_XXXX");
    console.log("  node scripts/attijari-autofill.mjs --list");
    console.log("  node scripts/attijari-autofill.mjs --list --all");
    process.exit(0);
  }

  const instruction = loadInstruction(batchId);
  console.log(`\n📋 Wire instruction: ${instruction.batch_id}`);
  console.log(`   Source: ${instruction.source?.iban} (${instruction.source?.bank})`);
  console.log(`   Dest: ${instruction.destination?.beneficiary} — RIB ${instruction.destination?.rib}`);
  console.log(`   Amount: $${instruction.amount?.converted_usd} USD → ${instruction.amount?.converted_mad} MAD`);
  console.log(`   Status: ${instruction.status}`);

  if (instruction.status === "confirmed") {
    console.log("\n✅ This instruction is already confirmed. Use --list to see pending ones.");
    return;
  }

  await autoFill(instruction);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
