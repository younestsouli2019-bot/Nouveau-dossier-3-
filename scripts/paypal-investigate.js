#!/usr/bin/env node
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const EXPORTS = path.join(ROOT, 'exports', 'settlement');
const COOKIE_FILE = path.join(ROOT, 'exports', 'bank-sessions', 'paypal-cookies.json');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function loadJson(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }

(async () => {
  console.log('=== PayPal Transaction Investigation ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();

  const cookieData = loadJson(COOKIE_FILE);
  if (cookieData?.cookies?.length) {
    await page.setCookie(...cookieData.cookies);
    console.log('Loaded cookies');
  }

  // 1. Check Activity page
  console.log('\n--- Checking Activity/Transactions ---');
  try {
    await page.goto('https://www.paypal.com/myaccount/activity', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 8000));

    const url = page.url();
    console.log('URL:', url);

    if (url.includes('signin')) {
      console.log('LOGIN REQUIRED');
    } else {
      const activityData = await page.evaluate(() => {
        const text = document.body.innerText;

        // Find all dollar amounts
        const dollars = [];
        const regex = /\$[\d,]+\.?\d*/g;
        let m;
        while ((m = regex.exec(text)) !== null) {
          dollars.push(m[0]);
        }

        // Find lines with transaction-related keywords
        const lines = text.split('\n');
        const txLines = [];
        for (let i = 0; i < lines.length; i++) {
          if (/pending|hold|processing|refund|reversal|payment|received|transfer|withdraw|deposit|sale|refund/i.test(lines[i])) {
            txLines.push(lines[i].trim());
          }
        }

        // Get table rows if any
        const tables = document.querySelectorAll('table');
        const tableData = [];
        tables.forEach(t => {
          const rows = t.querySelectorAll('tr');
          rows.forEach(r => {
            tableData.push(r.textContent.trim().replace(/\s+/g, ' ').substring(0, 200));
          });
        });

        return { dollars, txLines: txLines.slice(0, 30), tableData: tableData.slice(0, 20), fullText: text.substring(0, 5000) };
      });

      console.log('\nDollar amounts:', activityData.dollars.join(', '));
      console.log('\nTransaction-related lines:');
      activityData.txLines.forEach(l => console.log('  ', l));
      if (activityData.tableData.length) {
        console.log('\nTable rows:');
        activityData.tableData.forEach(r => console.log('  ', r));
      }
      console.log('\nFull page text:');
      console.log(activityData.fullText);

      await page.screenshot({ path: path.join(EXPORTS, 'paypal-activity-investigation.png'), fullPage: false });
    }
  } catch(e) {
    console.log('Activity error:', e.message);
  }

  // 2. Check Holds/Notifications
  console.log('\n--- Checking Holds/Resolution Center ---');
  try {
    await page.goto('https://www.paypal.com/resolutioncenter', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 5000));

    const holdsData = await page.evaluate(() => {
      return { url: window.location.href, text: document.body.innerText.substring(0, 3000) };
    });
    console.log('URL:', holdsData.url);
    console.log('Content:', holdsData.text);
    await page.screenshot({ path: path.join(EXPORTS, 'paypal-holds-check.png'), fullPage: false });
  } catch(e) {
    console.log('Holds error:', e.message);
  }

  // 3. Check Account balance page (money/balance)
  console.log('\n--- Checking Money/Balance details ---');
  try {
    await page.goto('https://www.paypal.com/myaccount/money', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 6000));

    const moneyData = await page.evaluate(() => {
      const text = document.body.innerText;
      // Extract all amounts with context
      const lines = text.split('\n');
      const relevant = [];
      for (let i = 0; i < lines.length; i++) {
        if (/balance|available|hold|pending|USD|EUR|GBP|MAD|\$|€|£/i.test(lines[i])) {
          relevant.push({ line: i, text: lines[i].trim() });
        }
      }
      return { url: window.location.href, relevant, fullText: text.substring(0, 4000) };
    });
    console.log('URL:', moneyData.url);
    console.log('Relevant lines:');
    moneyData.relevant.forEach(l => console.log(`  [${l.line}] ${l.text}`));
    console.log('\nFull text:');
    console.log(moneyData.fullText);
    await page.screenshot({ path: path.join(EXPORTS, 'paypal-money-details.png'), fullPage: false });
  } catch(e) {
    console.log('Money error:', e.message);
  }

  // 4. Check for any pending payouts in MEP
  console.log('\n--- Checking MEP pending payouts ---');
  try {
    await page.goto('https://www.paypal.com/mep/dashboard', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 6000));

    const mepData = await page.evaluate(() => {
      const text = document.body.innerText;
      const lines = text.split('\n');
      const relevant = [];
      for (let i = 0; i < lines.length; i++) {
        if (/balance|pending|hold|available|total|volume|amount|USD|sale|payout/i.test(lines[i])) {
          relevant.push({ line: i, text: lines[i].trim() });
        }
      }

      // Get data-testid elements
      const testIds = document.querySelectorAll('[data-testid]');
      const testIdData = [];
      testIds.forEach(el => {
        const id = el.getAttribute('data-testid');
        const text = el.textContent.trim().substring(0, 200);
        if (text) testIdData.push({ testid: id, text });
      });

      return { relevant, testIdData, fullText: text.substring(0, 3000) };
    });
    console.log('Relevant lines:');
    mepData.relevant.forEach(l => console.log(`  [${l.line}] ${l.text}`));
    console.log('\ndata-testid elements:');
    mepData.testIdData.forEach(t => console.log(`  ${t.testid}: ${t.text}`));
    await page.screenshot({ path: path.join(EXPORTS, 'paypal-mep-investigation.png'), fullPage: false });
  } catch(e) {
    console.log('MEP error:', e.message);
  }

  // 5. Check linked bank accounts
  console.log('\n--- Checking linked bank accounts ---');
  try {
    await page.goto('https://www.paypal.com/myaccount/money/banks', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 5000));

    const bankData = await page.evaluate(() => {
      return { url: window.location.href, text: document.body.innerText.substring(0, 3000) };
    });
    console.log('URL:', bankData.url);
    console.log('Content:', bankData.text);
    await page.screenshot({ path: path.join(EXPORTS, 'paypal-linked-banks.png'), fullPage: false });
  } catch(e) {
    console.log('Banks error:', e.message);
  }

  console.log('\nBrowser closing in 3 minutes...');
  await new Promise(r => setTimeout(r, 180000));
  await browser.close();
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
