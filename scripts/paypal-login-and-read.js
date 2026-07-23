#!/usr/bin/env node
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const EXPORTS = path.join(ROOT, 'exports', 'settlement');
const COOKIE_FILE = path.join(ROOT, 'exports', 'bank-sessions', 'paypal-cookies.json');

(async () => {
  console.log('Launching fresh Chrome for PayPal login...');
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.goto('https://www.paypal.com/signin', { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('PayPal login page opened in new Chrome window.');
  console.log('Please log in manually.');
  console.log('Waiting up to 5 minutes for login...');

  try {
    await page.waitForFunction(() => {
      const url = window.location.href;
      return !url.includes('signin') && !url.includes('login') && url.includes('paypal.com');
    }, { timeout: 300000 });

    console.log('LOGIN DETECTED! Saving cookies...');
    const cookies = await browser.cookies();
    const dir = path.dirname(COOKIE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({ savedAt: new Date().toISOString(), cookies }, null, 2));
    console.log('Cookies saved (' + cookies.length + ')');
    console.log('URL:', page.url());

    // Read balance
    await page.goto('https://www.paypal.com/myaccount/summary', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    const balance = await page.evaluate(() => {
      const text = document.body.innerText;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/paypal\s*balance|available/i.test(lines[i])) {
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            const m = lines[j].match(/\$([\d,]+\.?\d*)/);
            if (m) return parseFloat(m[1].replace(/,/g, ''));
          }
        }
      }
      const all = text.match(/\$([\d,]+\.\d{2})/g);
      if (all) {
        let max = 0;
        for (const m of all) {
          const v = parseFloat(m.replace(/[$,]/g, ''));
          if (v > max && v < 1000000) max = v;
        }
        return max;
      }
      return null;
    });

    console.log('\n=== PAYPAL BALANCE: $' + (balance || 'unknown') + ' USD ===');
    await page.screenshot({ path: path.join(EXPORTS, 'paypal-balance-captured.png'), fullPage: false });
    console.log('Screenshot saved.');

    // Stay alive for 15 minutes so we can reuse
    console.log('\nBrowser staying open for 15 minutes. Run the transfer script now.');
    console.log('Or use this browser window to do the transfer manually.');
    await new Promise(r => setTimeout(r, 900000));
  } catch(e) {
    console.log('Login timeout or error:', e.message);
    await page.screenshot({ path: path.join(EXPORTS, 'paypal-login-error.png'), fullPage: false });
    await new Promise(r => setTimeout(r, 300000));
  }

  await browser.close();
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
