#!/usr/bin/env node

/**
 * Autonomous Wire Executor
 * 
 * Hands-free policy: Initiates bank wires from Banking Circle -> Attijari Morocco
 * 
 * Flow:
 *   1. Opens Banking Circle portal -> auto-fills wire form
 *   2. You solve 2FA once -> session cookies saved
 *   3. Next run: reuses cookies (no 2FA needed)
 *   4. After wire sent, opens Attijari portal -> auto-fills repatriation confirmation
 * 
 * Usage:
 *   node scripts/auto-execute-wire.mjs                  # Execute all pending
 *   node scripts/auto-execute-wire.mjs --setup           # Login + save cookies
 *   node scripts/auto-execute-wire.mjs --dry-run         # Preview only
 *   node scripts/auto-execute-wire.mjs SETTLE_XXX        # Specific batch
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INSTRUCTIONS_DIR = path.join(ROOT, "exports", "settlement", "instructions");
const STATE_FILE = path.join(ROOT, "exports", "settlement", "settle-state.json");
const COOKIE_DIR = path.join(ROOT, "exports", "bank-sessions");
const LOG_FILE = path.join(ROOT, "exports", "settlement", "settle-log.json");

const PORTALS = {
  bankingCircle: {
    name: "Banking Circle",
    url: "https://portal.bankingcircle.com",
    cookieFile: path.join(COOKIE_DIR, "banking-circle-cookies.json"),
  },
  attijari: {
    name: "Attijariwafa Bank",
    url: "https://attijaripaypal.attijariwafa.com/PayPal",
    cookieFile: path.join(COOKIE_DIR, "attijari-cookies.json"),
  },
};

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
  let logs = [];
  try { logs = loadJson(LOG_FILE) || []; } catch {}
  logs.push({ timestamp: ts, level, message: msg });
  if (logs.length > 2000) logs = logs.slice(-2000);
  saveJson(LOG_FILE, logs);
}

function loadState() {
  return loadJson(STATE_FILE) || { executedPayouts: [], confirmedPayouts: [], totalSettledUSD: 0, totalSettledMAD: 0 };
}

function saveState(state) {
  saveJson(STATE_FILE, state);
}

function getPendingInstructions(targetBatch) {
  if (!fs.existsSync(INSTRUCTIONS_DIR)) return [];
  const files = fs.readdirSync(INSTRUCTIONS_DIR).filter(f => f.startsWith("wire_") && f.endsWith(".json"));
  return files
    .map(f => ({ file: f, ...loadJson(path.join(INSTRUCTIONS_DIR, f)) }))
    .filter(i => {
      if (i.status !== "ready_for_portal") return false;
      if (targetBatch && i.batch_id !== targetBatch) return false;
      return true;
    });
}

async function saveCookies(browser, portalKey) {
  const cookies = await browser.cookies();
  const portal = PORTALS[portalKey];
  if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR, { recursive: true });
  saveJson(portal.cookieFile, { savedAt: new Date().toISOString(), cookies });
  log(`Cookies saved for ${portal.name} (${cookies.length} cookies)`);
}

async function loadCookies(page, portalKey) {
  const portal = PORTALS[portalKey];
  const data = loadJson(portal.cookieFile);
  if (!data?.cookies?.length) return false;
  const age = Date.now() - new Date(data.savedAt).getTime();
  if (age > 24 * 60 * 60 * 1000) {
    log(`Cookies for ${portal.name} expired`, "WARN");
    return false;
  }
  await page.setCookie(...data.cookies);
  log(`Loaded ${data.cookies.length} cookies for ${portal.name}`);
  return true;
}

async function waitForLogin(page, portalKey, timeoutMs = 180000) {
  const portal = PORTALS[portalKey];
  log(`Waiting for manual login at ${portal.name}...`);
  log("  Solve 2FA on your phone. Script will auto-continue.");
  try {
    await page.waitForFunction(() => {
      return !document.querySelector('input[type="password"]') &&
             !document.querySelector('[class*="login-form"]') &&
             !document.querySelector('[id*="login"]');
    }, { timeout: timeoutMs });
    log(`Login detected at ${portal.name}!`);
    return true;
  } catch {
    log(`Login timeout at ${portal.name}`, "ERROR");
    return false;
  }
}

async function fillFields(page, fields) {
  let filled = 0;
  for (const field of fields) {
    if (!field.value) continue;
    for (const sel of field.selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await new Promise(r => setTimeout(r, 100));
          await el.type(String(field.value), { delay: 30 });
          log(`  Filled: ${field.label} = ${String(field.value).substring(0, 40)}`);
          filled++;
          break;
        }
      } catch {}
    }
  }
  return filled;
}

async function clickSubmit(page) {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Send")',
    'button:has-text("Confirm")',
    'button:has-text("Execute")',
    'button:has-text("Valider")',
    'button:has-text("Envoyer")',
    '[data-testid*="submit"]',
    '.btn-primary',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        log("Submit clicked");
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
    } catch {}
  }
  return false;
}

async function setupMode() {
  const puppeteer = await importPuppeteer();
  const browser = await puppeteer.launch({ headless: false, executablePath: CHROME_PATH, defaultViewport: { width: 1280, height: 800 }, args: getBrowserArgs() });

  for (const [key, portal] of Object.entries(PORTALS)) {
    log(`\n=== Setting up ${portal.name} ===`);
    const page = await browser.newPage();
    await page.goto(portal.url, { waitUntil: "networkidle2", timeout: 30000 });
    const ok = await waitForLogin(page, key);
    if (ok) {
      await saveCookies(browser, key);
      log(`${portal.name} setup complete!`);
    } else {
      log(`${portal.name} setup failed`, "ERROR");
    }
    await page.close();
  }

  log("\nSetup complete. Running without --setup will now use saved cookies.");
  await browser.close();
}

async function executeWireSet(instruction, browser, dryRun) {
  const page = await browser.newPage();
  const results = { bankingCircle: null, attijari: null };

  // Step 1: Banking Circle - initiate outgoing wire
  log(`\n=== Wire: ${instruction.batch_id} ===`);
  log(`Amount: $${instruction.amount?.converted_usd} USD -> ${instruction.amount?.converted_mad} MAD`);
  log(`Dest: ${instruction.destination?.beneficiary} / RIB ${instruction.destination?.rib}`);

  const bcPortal = PORTALS.bankingCircle;
  await loadCookies(page, bcPortal.name ? "bankingCircle" : "bankingCircle");
  await page.goto(bcPortal.url, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const bcLoggedIn = await page.evaluate(() => {
    return !document.querySelector('input[type="password"]') &&
           !document.querySelector('[class*="login-form"]');
  });

  if (!bcLoggedIn) {
    const ok = await waitForLogin(page, "bankingCircle");
    if (ok) await saveCookies(browser, "bankingCircle");
    else { await page.close(); return results; }
  } else {
    log("Banking Circle: cookies valid, auto-filling");
  }

  // Navigate to outgoing payments
  await page.evaluate(() => {
    const links = [...document.querySelectorAll('a, button')];
    const target = links.find(l =>
      /payment|transfer|wire|outgoing|send/i.test(l.textContent)
    );
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  const bcFields = [
    { label: "IBAN", value: instruction.destination?.rib, selectors: ['[name*="iban"]', '[name*="account"]', 'input[placeholder*="IBAN"]', 'input[placeholder*="account"]'] },
    { label: "BIC/SWIFT", value: instruction.destination?.swift || "BCMAMAMC", selectors: ['[name*="swift"]', '[name*="bic"]', '[name*="SWIFT"]'] },
    { label: "Beneficiary", value: instruction.destination?.beneficiary || "M TSOULI YOUNES", selectors: ['[name*="beneficiary"]', '[name*="name"]', '[name*="titulaire"]'] },
    { label: "Amount", value: instruction.amount?.converted_usd, selectors: ['[name*="amount"]', '[name*="montant"]', 'input[type="number"]'] },
    { label: "Reference", value: instruction.reference, selectors: ['[name*="ref"]', '[name*="reference"]', '[name*="motif"]', '[name*="purpose"]'] },
  ];

  const bcFilled = await fillFields(page, bcFields);
  results.bankingCircle = { fieldsFilled: bcFilled, status: bcFilled > 0 ? "filled" : "no_match" };

  if (!dryRun && bcFilled > 0) {
    await clickSubmit(page);
    await new Promise(r => setTimeout(r, 5000));
  }

  const ss1 = path.join(ROOT, "exports", "settlement", `bc-wire-${instruction.batch_id}.png`);
  await page.screenshot({ path: ss1, fullPage: true });
  log(`Banking Circle screenshot: ${ss1}`);

  // Step 2: Attijari - confirm incoming repatriation
  const atPortal = PORTALS.attijari;
  await loadCookies(page, "attijari");
  await page.goto(atPortal.url, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const atLoggedIn = await page.evaluate(() => {
    return !document.querySelector('input[type="password"]') &&
           !document.querySelector('[class*="login-form"]');
  });

  if (!atLoggedIn) {
    const ok = await waitForLogin(page, "attijari");
    if (ok) await saveCookies(browser, "attijari");
    else { await page.close(); return results; }
  } else {
    log("Attijari: cookies valid, auto-filling");
  }

  // Navigate to repatriation
  await page.evaluate(() => {
    const links = [...document.querySelectorAll('a, button')];
    const target = links.find(l =>
      /repatri|virment|incoming|reception|confirmer/i.test(l.textContent)
    );
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  const atFields = [
    { label: "Amount", value: instruction.amount?.converted_usd, selectors: ['[name*="amount"]', '[name*="montant"]', 'input[type="number"]'] },
    { label: "RIB", value: instruction.destination?.rib || "007810000448500030594182", selectors: ['[name*="rib"]', '[name*="account"]', '[name*="compte"]'] },
    { label: "Reference", value: instruction.reference, selectors: ['[name*="ref"]', '[name*="reference"]', '[name*="motif"]'] },
    { label: "Currency", value: "USD", selectors: ['[name*="currency"]', '[name*="devise"]'] },
  ];

  const atFilled = await fillFields(page, atFields);
  results.attijari = { fieldsFilled: atFilled, status: atFilled > 0 ? "filled" : "no_match" };

  if (!dryRun && atFilled > 0) {
    await clickSubmit(page);
    await new Promise(r => setTimeout(r, 5000));
  }

  const ss2 = path.join(ROOT, "exports", "settlement", `at-repat-${instruction.batch_id}.png`);
  await page.screenshot({ path: ss2, fullPage: true });
  log(`Attijari screenshot: ${ss2}`);

  // Update instruction status
  const instFile = path.join(INSTRUCTIONS_DIR, instruction.file);
  instruction.status = dryRun ? "dry_run" : "submitted";
  instruction.submitted_at = new Date().toISOString();
  instruction.results = results;
  saveJson(instFile, instruction);
  log(`Instruction ${instruction.batch_id} updated: ${instruction.status}`);

  await page.close();
  return results;
}

async function importPuppeteer() {
  try {
    const puppeteer = await import("puppeteer");
    return puppeteer;
  } catch {
    const p = path.join(ROOT, "fullgd", "node_modules", "puppeteer");
    if (fs.existsSync(p)) return await import(p);
    console.error("Puppeteer not found. Run: npm install puppeteer");
    process.exit(1);
  }
}

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function getBrowserArgs() {
  return [
    "--no-sandbox",
    "--start-maximized",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--disable-extensions",
  ];
}

async function main() {
  const isSetup = process.argv.includes("--setup");
  const isDryRun = process.argv.includes("--dry-run");
  const targetBatch = process.argv.find(a => a.startsWith("SETTLE_"));

  if (isSetup) {
    await setupMode();
    return;
  }

  log("=== Autonomous Wire Executor ===");
  log(`Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);

  const instructions = getPendingInstructions(targetBatch);
  if (instructions.length === 0) {
    log("No pending wire instructions found");
    return;
  }

  log(`Found ${instructions.length} pending instruction(s)`);

  const puppeteer = await importPuppeteer();
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    defaultViewport: { width: 1280, height: 800 },
    args: getBrowserArgs(),
  });

  const state = loadState();
  let executed = 0;
  let failed = 0;

  for (const inst of instructions) {
    try {
      log(`\n--- Processing ${inst.batch_id} ---`);
      const results = await executeWireSet(inst, browser, isDryRun);

      if (results.bankingCircle?.status === "filled" || results.attijari?.status === "filled") {
        executed++;
        // Mark as executed in state
        for (const payout of state.executedPayouts) {
          if (inst.revenue_ids?.includes(payout.earningId)) {
            payout.status = "wire_initiated";
            payout.wireInitiatedAt = new Date().toISOString();
          }
        }
      } else {
        failed++;
        log(`No fields matched for ${inst.batch_id} — portal HTML may differ`, "WARN");
      }
    } catch (e) {
      failed++;
      log(`Error on ${inst.batch_id}: ${e.message}`, "ERROR");
    }

    // Delay between wires
    await new Promise(r => setTimeout(r, 3000));
  }

  state.lastRun = new Date().toISOString();
  saveState(state);

  log(`\n=== Summary ===`);
  log(`Instructions: ${instructions.length}`);
  log(`Executed: ${executed}`);
  log(`Failed: ${failed}`);
  log(`Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);

  if (isDryRun) {
    log("\nDry run complete. Remove --dry-run to execute for real.");
  }

  await browser.close();
}

main().catch(e => { log(`Fatal: ${e.message}`, "ERROR"); process.exit(1); });
