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
  console.log('=== PayPal Balance Discovery ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();

  // Load cookies
  const cookieData = loadJson(COOKIE_FILE);
  if (cookieData?.cookies?.length) {
    await page.setCookie(...cookieData.cookies);
    console.log('Loaded', cookieData.cookies.length, 'cookies');
  }

  // Pages to try
  const pages = [
    { name: 'Summary', url: 'https://www.paypal.com/myaccount/summary' },
    { name: 'Wallet', url: 'https://www.paypal.com/myaccount/wallet' },
    { name: 'Balance', url: 'https://www.paypal.com/myaccount/money' },
    { name: 'Activity', url: 'https://www.paypal.com/myaccount/activity' },
    { name: 'MEP Dashboard', url: 'https://www.paypal.com/mep/dashboard' },
  ];

  for (const p of pages) {
    console.log(`\n--- Trying: ${p.name} (${p.url}) ---`);
    try {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 6000));

      const url = page.url();
      console.log('Actual URL:', url);

      if (url.includes('signin') || url.includes('login')) {
        console.log('REDIRECTED TO LOGIN — cookies may be expired');
        continue;
      }

      // Extract ALL dollar amounts
      const data = await page.evaluate(() => {
        const text = document.body.innerText;
        const dollars = [];
        const regex = /\$[\d,]+\.?\d*/g;
        let m;
        while ((m = regex.exec(text)) !== null) {
          dollars.push({ amount: m[0], position: m.index });
        }

        // Also look for EUR, GBP, MAD amounts
        const currencies = [];
        const curRegex = /(€|£|MAD|USD|EUR|GBP)\s*[\d,]+\.?\d*|[\d,]+\.?\d*\s*(€|£|MAD|USD|EUR|GBP)/g;
        while ((m = curRegex.exec(text)) !== null) {
          currencies.push(m[0]);
        }

        // Get all text near "balance", "available", "total"
        const lines = text.split('\n');
        const balanceLines = [];
        for (let i = 0; i < lines.length; i++) {
          if (/balance|available|total|solde|funds|wallet/i.test(lines[i])) {
            balanceLines.push({ line: i, text: lines[i].trim() });
          }
        }

        return { dollars, currencies, balanceLines, pageText: text.substring(0, 3000) };
      });

      console.log('Dollar amounts found:', data.dollars.length);
      data.dollars.forEach(d => console.log('  ', d.amount));
      if (data.currencies.length) {
        console.log('Currency amounts:');
        data.currencies.forEach(c => console.log('  ', c));
      }
      if (data.balanceLines.length) {
        console.log('Balance-related lines:');
        data.balanceLines.forEach(l => console.log(`  [${l.line}] ${l.text}`));
      }

      // Screenshot
      const ssName = `paypal-discover-${p.name.toLowerCase().replace(/\s/g, '-')}.png`;
      await page.screenshot({ path: path.join(EXPORTS, ssName), fullPage: false });

      // If we found dollars, this might be the right page
      if (data.dollars.length > 0) {
        console.log('\n>>> Page text excerpt:');
        console.log(data.pageText.substring(0, 800));
      }

    } catch(e) {
      console.log('Error:', e.message);
    }
  }

  // Also check the MEP dashboard for balance widget
  console.log('\n--- Checking MEP dashboard balance widget ---');
  try {
    await page.goto('https://www.paypal.com/mep/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 8000));

    // Try to find balance via API or hidden elements
    const mepData = await page.evaluate(() => {
      // Check for any hidden data attributes
      const allEls = document.querySelectorAll('[data-balance], [data-amount], [data-testid*="balance"], [data-testid*="amount"]');
      const hidden = [];
      allEls.forEach(el => {
        hidden.push({ tag: el.tagName, testid: el.dataset?.testid, text: el.textContent?.trim().substring(0, 100) });
      });

      // Check for React/Next.js data
      const nextData = document.querySelector('#__NEXT_DATA__');
      if (nextData) {
        try {
          const d = JSON.parse(nextData.textContent);
          return { hidden, nextData: JSON.stringify(d).substring(0, 2000) };
        } catch {}
      }

      // Check window.__INITIAL_STATE__ or similar
      let stateStr = '';
      try {
        if (window.__INITIAL_STATE__) stateStr = JSON.stringify(window.__INITIAL_STATE__).substring(0, 2000);
        if (window.__NEXT_DATA__) stateStr = JSON.stringify(window.__NEXT_DATA__).substring(0, 2000);
      } catch {}

      return { hidden, stateStr, bodyClasses: document.body.className, title: document.title };
    });

    console.log('MEP data:', JSON.stringify(mepData, null, 2));
  } catch(e) {
    console.log('MEP error:', e.message);
  }

  console.log('\nBrowser staying open for 5 minutes — check all screenshots...');
  await new Promise(r => setTimeout(r, 300000));
  await browser.close();
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
