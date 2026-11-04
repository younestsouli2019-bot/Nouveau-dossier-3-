#!/usr/bin/env node
/**
 * ls-provision — create Lemon Squeezy products for the RWC catalog and emit
 * the slug -> hosted-checkout map consumed by src/lib/checkout-rails.ts.
 *
 * Usage:
 *   node scripts/ls-provision.mjs --dry-run [--limit 10] [--slugs a,b,c]
 *   node scripts/ls-provision.mjs --apply   [--limit 10] [--slugs a,b,c]
 *
 * Rules:
 *  - Dry-run is the default; nothing is created without --apply.
 *  - Idempotent: an existing product with the same name is reused, never
 *    duplicated. Existing checkout URLs are preserved.
 *  - Fails closed on a bad/expired key or a non-active store: no partial map.
 *  - Writes payments/ls-checkout-map.json (public URLs only, no secrets).
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://api.lemonsqueezy.com/v1";
const KEY = process.env.LEMON_SQUEEZY_API_KEY || "";
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) || 0 : 0;
const slugsArg = args.indexOf("--slugs");
const SLUGS = slugsArg >= 0 ? String(args[slugsArg + 1] || "").split(",").filter(Boolean) : [];

const H = { Accept: "application/vnd.api+json", Authorization: `Bearer ${KEY}`, "Content-Type": "application/vnd.api+json" };

async function ls(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = (json && json.errors && json.errors[0] && json.errors[0].detail) || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${detail}`);
  }
  return json;
}

function readCatalog() {
  const candidates = [
    path.join(process.cwd(), "src", "data", "rwc-catalog-snapshot.json"),
    path.join(process.cwd(), "data", "rwc-catalog-snapshot.json"),
  ];
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) throw new Error("catalog snapshot missing (looked in src/data and data)");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.catalog || [];
  return rows.map((r) => ({ title: r.t || r.title, slug: r.s || r.slug, category: r.c || r.category })).filter((r) => r.slug && r.title);
}

async function main() {
  if (!KEY) throw new Error("LEMON_SQUEEZY_API_KEY is not set");
  console.log(`[ls-provision] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // 1. Validate the key before doing anything else.
  const me = await ls("/users/me");
  console.log(`[ls-provision] auth OK: ${me.data.attributes.email}`);

  // 2. Resolve store; refuse when it is not active (payments would fail anyway).
  const stores = await ls("/stores");
  const store = (stores.data || [])[0];
  if (!store) throw new Error("no store on this account");
  const sa = store.attributes || {};
  console.log(`[ls-provision] store: ${sa.name} (${sa.slug}) status=${sa.status}`);
  if (sa.status && sa.status !== "active") throw new Error(`store is '${sa.status}' — product creation would not accept payments; finish account review first`);

  // 3. Existing products (idempotency + URL preservation).
  const existing = new Map();
  for (let page = 1; page <= 10; page++) {
    const r = await ls(`/products?page[size]=100&page[number]=${page}`);
    const rows = r.data || [];
    for (const p of rows) existing.set(String(p.attributes?.name || "").trim().toLowerCase(), p);
    if (rows.length < 100) break;
  }
  console.log(`[ls-provision] existing products: ${existing.size}`);

  // 4. Select catalog entries.
  let catalog = readCatalog();
  if (SLUGS.length) catalog = catalog.filter((c) => SLUGS.includes(c.slug));
  if (LIMIT > 0) catalog = catalog.slice(0, LIMIT);
  console.log(`[ls-provision] selected: ${catalog.length} course(s)`);

  const BASE_PRICE = Number(process.env.RWC_BASE_PRICE_USD || 19);
  const map = {};
  const created = [];
  const skipped = [];

  for (const course of catalog) {
    const name = course.title.trim();
    const hit = existing.get(name.toLowerCase());
    if (hit) { skipped.push(name); continue; }
    if (!APPLY) { created.push({ name, slug: course.slug, planned: true }); continue; }
    const body = { data: { type: "products", attributes: { store_id: Number(store.id), name, price: Math.round(BASE_PRICE * 100), status: "draft", description: `Practice exam bank — ${course.category || "certification"}` } } };
    const p = await ls("/products", { method: "POST", body: JSON.stringify(body) });
    created.push({ name, slug: course.slug, id: p.data.id });
  }

  // 5. Resolve variant IDs -> checkout URLs for every selected course with a product.
  const products = [...existing.values()].concat([]);
  if (APPLY) {
    for (let page = 1; page <= 10; page++) {
      const r = await ls(`/products?page[size]=100&page[number]=${page}`);
      const rows = r.data || [];
      for (const p of rows) products.push(p);
      if (rows.length < 100) break;
    }
  }
  for (const course of catalog) {
    const p = products.find((x) => String(x.attributes?.name || "").trim().toLowerCase() === course.title.trim().toLowerCase());
    if (!p) continue;
    const v = await ls(`/variants?filter[product_id]=${p.id}&page[size]=1`).catch(() => null);
    const variantId = v?.data?.[0]?.id;
    if (variantId) map[course.slug] = `https://${sa.slug}.lemonsqueezy.com/checkout/buy/${variantId}`;
  }

  const out = path.join(process.cwd(), "payments", "ls-checkout-map.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(map, null, 2) + "\n");
  console.log(`[ls-provision] created=${created.length} skipped=${skipped.length} mapped=${Object.keys(map).length}`);
  console.log(`[ls-provision] map written: ${path.relative(process.cwd(), out)}`);
  if (!APPLY) console.log("[ls-provision] dry-run — re-run with --apply to create products");
}

main().catch((e) => { console.error(`[ls-provision] FATAL: ${e.message}`); process.exit(1); });
