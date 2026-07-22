#!/usr/bin/env node

/**
 * PayPal Balance Auditor
 * 
 * Checks actual PayPal balance via Puppeteer, compares with expected revenues,
 * and flags any discrepancies.
 * 
 * Flow:
 *   1. Read ledger (expected revenues)
 *   2. Open PayPal.com, login, read actual balance
 *   3. Compare expected vs actual
 *   4. Report gaps
 *   5. If funds available, queue transfer
 * 
 * Usage:
 *   node scripts/paypal-audit.mjs                # Full audit
 *   node scripts/paypal-audit.mjs --check-only   # Just check balance
 *   node scripts/paypal-audit.mjs --transfer     # Audit + transfer
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PAYPAL_COM_URL = "https://www.paypal.com/myaccount/transfer/homepage";
const LOGIN_URL = "https://www.paypal.com/signin";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const COOKIE_FILE = path.join(ROOT, "exports", "bank-sessions", "paypal-cookies.json");
const LEDGER_BASE44 = path.join(ROOT, ".base44-offline-store.json");
const LEDGER_AUTONOMOUS = path.join(ROOT, ".autonomous-offline-store.json");
const STATE_FILE = path.join(ROOT, "exports", "settlement", "settle-state.json");
const AUDIT_FILE = path.join(ROOT, "exports", "settlement", "paypal-audit.json");
const TRANSFER_LOG = path.join(ROOT, "exports", "settlement", "paypal-transfers.json");
const LOG_FILE = path.join(ROOT, "exports", "settlement", "settle-log.json");

const POLICY = {
  fxRate: 10.2,
  retentionPct: 0.70,
  conversionPct: 0.30,
  minTransferUSD: 50,
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

// ─── Ledger ───────────────────────────────────────────────────────────────────
function getExpectedRevenues() {
  const state = loadState();
  const settledIds = new Set(state.executedPayouts.map(p => p.earningId));
  const revenues = [];

  for (const storePath of [LEDGER_BASE44, LEDGER_AUTONOMOUS]) {
    const store = loadJson(storePath);
    if (!store?.entities?.Earning?.records) continue;
    for (const e of store.entities.Earning.records) {
      if (settledIds.has(e.id)) continue;
      const amount = parseFloat(String(e.amount).replace(",", "."));
      if (!amount || amount <= 0) continue;
      revenues.push({ id: e.id, amount, currency: e.currency || "USD", occurredAt: e.occurred_at || e.created_at });
    }
  }

  const total = revenues.reduce((s, r) => s + r.amount, 0);
  const retainable = total * POLICY.retentionPct;
  const convertible = total * POLICY.conversionPct;
  const convertibleMAD = convertible * POLICY.fxRate;

  return { revenues, count: revenues.length, total, retainable, convertible, convertibleMAD };
}

// ─── PayPal Balance via Puppeteer ─────────────────────────────────────────────
async function importPuppeteer() {
  try { return await import("puppeteer"); } catch {
    const p = path.join(ROOT, "fullgd", "node_modules", "puppeteer");
    if (fs.existsSync(p)) return await import(p);
    console.error("Puppeteer not found"); process.exit(1);
  }
}

async function saveCookies(browser) {
  const cookies = await browser.cookies();
  const dir = path.dirname(COOKIE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  saveJson(COOKIE_FILE, { savedAt: new Date().toISOString(), cookies });
  log(`PayPal cookies saved (${cookies.length})`);
}

async function loadCookies(page) {
  const data = loadJson(COOKIE_FILE);
  if (!data?.cookies?.length) return false;
  const age = Date.now() - new Date(data.savedAt).getTime();
  if (age > 24 * 60 * 60 * 1000) { log("PayPal cookies expired", "WARN"); return false; }
  await page.setCookie(...data.cookies);
  log(`Loaded ${data.cookies.length} PayPal cookies`);
  return true;
}

async function readPayPalBalance(page) {
  log("Reading PayPal balance via Puppeteer...");

  // Try multiple PayPal pages to find balance
  const urls = [
    "https://www.paypal.com/myaccount/wallet",
    "https://www.paypal.com/myaccount/summary",
    "https://www.paypal.com/myaccount",
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));

      // Check if logged in
      const isLogin = await page.evaluate(() =>
        window.location.href.includes("signin") || window.location.href.includes("login")
      );
      if (isLogin) {
        log("Need login — solving...");
        const ok = await waitForLogin(page);
        if (!ok) return null;
        await saveCookies(page.browser());
        await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
        await new Promise(r => setTimeout(r, 3000));
      }

      // Extract balance
      const balance = await page.evaluate(() => {
        const all = document.body.innerText;

        // Method 1: Look for "PayPal balance" label nearby
        const lines = all.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/paypal\s*balance|available\s*balance|solde/i.test(lines[i])) {
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
              const m = lines[j].match(/\$[\d,]+\.?\d*/);
              if (m) return parseFloat(m[0].replace(/[$,]/g, ''));
            }
          }
        }

        // Method 2: data-testid
        const bt = document.querySelector('[data-testid="balance"], [data-testid="available-balance"]');
        if (bt) {
          const m = bt.textContent.match(/[\d,]+\.?\d*/);
          if (m) return parseFloat(m[0].replace(/,/g, ''));
        }

        // Method 3: Any dollar amount on the page
        const matches = all.match(/\$[\d,]+\.\d{2}/g);
        if (matches) {
          let max = 0;
          for (const m of matches) {
            const v = parseFloat(m.replace(/[$,]/g, ''));
            if (v > max && v < 1000000) max = v;
          }
          return max || null;
        }

        // Method 4: class-based
        const containers = document.querySelectorAll('[class*="balance"], [class*="amount"], [class*="wallet"], [class*="total"]');
        for (const c of containers) {
          const m = c.textContent.match(/\$[\d,]+\.\d{2}/);
          if (m) return parseFloat(m[0].replace(/[$,]/g, ''));
        }
        return null;
      });

      if (balance !== null && balance > 0) {
        log(`PayPal balance: $${balance.toFixed(2)} USD`);
        return balance;
      }

      log(`Balance not found on ${url}, trying next...`);
    } catch (e) {
      log(`Error on ${url}: ${e.message}`, "WARN");
    }
  }

  log("Could not read PayPal balance from any page", "ERROR");
  return null;
}

async function waitForLogin(page, timeoutMs = 180000) {
  log("🔑 Please log in to PayPal...");
  try {
    await page.waitForFunction(() => {
      const url = window.location.href;
      // Must NOT be on signin page
      if (url.includes("signin") || url.includes("login")) return false;
      // Must be on an account page
      if (url.includes("myaccount/summary") || url.includes("myaccount/wallet")) return true;
      // Check for balance/header elements that only appear after login
      const hasHeader = document.querySelector('[data-testid="header"]');
      const hasNav = document.querySelector('[class*="nav"]') && document.querySelector('a[href*="summary"]');
      return hasHeader || hasNav;
    }, { timeout: timeoutMs });
    log("✅ Login detected!");
    return true;
  } catch {
    log("Login timeout", "ERROR");
    return false;
  }
}

// ─── Transfer ─────────────────────────────────────────────────────────────────
async function transferToBank(page, amount) {
  log(`\n=== Transferring $${amount.toFixed(2)} to Attijariwafa Bank ===`);

  try {
    await page.goto("https://www.paypal.com/myaccount/transfer/homepage", {
      waitUntil: "networkidle2", timeout: 20000
    });
  } catch {
    try {
      await page.goto("https://www.paypal.com/myaccount/wallet", {
        waitUntil: "networkidle2", timeout: 20000
      });
    } catch {}
  }
  await new Promise(r => setTimeout(r, 3000));

  // Click "Transfer to bank" or similar
  await page.evaluate(() => {
    const links = [...document.querySelectorAll('a, button')];
    const target = links.find(l =>
      /transfer.*bank|withdraw|send.*to.*bank/i.test(l.textContent)
    );
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  // Select bank account
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('[class*="bank"], [class*="account"], option, li, div')];
    const target = items.find(i =>
      /attijari|wafa|00781|morocco/i.test(i.textContent)
    );
    if (target) target.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Fill amount
  await page.evaluate((amt) => {
    const inputs = [...document.querySelectorAll('input[type="number"], input[type="text"]')];
    for (const inp of inputs) {
      if (inp.offsetParent !== null && /amount|montant/i.test(inp.name + inp.placeholder + inp.id)) {
        inp.value = amt;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // Fallback: first visible input
    for (const inp of inputs) {
      if (inp.offsetParent !== null) {
        inp.value = amt;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, String(amount.toFixed(2)));

  log(`Amount filled: $${amount.toFixed(2)}`);

  // Screenshot
  const ss = path.join(ROOT, "exports", "settlement", `paypal-transfer-${Date.now()}.png`);
  await page.screenshot({ path: ss, fullPage: true });

  // Submit
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

  const ssAfter = path.join(ROOT, "exports", "settlement", `paypal-transfer-done-${Date.now()}.png`);
  await page.screenshot({ path: ssAfter, fullPage: true });

  return { submitted, screenshot: ssAfter };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const isCheckOnly = process.argv.includes("--check-only");
  const doTransfer = process.argv.includes("--transfer");

  log("=== PayPal Revenue Audit ===");

  // Step 1: Read expected revenues
  const expected = getExpectedRevenues();
  log(`Expected revenues: ${expected.count} unsettled, $${expected.total.toFixed(2)} USD total`);
  log(`  Retainable (70%): $${expected.retainable.toFixed(2)} USD`);
  log(`  Convertible (30%): $${expected.convertible.toFixed(2)} USD → ${expected.convertibleMAD.toFixed(2)} MAD`);

  // Step 2: Read PayPal balance
  const puppeteer = await importPuppeteer();
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--start-maximized", "--disable-blink-features=AutomationControlled"],
  });

  const page = await browser.newPage();
  await loadCookies(page);

  const actualBalance = await readPayPalBalance(page);

  // Step 3: Compare
  const audit = {
    timestamp: new Date().toISOString(),
    expected: {
      unsettledCount: expected.count,
      totalUSD: expected.total,
      retainableUSD: expected.retainable,
      convertibleUSD: expected.convertible,
      convertibleMAD: expected.convertibleMAD,
    },
    actual: {
      paypalBalanceUSD: actualBalance,
    },
    gap: actualBalance !== null ? actualBalance - expected.retainable : null,
    status: "unknown",
  };

  if (actualBalance !== null) {
    if (actualBalance >= expected.retainable) {
      audit.status = "sufficient_funds";
      log(`✅ PayPal balance ($${actualBalance.toFixed(2)}) >= expected ($${expected.retainable.toFixed(2)})`);
    } else if (actualBalance > 0) {
      audit.status = "partial_funds";
      log(`⚠️ PayPal balance ($${actualBalance.toFixed(2)}) < expected ($${expected.retainable.toFixed(2)})`, "WARN");
      log(`   Gap: $${(expected.retainable - actualBalance).toFixed(2)} USD missing`);
    } else {
      audit.status = "no_funds";
      log(`❌ PayPal balance: $0.00 — no funds to transfer`, "ERROR");
    }
  } else {
    audit.status = "balance_unreadable";
    log("❌ Could not read PayPal balance", "ERROR");
  }

  saveJson(AUDIT_FILE, audit);
  log(`Audit saved: ${AUDIT_FILE}`);

  // Step 4: Transfer if requested and funds available
  if (doTransfer && actualBalance && actualBalance >= POLICY.minTransferUSD) {
    log("\nProceeding with transfer...");
    const transferAmount = Math.min(actualBalance, expected.convertible);
    const result = await transferToBank(page, transferAmount);
    audit.transfer = { amount: transferAmount, ...result };

    // Record transfer
    const transfers = loadJson(TRANSFER_LOG) || { transfers: [] };
    transfers.transfers.push({
      timestamp: new Date().toISOString(),
      amount: transferAmount,
      balance: actualBalance,
      submitted: result.submitted,
      screenshot: result.screenshot,
    });
    saveJson(TRANSFER_LOG, transfers);

    // Update state
    const state = loadState();
    state.lastRun = new Date().toISOString();
    saveState(state);
  }

  if (isCheckOnly) {
    log("Check-only mode — no transfer executed");
  }

  await browser.close();

  // Summary
  log("\n=== Summary ===");
  log(`Expected: $${expected.total.toFixed(2)} USD (${expected.count} revenues)`);
  log(`PayPal balance: ${actualBalance !== null ? "$" + actualBalance.toFixed(2) : "unknown"}`);
  log(`Status: ${audit.status}`);
  if (audit.transfer) log(`Transfer: $${audit.transfer.amount.toFixed(2)} — submitted: ${audit.transfer.submitted}`);
}

main().catch(e => { log(`Fatal: ${e.message}`, "ERROR"); process.exit(1); });
