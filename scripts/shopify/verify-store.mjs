#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let shopConfig;
try {
  shopConfig = JSON.parse(readFileSync(join(process.cwd(), 'shop.json'), 'utf8'));
} catch {
  console.error('❌ Error: Could not read or parse shop.json at project root.');
  process.exit(2);
}

const { store_domain, expected_currency } = shopConfig || {};
if (!store_domain || !expected_currency) {
  console.error('❌ Error: shop.json must contain "store_domain" and "expected_currency".');
  process.exit(2);
}

const apiKey = process.env.SHOPIFY_ADMIN_API_KEY;
if (!apiKey) {
  console.log(`ℹ️ Store configuration found for: ${store_domain} (${expected_currency})`);
  console.error('❌ Error: SHOPIFY_ADMIN_API_KEY environment variable is missing.');
  console.error('   Aborting verification. No API calls can be performed.');
  process.exit(2);
}

async function verifyStore() {
  const url = `https://${store_domain}/admin/api/2024-01/shop.json`;
  try {
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': apiKey, 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Shopify API responded with status ${response.status}`);
    const data = await response.json();
    const actualCurrency = data.shop.currency;
    if (actualCurrency !== expected_currency) {
      console.error(`❌ Currency Mismatch! Expected: ${expected_currency}, Store: ${actualCurrency}`);
      process.exit(1);
    }
    console.log(`✅ Success: Connected to ${store_domain}. Currency verified as ${actualCurrency}.`);
    process.exit(0);
  } catch (error) {
    console.error(`❌ Connection failed: ${error.message}`);
    process.exit(1);
  }
}

verifyStore();
