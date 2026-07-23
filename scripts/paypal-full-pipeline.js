#!/usr/bin/env node
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const EXPORTS = path.join(ROOT, 'exports', 'settlement');
const COOKIE_FILE = path.join(ROOT, 'exports', 'bank-sessions', 'paypal-cookies.json');
const STATE_FILE = path.join(EXPORTS, 'settle-state.json');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function loadJson(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }
function saveJson(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2)); }

(async () => {
  console.log('=== PayPal Full Transfer Pipeline ===\n');

  // Load state
  const state = loadJson(STATE_FILE) || { executedPayouts: [] };
  const pending = state.executedPayouts.filter(p => p.status === 'pending_transfer');
  const totalPending = pending.reduce((s, p) => s + (p.amount || 0), 0);
  const convertible = totalPending * 0.30;
  const convertibleMAD = convertible * 10.2;

  console.log('Settlement state:');
  console.log('  Pending payouts:', pending.length);
  console.log('  Total pending:', totalPending.toFixed(2), 'USD');
  console.log('  Convertible (30%):', convertible.toFixed(2), 'USD ->', convertibleMAD.toFixed(2), 'MAD');

  // Launch fresh browser
  console.log('\nLaunching Chrome...');
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();

  // Load cookies
  const cookieData = loadJson(COOKIE_FILE);
  if (cookieData?.cookies?.length) {
    const age = Date.now() - new Date(cookieData.savedAt).getTime();
    if (age < 24 * 60 * 60 * 1000) {
      await page.setCookie(...cookieData.cookies);
      console.log('Loaded', cookieData.cookies.length, 'cookies');
    } else {
      console.log('Cookies expired, will need manual login');
    }
  }

  // Navigate to summary with longer timeout
  console.log('\nNavigating to PayPal summary...');
  await page.goto('https://www.paypal.com/myaccount/summary', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await new Promise(r => setTimeout(r, 8000));

  let url = page.url();
  console.log('URL:', url);

  // Check login
  if (url.includes('signin') || url.includes('login')) {
    console.log('\nNot logged in. Please log in manually in the browser window.');
    console.log('Waiting up to 5 minutes...');
    try {
      await page.waitForFunction(() => {
        const u = window.location.href;
        return !u.includes('signin') && !u.includes('login') && u.includes('paypal.com');
      }, { timeout: 300000 });
      console.log('Login detected!');
      // Save new cookies
      const cookies = await browser.cookies();
      saveJson(COOKIE_FILE, { savedAt: new Date().toISOString(), cookies });
      console.log('New cookies saved (' + cookies.length + ')');
      await page.goto('https://www.paypal.com/myaccount/summary', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(r => setTimeout(r, 8000));
    } catch(e) {
      console.log('Login timeout:', e.message);
      await browser.close();
      return;
    }
  }

  // Read balance
  console.log('\nReading PayPal balance...');
  await page.screenshot({ path: path.join(EXPORTS, 'paypal-summary-step.png'), fullPage: false });

  const balance = await page.evaluate(() => {
    const text = document.body.innerText;

    // Method 1: Look for balance label
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/paypal\s*balance|available\s*balance|solde/i.test(lines[i])) {
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          const m = lines[j].match(/\$([\d,]+\.?\d*)/);
          if (m) return parseFloat(m[1].replace(/,/g, ''));
        }
      }
    }

    // Method 2: data-testid
    const bt = document.querySelector('[data-testid="balance"], [data-testid="available-balance"]');
    if (bt) {
      const m = bt.textContent.match(/[\d,]+\.?\d*/);
      if (m) return parseFloat(m[0].replace(/,/g, ''));
    }

    // Method 3: Largest dollar amount on page
    const all = text.match(/\$([\d,]+\.\d{2})/g);
    if (all) {
      let max = 0;
      for (const m of all) {
        const v = parseFloat(m.replace(/[$,]/g, ''));
        if (v > max && v < 1000000) max = v;
      }
      return max || null;
    }

    // Method 4: class-based
    const containers = document.querySelectorAll('[class*="balance"], [class*="amount"], [class*="wallet"], [class*="total"]');
    for (const c of containers) {
      const m = c.textContent.match(/\$([\d,]+\.\d{2})/);
      if (m) return parseFloat(m[1].replace(/,/g, ''));
    }
    return null;
  });

  console.log('\n=============================');
  console.log('PAYPAL BALANCE: $' + (balance || 'UNKNOWN'));
  console.log('Expected convertible: $' + convertible.toFixed(2));
  console.log('=============================\n');

  if (!balance || balance <= 0) {
    console.log('No funds detected. Saving screenshot and exiting.');
    await page.screenshot({ path: path.join(EXPORTS, 'paypal-no-funds.png'), fullPage: true });
    console.log('Page text (first 1000 chars):');
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
    console.log(pageText);
    await browser.close();
    return;
  }

  // Calculate transfer amount
  const transferAmount = Math.min(balance, convertible);
  console.log('Transfer amount: $' + transferAmount.toFixed(2) + ' to Attijariwafa Bank');

  // Navigate to transfer page
  console.log('\nNavigating to transfer page...');
  try {
    await page.goto('https://www.paypal.com/myaccount/transfer/homepage', {
      waitUntil: 'domcontentloaded', timeout: 60000
    });
  } catch {
    try {
      await page.goto('https://www.paypal.com/myaccount/wallet', {
        waitUntil: 'domcontentloaded', timeout: 60000
      });
    } catch(e) {
      console.log('Transfer page error:', e.message);
    }
  }
  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: path.join(EXPORTS, 'paypal-transfer-page.png'), fullPage: false });
  console.log('Transfer page URL:', page.url());

  // Click "Transfer to bank"
  const clickedTransfer = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, span, div')];
    const target = els.find(e => /transfer.*bank|withdraw.*bank|send.*bank/i.test(e.textContent) && e.offsetParent !== null);
    if (target) { target.click(); return target.textContent.trim(); }
    return null;
  });
  console.log('Clicked transfer button:', clickedTransfer || 'not found');
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(EXPORTS, 'paypal-after-transfer-click.png'), fullPage: false });

  // Select bank account
  const bankSelected = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div, span, li, option, label, button, a')];
    const target = els.find(e => /attijari|wafa|00781|morocco|tsouli/i.test(e.textContent) && e.offsetParent !== null);
    if (target) { target.click(); return target.textContent.trim().substring(0, 80); }
    return null;
  });
  console.log('Bank selected:', bankSelected || 'not found');
  await new Promise(r => setTimeout(r, 2000));

  // Fill amount
  const amountFilled = await page.evaluate((amt) => {
    const inputs = [...document.querySelectorAll('input')];
    for (const inp of inputs) {
      if (inp.offsetParent !== null && (inp.type === 'number' || inp.type === 'text' || inp.name?.includes('amount') || inp.placeholder?.includes('amount'))) {
        inp.focus();
        inp.value = '';
        inp.value = amt;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return true;
      }
    }
    // Fallback: first visible input
    for (const inp of inputs) {
      if (inp.offsetParent !== null) {
        inp.focus();
        inp.value = '';
        inp.value = amt;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, transferAmount.toFixed(2));
  console.log('Amount filled:', amountFilled);
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(EXPORTS, 'paypal-amount-filled.png'), fullPage: false });

  // Show page content
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('\nPage content preview:');
  console.log(pageText.substring(0, 500));

  console.log('\n=== REVIEW THE BROWSER WINDOW ===');
  console.log('30 seconds to review before auto-submit...');

  await new Promise(r => setTimeout(r, 30000));

  // Submit
  const submitted = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const target = btns.find(b =>
      /confirm|submit|send|transfer|continue|next/i.test(b.textContent) && b.offsetParent !== null
    );
    if (target) { target.click(); return target.textContent.trim(); }
    return null;
  });
  console.log('Submit clicked:', submitted || 'not found');
  await new Promise(r => setTimeout(r, 8000));

  // Final screenshot
  await page.screenshot({ path: path.join(EXPORTS, 'paypal-transfer-final.png'), fullPage: false });
  console.log('Final screenshot saved');
  console.log('Final URL:', page.url());

  // Record
  const transfers = loadJson(path.join(EXPORTS, 'paypal-transfers.json')) || { transfers: [] };
  transfers.transfers.push({
    timestamp: new Date().toISOString(),
    amount: transferAmount,
    balance: balance,
    submitted: !!submitted,
    buttonText: submitted,
    url: page.url(),
  });
  saveJson(path.join(EXPORTS, 'paypal-transfers.json'), transfers);

  // Update state
  state.executedPayouts.forEach(p => {
    if (p.status === 'pending_transfer') p.status = 'transfer_submitted';
  });
  state.lastRun = new Date().toISOString();
  saveJson(STATE_FILE, state);

  console.log('\n=== TRANSFER COMPLETE ===');
  console.log('Amount: $' + transferAmount.toFixed(2));
  console.log('Status: ' + (submitted ? 'SUBMITTED' : 'REVIEW_NEEDED'));
  console.log('Browser closing in 10s...');
  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
