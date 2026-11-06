#!/usr/bin/env node
/**
 * shopify-verify.mjs — mission M1: prove the Shopify Admin API surface works.
 *
 * READ-ONLY. Exits non-zero rather than guessing:
 *   0  store reachable, token accepted
 *   1  API/shape error
 *   2  FAIL-CLOSED: required env missing (never attempt a call without them)
 *
 * Env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_API_VERSION
 */
const VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    console.error(`[fail-closed] missing env: ${missing.join(', ')}`);
    console.error('No API call attempted. Refusing to report a store state that was never read.');
    process.exit(2);
  }
}
requireEnv(['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_API_TOKEN']);

const base = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${VERSION}`;

async function get(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN, Accept: 'application/json' },
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: body.slice(0, 300) };
  return { ok: true, status: res.status, json: JSON.parse(body) };
}

(async () => {
  const shop = await get('/shop.json');
  if (!shop.ok) {
    console.error(`[M1] shop.json failed: HTTP ${shop.status} ${shop.body}`);
    process.exit(1);
  }
  const s = shop.json.shop || {};
  console.log(JSON.stringify({
    mission: 'M1',
    store: s.name,
    domain: s.domain,
    currency: s.currency,
    country: s.country_code,
    api_version: VERSION,
    verified: true,
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('[M1] error:', e.message); process.exit(1); });
