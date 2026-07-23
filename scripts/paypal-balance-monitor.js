#!/usr/bin/env node
/**
 * PayPal Balance Monitor v2
 * 
 * Auto re-auth: when cookies expire, launches Chrome for manual login,
 * saves new cookies, resumes monitoring.
 * 
 * Usage:
 *   node paypal-balance-monitor.js              # One-time check
 *   node paypal-balance-monitor.js --daemon     # Run every 10 minutes
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const EXPORTS = path.join(ROOT, 'exports', 'settlement');
const COOKIE_FILE = path.join(ROOT, 'exports', 'bank-sessions', 'paypal-cookies.json');
const MONITOR_LOG = path.join(EXPORTS, 'balance-monitor-log.json');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PHONE = '+212639158209';

function loadJson(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }
function saveJson(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2)); }

function logBalance(entry) {
  const log = loadJson(MONITOR_LOG) || { checks: [], lastBalance: 0 };
  log.checks.push(entry);
  if (log.checks.length > 500) log.checks = log.checks.slice(-500);
  log.lastBalance = entry.balance ?? 0;
  log.lastCheck = entry.timestamp;
  log.consecutiveFailures = entry.loginRequired ? (log.consecutiveFailures || 0) + 1 : 0;
  saveJson(MONITOR_LOG, log);
  return log;
}

async function sendWhatsApp(message) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ phone: PHONE, message });
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/send-message', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  });
}

async function waitForManualLogin(page, timeoutMs = 300000) {
  console.log('Please log in to PayPal in the browser window...');
  await sendWhatsApp('🔑 PayPal cookies expired. A Chrome window opened — please log in to PayPal. You have 5 minutes.');
  
  try {
    await page.waitForFunction(() => {
      const url = window.location.href;
      return !url.includes('signin') && !url.includes('login') && url.includes('paypal.com');
    }, { timeout: timeoutMs });
    console.log('Login detected!');
    return true;
  } catch {
    console.log('Login timeout');
    return false;
  }
}

async function checkBalance() {
  console.log(`[${new Date().toISOString()}] Checking PayPal balance...`);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();

  // Load cookies
  let cookiesLoaded = false;
  const cookieData = loadJson(COOKIE_FILE);
  if (cookieData?.cookies?.length) {
    const age = Date.now() - new Date(cookieData.savedAt).getTime();
    if (age < 20 * 60 * 60 * 1000) {
      await page.setCookie(...cookieData.cookies);
      console.log('Loaded cookies (age: ' + Math.round(age / 3600000) + 'h)');
      cookiesLoaded = true;
    } else {
      console.log('Cookies too old (' + Math.round(age / 3600000) + 'h), will re-auth');
    }
  }

  let balance = null;
  let loginRequired = false;

  try {
    await page.goto('https://www.paypal.com/mep/dashboard', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 8000));

    const url = page.url();
    if (url.includes('signin') || url.includes('login')) {
      // Auto re-auth: wait for manual login
      const loggedIn = await waitForManualLogin(page);
      if (loggedIn) {
        // Save new cookies
        const cookies = await browser.cookies();
        const dir = path.dirname(COOKIE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        saveJson(COOKIE_FILE, { savedAt: new Date().toISOString(), cookies });
        console.log('New cookies saved (' + cookies.length + ')');
        await sendWhatsApp('✅ PayPal re-authenticated. Balance monitor resumed.');
        
        // Navigate back to dashboard
        await page.goto('https://www.paypal.com/mep/dashboard', {
          waitUntil: 'domcontentloaded', timeout: 30000
        });
        await new Promise(r => setTimeout(r, 8000));
      } else {
        loginRequired = true;
      }
    }

    if (!loginRequired) {
      balance = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="balance-display"]');
        if (el) {
          const m = el.textContent.match(/([\d,]+\.?\d*)\s*USD/);
          if (m) return parseFloat(m[1].replace(/,/g, ''));
        }
        const text = document.body.innerText;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/available\s*balance/i.test(lines[i])) {
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
              const m = lines[j].match(/([\d,]+\.?\d*)\s*USD/);
              if (m) return parseFloat(m[1].replace(/,/g, ''));
            }
          }
        }
        return null;
      });
      console.log('Balance:', balance !== null ? '$' + balance.toFixed(2) : 'unknown');
    }

    await page.screenshot({ path: path.join(EXPORTS, `balance-check-${Date.now()}.png`), fullPage: false });
  } catch(e) {
    console.log('Error:', e.message);
  }

  await browser.close();

  // Log
  const entry = { timestamp: new Date().toISOString(), balance, loginRequired };
  const log = logBalance(entry);

  // Alert if balance changed from 0
  if (balance !== null && balance > 0 && log.checks.length > 1) {
    const prevChecks = log.checks.filter(c => c.balance !== null && c.balance !== undefined);
    if (prevChecks.length >= 2) {
      const prev = prevChecks[prevChecks.length - 2];
      if (prev.balance === 0 && balance > 0) {
        console.log(`\n🚨 BALANCE CHANGED: $0.00 → $${balance.toFixed(2)} USD`);
        await sendWhatsApp(
          `💰 PayPal Balance Alert!\n\nBalance changed: $0.00 → $${balance.toFixed(2)} USD\n\nFunds have arrived! Settlement pipeline can now execute bank transfers.`
        );
      }
    }
  }

  // Alert if repeated login failures
  if (loginRequired && log.consecutiveFailures >= 3) {
    await sendWhatsApp(`⚠️ PayPal monitor: ${log.consecutiveFailures} consecutive login failures. Cookies may be permanently expired. Please re-authenticate.`);
  }

  return { balance, loginRequired };
}

async function main() {
  const isDaemon = process.argv.includes('--daemon');

  if (isDaemon) {
    console.log('=== PayPal Balance Monitor v2 (Daemon) ===');
    console.log('Auto re-auth enabled. Checking every 10 minutes.\n');

    while (true) {
      try {
        await checkBalance();
      } catch(e) {
        console.log('Check error:', e.message);
      }
      await new Promise(r => setTimeout(r, 600000));
    }
  } else {
    await checkBalance();
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
