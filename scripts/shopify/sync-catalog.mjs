#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ARGS = process.argv.slice(2);
const SHOULD_MUTATE = ARGS.includes('--execute') && process.env.SWARM_LIVE === '1';

let shopConfig, priceBook;
try {
  shopConfig = JSON.parse(readFileSync(join(process.cwd(), 'shop.json'), 'utf8'));
  priceBook = JSON.parse(readFileSync(join(process.cwd(), 'rank/output/data/pricing/prices.json'), 'utf8'));
} catch {
  console.error('❌ Configuration error: Ensure shop.json and the price book exist.');
  process.exit(1);
}

const { store_domain } = shopConfig;
const apiKey = process.env.SHOPIFY_ADMIN_API_KEY;
const API = `https://${store_domain}/admin/api/2024-01`;

const metrics = { sellable: 0, skipped: 0, quote_required: 0, 'fixed-without-amount': 0 };
const itemsToPublish = [];

for (const [slug, meta] of Object.entries(priceBook.courses || {})) {
  if (meta.type === 'quote_required') {
    metrics.skipped++;
    metrics.quote_required++;
    continue;
  }
  if (meta.type === 'fixed' && (!meta.amount || meta.amount <= 0)) {
    metrics.skipped++;
    metrics['fixed-without-amount']++;
    continue;
  }
  metrics.sellable++;
  itemsToPublish.push({ slug, ...meta });
}

console.log('📊 Price Book Analysis:', metrics);

if (itemsToPublish.length === 0) {
  console.log('ℹ️ Zero products qualify for sync. Adjust your price book first.');
  process.exit(0);
}

const headers = { 'X-Shopify-Access-Token': apiKey, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} -> status ${res.status}`);
  return res.json();
}

// Idempotent: update the product with this handle if it exists, otherwise create it.
async function upsert(item) {
  const found = await call('GET', `/products.json?handle=${encodeURIComponent(item.slug)}&fields=id,variants`);
  const existing = found.products?.[0];
  const price = String(item.amount);
  if (existing) {
    const variantId = existing.variants?.[0]?.id;
    const { product } = await call('PUT', `/products/${existing.id}.json`, {
      product: { id: existing.id, title: item.title || item.slug, variants: [{ id: variantId, price }] },
    });
    return { id: product.id, action: 'updated' };
  }
  const { product } = await call('POST', '/products.json', {
    product: { title: item.title || item.slug, handle: item.slug, variants: [{ sku: item.slug, price }] },
  });
  return { id: product.id, action: 'created' };
}

async function syncCatalog() {
  if (!SHOULD_MUTATE) {
    console.log(`\n🛡️ DRY RUN ONLY: Use --execute with SWARM_LIVE=1 to push ${itemsToPublish.length} items to Shopify.`);
    return;
  }
  if (!apiKey) {
    console.error('❌ Execution blocked: SHOPIFY_ADMIN_API_KEY is not set.');
    process.exit(1);
  }

  console.log(`\n🚀 Commencing live synchronization of ${itemsToPublish.length} items...`);
  let failed = 0;
  for (const item of itemsToPublish) {
    try {
      const { id, action } = await upsert(item);
      await call('GET', `/products/${id}.json`);
      console.log(`  ✅ ${action} and verified SKU: ${item.slug}`);
    } catch (err) {
      failed++;
      console.error(`  ❌ Failed syncing SKU ${item.slug}: ${err.message}`);
    }
  }
  if (failed) process.exit(1);
}

syncCatalog();
