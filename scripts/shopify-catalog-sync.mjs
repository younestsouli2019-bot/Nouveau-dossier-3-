#!/usr/bin/env node
/**
 * shopify-catalog-sync.mjs — mission M2: publish the price book as Shopify products.
 *
 * The price book (rank/output/data/pricing/prices.json) is the ONLY permitted
 * source of a price. Modes:
 *   fixed          -> product with SKU=slug and price from the book
 *   quote_required -> NOT published (captured as a lead, human quotes it)
 *   absent         -> NOT published (not for sale)
 *
 * Rules that keep this honest:
 *   - dry-run by default; --execute requires SWARM_LIVE=1 and credentials
 *   - refuse if store currency != price-book currency (no silent conversion)
 *   - idempotent: match existing products by SKU (slug), never duplicate
 *   - after a create, re-read the SKU to CONFIRM; never assume success
 *
 * Exit: 0 ok/dry-run · 1 error · 2 fail-closed config
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CATALOG = join(ROOT, 'data/rwc-catalog-live.json');
const PRICES = process.env.PRICE_BOOK_PATH || join(ROOT, 'rank/output/data/pricing/prices.json');
const VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';
const EXECUTE = process.argv.includes('--execute');

const fail = (msg, code = 2) => { console.error(`[fail-closed] ${msg}`); process.exit(code); };

const priceBook = JSON.parse(readFileSync(PRICES, 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')).items || [];
const bySlug = new Map(catalog.map((c) => [c.slug, c]));
const currency = priceBook.currency;
const minor = priceBook.minorUnits ?? 2;

const planned = [];
const skipped = [];
for (const [slug, entry] of Object.entries(priceBook.courses || {})) {
  const mode = entry.mode;
  if (mode !== 'fixed') { skipped.push({ slug, reason: mode || 'absent' }); continue; }
  if (!Number.isFinite(entry.amountMinor) || entry.amountMinor <= 0) { skipped.push({ slug, reason: 'fixed-without-amountMinor' }); continue; }
  const meta = bySlug.get(slug);
  if (!meta) { skipped.push({ slug, reason: 'not-in-catalog' }); continue; }
  planned.push({
    sku: slug,
    title: meta.title,
    price: (Number(entry.amountMinor) / 10 ** minor).toFixed(minor),
    currency,
    description: (meta.description || '').slice(0, 5000),
    tags: [meta.category, meta.language].filter(Boolean),
  });
}

if (!EXECUTE) {
  console.log(JSON.stringify({
    mission: 'M2', mode: 'dry-run', currency,
    sellable: planned.length, skipped: skipped.length,
    skipped_by_reason: skipped.reduce((a, s) => (a[s.reason] = (a[s.reason] || 0) + 1, a), {}),
    sample: planned.slice(0, 3),
  }, null, 2));
  console.log('\nNo request sent. Re-run with --execute (requires SWARM_LIVE=1 + credentials).');
  process.exit(0);
}

if (process.env.SWARM_LIVE !== '1') fail('--execute requires SWARM_LIVE=1');
for (const k of ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_API_TOKEN']) {
  if (!process.env[k]) fail(`missing env: ${k}`);
}
const base = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${VERSION}`;
const headers = { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN, 'Content-Type': 'application/json' };

const call = async (path, init = {}) => {
  const res = await fetch(`${base}${path}`, { headers, ...init });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: res.ok ? JSON.parse(text) : null, text: text.slice(0, 300) };
};

(async () => {
  const shop = await call('/shop.json');
  if (!shop.ok) fail(`shop.json HTTP ${shop.status}`, 1);
  const storeCurrency = shop.json.shop?.currency;
  if (storeCurrency !== currency) {
    fail(`store currency ${storeCurrency} != price-book currency ${currency}. Refusing to publish prices that would silently change value.`);
  }

  let created = 0, existing = 0, failed = 0;
  for (const p of planned) {
    const found = await call(`/products.json?limit=1&fields=id,title,variants&handle=${encodeURIComponent(p.sku)}`);
    if (!found.ok) { failed++; continue; }
    if ((found.json.products || []).length) { existing++; continue; }

    const body = { product: {
      title: p.title, body_html: p.description, vendor: 'RealWorldCerts', product_type: p.tags[0] || 'Course',
      handle: p.sku, tags: p.tags.join(', '), status: 'active',
      variants: [{ sku: p.sku, price: p.price, requires_shipping: false }],
    } };
    const made = await call('/products.json', { method: 'POST', body: JSON.stringify(body) });
    if (!made.ok) { failed++; console.error(`  create failed ${p.sku}: HTTP ${made.status} ${made.text}`); continue; }

    const verify = await call(`/products.json?limit=1&fields=id,handle,variants&handle=${encodeURIComponent(p.sku)}`);
    const got = (verify.json?.products || [])[0];
    const priceOk = got?.variants?.[0]?.price === p.price;
    if (!got || !priceOk) { failed++; console.error(`  VERIFY FAILED ${p.sku} (re-read missing or price mismatch)`); continue; }
    created++;
  }

  console.log(JSON.stringify({ mission: 'M2', mode: 'execute', created, existing, failed, planned: planned.length }, null, 2));
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('[M2] error:', e.message); process.exit(1); });
