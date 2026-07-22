#!/usr/bin/env node

/**
 * PayPal Bank Transfer Executor (Puppeteer)
 * 
 * Hands-free: Opens PayPal.com, you login once (2FA), then auto-transfers
 * your PayPal balance to your linked Attijariwafa bank account.
 * 
 * Session cookies saved after first login — subsequent runs skip 2FA.
 * 
 * Usage:
 *   node scripts/paypal-bank-transfer.mjs                # Transfer all pending
 *   node scripts/paypal-bank-transfer.mjs --setup         # Login + save cookies
 *   node scripts/paypal-bank-transfer.mjs --dry-run       # Preview only
 *   node scripts/paypal-bank-transfer.mjs --amount 500    # Transfer specific amount
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PAYPAL_URL = "https://www.paypal.com/myaccount/transfer/homepage";
const LOGIN_URL = "https://www.paypal.com/signin";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const COOKIE_FILE = path.join(ROOT, "exports", "bank-sessions", "paypal-cookies.json");
const STATE_FILE = path.join(ROOT, "exports", "settlement", "settle-state.json");
const TRANSFER_LOG = path.join(ROOT, "exports", "settlement", "paypal-transfers.json");
const LOG_FILE = path.join(ROOT, "exports", "settlement", "settle-log.json");
const OWNER_EMAIL = process.env.OWNER_PAYPAL_EMAIL || "younestsouli2019@gmail.com";

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

async function saveCookies(browser) {
  const cookies = await browser.cookies();
  const dir = path.dirname(COOKIE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  saveJson(COOKIE_FILE, { savedAt: new Date().toISOString(), cookies });
  log(`PayPal cookies saved (${cookies.length} cookies)`);
}

async function loadCookies(page) {
  const data = loadJson(COOKIE_FILE);
  if (!data?.cookies?.length) return false;
  const age = Date.now() - new Date(data.savedAt).getTime();
  if (age > 24 * 60 * 60 * 1000) {
    log("PayPal cookies expired", "WARN");
    return false;
  }
  await page.setCookie(...data.cookies);
  log(`Loaded ${data.cookies.length} PayPal cookies (${(age / 60000).toFixed(0)}min old)`);
  return true;
}

async function waitForLogin(page, timeoutMs = 180000) {
  log("🔑 Please log in to PayPal. Script will auto-continue after login.");
  log("   Solve 2FA on your phone if prompted.");
  try {
    await page.waitForFunction(() => {
      return window.location.href.includes("myaccount") ||
             window.location.href.includes("transfer") ||
             document.querySelector('[data-testid="accountInfo"]') ||
             document.querySelector('[class*="balance"]') ||
             document.querySelector('[data-testid="header"]');
    }, { timeout: timeoutMs });
    log("✅ PayPal login detected!");
    return true;
  } catch {
    log("PayPal login timeout", "ERROR");
    return false;
  }
}

async function getBalance(page) {
  try {
    const balance = await page.evaluate(() => {
      const selectors = [
        '[data-testid="balance"]',
        '[class*="balance"]',
        '.amount',
        'span:contains("$")',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent;
          const match = text.match(/\$[\d,]+\.?\d*/);
          if (match) return match[0];
        }
      }
      const all = document.body.innerText;
      const match = all.match(/\$[\d,]+\.\d{2}/);
      return match ? match[0] : null;
    });
    return balance;
  } catch {
    return null;
  }
}

async function executeTransfer(page, amount, dryRun) {
  log(`\n=== PayPal Bank Transfer ===`);
  log(`Target: Attijariwafa Bank (Morocco)`);
  log(`Amount: ${amount || "MAX BALANCE"}`);

  // Navigate to transfer page
  try {
    await page.goto(PAYPAL_URL, { waitUntil: "networkidle2", timeout: 30000 });
  } catch {
    log("Transfer page load failed, trying wallet...", "WARN");
    try {
      await page.goto("https://www.paypal.com/myaccount/wallet", { waitUntil: "networkidle2", timeout: 30000 });
    } catch {
      log("Wallet page also failed", "WARN");
    }
  }
  await new Promise(r => setTimeout(r, 3000));

  // Check if logged in
  const isLoggedIn = await page.evaluate(() => {
    return !document.querySelector('#login') &&
           !document.querySelector('[data-testid="loginButton"]') &&
           !window.location.href.includes('signin');
  });

  if (!isLoggedIn) {
    const ok = await waitForLogin(page);
    if (!ok) return { success: false, error: "Login timeout" };
    await saveCookies(page.browser());
    // Wait for redirect after login
    await new Promise(r => setTimeout(r, 5000));
    // Navigate to transfer page
    try {
      await page.goto(PAYPAL_URL, { waitUntil: "networkidle2", timeout: 30000 });
    } catch {
      // If transfer page fails, try the wallet/balance page
      await page.goto("https://www.paypal.com/myaccount/wallet", { waitUntil: "networkidle2", timeout: 30000 });
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  // Get current balance
  const balance = await getBalance(page);
  log(`Current balance: ${balance || "unknown"}`);

  // Look for "Transfer to bank" button
  const transferBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('a, button')];
    const target = btns.find(b =>
      /transfer.*bank|withdraw|send.*money|transfer.*money/i.test(b.textContent)
    );
    if (target) { target.click(); return true; }
    return false;
  });

  if (transferBtn) {
    log("Clicked transfer button");
    await new Promise(r => setTimeout(r, 3000));
  }

  // Look for bank account selection (Attijariwafa)
  const bankSelected = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[class*="bank"], [class*="account"], [data-testid*="bank"], option, li')];
    const target = items.find(i =>
      /attijari|wafa|00781|morocco|MA/i.test(i.textContent)
    );
    if (target) { target.click(); return true; }
    return false;
  });

  if (bankSelected) {
    log("Selected Attijariwafa bank account");
    await new Promise(r => setTimeout(r, 2000));
  }

  // Fill amount if specified
  if (amount) {
    const amountFilled = await page.evaluate((amt) => {
      const inputs = [...document.querySelectorAll('input[type="number"], input[type="text"], input[name*="amount"]')];
      for (const inp of inputs) {
        if (inp.offsetParent !== null) {
          inp.value = amt;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, String(amount));

    if (amountFilled) {
      log(`Amount filled: $${amount}`);
    }
  }

  // Take screenshot before submit
  const ssBefore = path.join(ROOT, "exports", "settlement", `paypal-transfer-before-${Date.now()}.png`);
  await page.screenshot({ path: ssBefore, fullPage: true });
  log(`Screenshot before: ${ssBefore}`);

  if (dryRun) {
    log("DRY RUN — not submitting", "WARN");
    return { success: true, dryRun: true, balance };
  }

  // Find and click submit/confirm
  const submitted = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[type="submit"], button')];
    const target = btns.find(b =>
      /confirm|submit|send|transfer|continue/i.test(b.textContent) && b.offsetParent !== null
    );
    if (target) { target.click(); return true; }
    return false;
  });

  if (submitted) {
    log("Transfer submitted!");
    await new Promise(r => setTimeout(r, 5000));
  }

  // Take confirmation screenshot
  const ssAfter = path.join(ROOT, "exports", "settlement", `paypal-transfer-after-${Date.now()}.png`);
  await page.screenshot({ path: ssAfter, fullPage: true });
  log(`Screenshot after: ${ssAfter}`);

  // Record transfer
  const transfers = loadJson(TRANSFER_LOG) || { transfers: [] };
  transfers.transfers.push({
    timestamp: new Date().toISOString(),
    amount: amount || "max",
    balance,
    status: submitted ? "submitted" : "no_submit_button",
    screenshotBefore: ssBefore,
    screenshotAfter: ssAfter,
  });
  saveJson(TRANSFER_LOG, transfers);

  // Update settlement state
  const state = loadState();
  for (const payout of state.executedPayouts) {
    if (payout.status !== "confirmed") {
      payout.status = "paypal_transfer_initiated";
      payout.transferInitiatedAt = new Date().toISOString();
    }
  }
  state.lastRun = new Date().toISOString();
  saveJson(STATE_FILE, state);

  return { success: true, submitted, balance, screenshot: ssAfter };
}

async function setupMode() {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--start-maximized", "--disable-blink-features=AutomationControlled"],
  });

  const page = await browser.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });

  const ok = await waitForLogin(page);
  if (ok) {
    await saveCookies(browser);
    log("PayPal setup complete! Cookies saved for 24h.");
  }

  await browser.close();
}

async function main() {
  const isSetup = process.argv.includes("--setup");
  const isDryRun = process.argv.includes("--dry-run");
  const amountArg = process.argv.find(a => a.startsWith("--amount"));
  const amount = amountArg ? process.argv[process.argv.indexOf(amountArg) + 1] : null;

  if (isSetup) {
    await setupMode();
    return;
  }

  log("=== PayPal Bank Transfer Executor ===");
  log(`Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);
  log(`Owner: ${OWNER_EMAIL}`);

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--start-maximized", "--disable-blink-features=AutomationControlled"],
  });

  const page = await browser.newPage();
  await loadCookies(page);

  const result = await executeTransfer(page, amount, isDryRun);

  if (result.success) {
    log(`\nTransfer ${isDryRun ? "preview" : "execution"} complete`);
    log(`Balance: ${result.balance}`);
    log(`Status: ${result.submitted ? "submitted" : "pending"}`);
  } else {
    log(`Transfer failed: ${result.error}`, "ERROR");
  }

  await browser.close();
}

main().catch(e => { log(`Fatal: ${e.message}`, "ERROR"); process.exit(1); });
