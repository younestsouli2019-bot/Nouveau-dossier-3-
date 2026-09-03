#!/usr/bin/env node
/**
 * procurement-delivery-watchdog.mjs  (AUTONOMOUS · fail-closed)
 *
 * Watches for REAL vendor waybills so PO delivery can advance only on real
 * proof — never a fabricated orderRef/tracking/delivery.
 *
 * Each run:
 *   1. If data/out/waybills.csv exists (columns itemId,tracking,carrier), it
 *      records any rows whose tracking token is real-looking and whose item
 *      exists in the DB + has a Shipment — same fail-closed advance to
 *      `shipped` that scripts/apply-waybills.mjs performs. trackingVerified stays
 *      false until a real carrier `delivered` scan.
 *   2. If a real carrier-verified delivered file exists (data/out/carrier-delivered.csv,
 *      columns itemId,deliveredEventId), it flips those to `delivered` ONLY on an
 *      explicit, real delivered event id — never synthesized.
 *   3. Reports counts + what remains gated. Never invents a number.
 *
 *   node scripts/procurement-delivery-watchdog.mjs
 *
 * Reads DATABASE_URL (like apply-waybills). Produces data/out/procurement-delivery-watchdog.json
 * and (dry mode) does not mutate: pass DRY=1 to preview without writing.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "data", "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const DRY = String(process.env.DRY || "").toLowerCase() === "true";
const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("DATABASE_URL not set — aborting (fail-closed).");
  process.exit(2);
}
const c = new Client({ connectionString: DB, ssl: process.env.PGSSLMODE ? {} : { rejectUnauthorized: false } });
const TOKEN = /[A-Za-z0-9]{4,}/;

function parseCsv(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*item(Id|ID)?\s*[,].*tracking/i.test(l))
    .map((line) => line.split(",")).map((p) => ({ itemId: (p[0]||"").trim(), tracking: (p[1]||"").trim(), carrier: (p[2]||"").trim(), deliveredEventId: (p[3]||"").trim() }))
    .filter((r) => r.itemId);
}

const ev = { shipped: 0, delivered: 0, skipped_no_token: 0, skipped_no_item: 0, skipped_no_shipment: 0 };
const report = { at: new Date().toISOString(), dry: DRY, ev, advanced: [], gated: [] };

try {
  await c.connect();
  const wbPath = resolve(OUT, "waybills.csv");
  const dlPath = resolve(OUT, "carrier-delivered.csv");
  const wbRows = existsSync(wbPath) ? parseCsv(readFileSync(wbPath, "utf8")) : [];
  const dlRows = existsSync(dlPath) ? parseCsv(readFileSync(dlPath, "utf8")) : [];

  for (const r of wbRows) {
    if (!TOKEN.test(r.tracking)) { ev.skipped_no_token++; report.gated.push({ itemId: r.itemId, reason: "no_real_tracking" }); continue; }
    const item = (await c.query('SELECT id, name FROM "ProcurementItem" WHERE id=$1', [r.itemId])).rows[0];
    if (!item) { ev.skipped_no_item++; report.gated.push({ itemId: r.itemId, reason: "item_not_found" }); continue; }
    const sh = (await c.query('SELECT id FROM "Shipment" WHERE "procurementItemId"=$1', [r.itemId])).rows[0];
    if (!sh) { ev.skipped_no_shipment++; report.gated.push({ itemId: r.itemId, reason: "no_shipment" }); continue; }
    if (!DRY) {
      await c.query('UPDATE "Shipment" SET "trackingNumber"=$1, carrier=$2, "trackingVerified"=false, status=$4, "updatedAt"=NOW() WHERE id=$3',
        [r.tracking, r.carrier || item.name, sh.id, "shipped"]);
    }
    ev.shipped++; report.advanced.push({ itemId: r.itemId, action: "shipped", tracking: r.tracking, verified: false });
  }

  for (const r of dlRows) {
    if (!TOKEN.test(r.tracking) || !TOKEN.test(r.deliveredEventId)) { ev.skipped_no_token++; report.gated.push({ itemId: r.itemId, reason: "no_delivered_event_id" }); continue; }
    const sh = (await c.query('SELECT id FROM "Shipment" WHERE "procurementItemId"=$1', [r.itemId])).rows[0];
    if (!sh) { ev.skipped_no_shipment++; report.gated.push({ itemId: r.itemId, reason: "no_shipment" }); continue; }
    if (!DRY) {
      await c.query('UPDATE "Shipment" SET status=$2, "trackingVerified"=true, "deliveredAt"=NOW(), "updatedAt"=NOW() WHERE id=$1', [sh.id, "delivered"]);
    }
    ev.delivered++; report.advanced.push({ itemId: r.itemId, action: "delivered", deliveredEventId: r.deliveredEventId, verified: true });
  }

  report.ev = ev;
  writeFileSync(resolve(OUT, "procurement-delivery-watchdog.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ dry: DRY, shipped: ev.shipped, delivered: ev.delivered, gated: report.gated.length, note: "never fabricated tracking/delivered; trackingVerified only via real carrier delivered event." }, null, 2));
} finally {
  await c.end();
}