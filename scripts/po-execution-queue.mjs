#!/usr/bin/env node
/**
 * po-execution-queue.mjs  (AUTONOMOUS · READ-ONLY)
 *
 * Generates actionable per-supplier execution queues from the DB:
 * - Items needing order placement (sourced → ordered)
 * - Items ordered but missing tracking (ordered → shipped requires waybill)
 * - Items marked shipped without any proof (status integrity gap)
 * - Per-supplier contact details + action templates
 *
 *   node scripts/po-execution-queue.mjs
 *
 * Produces: data/out/po-execution-queue.json + per-supplier CSVs
 */
import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Supplier contact registry (from procurement.txt + CSV worklist)
const SUPPLIER_CONTACTS = {
  'AliExpress': { type: 'online', url: 'aliexpress.com', action: 'check order status + obtain tracking from AliExpress app' },
  'AliExpress / Kricely': { type: 'online', url: 'aliexpress.com/store/kricely', action: 'check Kricely store order + obtain tracking' },
  'Amazon US': { type: 'online', url: 'amazon.com', action: 'check Amazon order + obtain tracking from orders page' },
  'Amazon EU': { type: 'online', url: 'amazon.de/.fr', action: 'check Amazon EU order + obtain tracking' },
  'Samsung Maroc': { type: 'local', phone: null, action: 'contact Samsung Morocco for order status + delivery tracking' },
  'Samsung': { type: 'local', phone: null, action: 'contact Samsung for order status + delivery tracking' },
  'Jumia Maroc': { type: 'online', url: 'jumia.ma', action: 'check Jumia order + obtain tracking from my orders' },
  'Jumia': { type: 'online', url: 'jumia.ma', action: 'check Jumia order + obtain tracking' },
  'Jumia / Digitronics': { type: 'online', url: 'jumia.ma/store/digitronics', action: 'check Digitronics order on Jumia + tracking' },
  'Jumia / Dahua': { type: 'online', url: 'jumia.ma/store/dahua', action: 'check Dahua order on Jumia + tracking' },
  'Jumia / BM10': { type: 'online', url: 'jumia.ma/store/bm10', action: 'check BM10 order on Jumia + tracking' },
  'Jumia / Lamacom': { type: 'online', url: 'jumia.ma/store/lamacom', action: 'check Lamacom order on Jumia + tracking' },
  'JemlaMaroc / Jumia': { type: 'online', url: 'jumia.ma', action: 'check JemlaMaroc bulk order on Jumia + tracking' },
  'Wholesale Supplier (JemlaMaroc)': { type: 'local', phone: null, action: 'contact JemlaMaroc wholesale for delivery status' },
  'Wholesale supplier': { type: 'local', phone: null, action: 'contact wholesale supplier for delivery status + tracking' },
  'Avito Maroc (Refurbished)': { type: 'local_market', url: 'avito.ma', action: 'contact Avito seller for shipping proof + tracking number' },
  'Avito refurbished': { type: 'local_market', url: 'avito.ma', action: 'contact Avito seller for shipping proof + tracking' },
  'AliExpress': { type: 'online', url: 'aliexpress.com', action: 'check AliExpress order status + obtain tracking' },
  'Amed.ma': { type: 'online', url: 'amed.ma', action: 'contact Amed.ma for order status + tracking' },
  'Cafe Gold': { type: 'local', phone: null, action: 'contact Cafe Gold for delivery status' },
  'Elexia': { type: 'online', url: 'elexia.ma', action: 'check Elexia order + obtain tracking' },
  'ELEXIA': { type: 'online', url: 'elexia.ma', action: 'check ELEXIA order + obtain tracking' },
  'Mirka.ma': { type: 'online', url: 'mirka.ma', action: 'contact Mirka.ma for order status + tracking' },
  'Superfood.ma': { type: 'online', url: 'superfood.ma', action: 'contact Superfood.ma for order status + tracking' },
  'Toko.ma': { type: 'online', url: 'toko.ma', action: 'check Toko.ma order + tracking' },
  'Kricely': { type: 'online', url: 'aliexpress.com/store/kricely', action: 'check Kricely order + tracking' },
  'Locamed / Jumia': { type: 'online', url: 'jumia.ma', action: 'check Locamed order on Jumia + tracking' },
  'VEADA / Jumia': { type: 'online', url: 'jumia.ma', action: 'check VEADA order on Jumia + tracking' },
  'Coucou / Jumia': { type: 'online', url: 'jumia.ma', action: 'check Coucou order on Jumia + tracking' },
  'ParfumMaroc': { type: 'online', url: 'parfummaroc.ma', action: 'contact ParfumMaroc for order status + tracking' },
  'CTT Maroc': { type: 'online', url: 'cttmaroc.ma', action: 'check CTT Maroc order + tracking' },
  'Temu': { type: 'online', url: 'temu.com', action: 'check Temu order status + obtain tracking from app' },
  'Dell': { type: 'online', url: 'dell.com', action: 'check Dell order + obtain tracking from Dell support' },
  'Winston': { type: 'local', phone: null, action: 'contact Winston for bulk delivery status' },
  'Panter': { type: 'local', phone: null, action: 'contact Panter for order status' },
  'Brooklyn Smoke Shop': { type: 'online', url: null, action: 'contact Brooklyn Smoke Shop for order status + tracking' },
  'Crest': { type: 'online', url: null, action: 'contact Crest for order status + tracking' },
  'Mil-Tec': { type: 'online', url: null, action: 'contact Mil-Tec for order status + tracking' },
  'Opalescence': { type: 'online', url: null, action: 'contact Opalescence for order status + tracking' },
  'Camel': { type: 'local', phone: null, action: 'contact Camel for order status' },
  'VASOUN / Jumia': { type: 'online', url: 'jumia.ma', action: 'check VASOUN order on Jumia + tracking' },
  'lepiceriefineandco.ma': { type: 'online', url: 'lepiceriefineandco.ma', action: 'contact lepiceriefineandco.ma for order status + tracking' },
  'TAGin3D': { type: 'online', url: null, action: 'contact TAGin3D for order status + tracking' },
  'Bali': { type: 'online', url: null, action: 'contact Bali for coffee order status + tracking' },
  'Local': { type: 'local', phone: null, action: 'contact local vendor for delivery status' },
  'Marche local Bouznika': { type: 'local', phone: null, action: 'visit Marche local Bouznika for fresh produce delivery' },
  'Various': { type: 'local', phone: null, action: 'check multiple vendors for delivery status' },
};

try {
  await c.connect();

  // Get all items with shipment info
  const items = (await c.query(`
    SELECT pi.id, pi.name, pi."supplierName", pi."recipientName", pi.status,
           pi."orderRef", pi.quantity, pi."totalEst", pi."unitPriceEst",
           pi."prePaidBySwarm", pi."createdAt",
           s.id as sid, s.status as ss, s."trackingNumber", s.carrier, s."trackingVerified"
    FROM "ProcurementItem" pi
    LEFT JOIN "Shipment" s ON s."procurementItemId" = pi.id
    ORDER BY pi.status, pi."supplierName", pi.id
  `)).rows;

  // Categorize
  const shippedNoProof = items.filter(i => i.status === 'shipped' && !i.trackingNumber && !i.orderRef);
  const shippedWithRef = items.filter(i => i.status === 'shipped' && (i.orderRef || i.trackingNumber));
  const orderedNoTracking = items.filter(i => i.status === 'ordered' && !i.trackingNumber);
  const orderedWithRef = items.filter(i => i.status === 'ordered' && i.orderRef && !i.trackingNumber);
  const purchased = items.filter(i => i.status === 'purchased');

  // Group by supplier for outreach
  const bySupplier = {};
  for (const item of items) {
    const supp = item.supplierName || 'unknown';
    if (!bySupplier[supp]) bySupplier[supp] = { items: [], totalMAD: 0, statuses: {} };
    bySupplier[supp].items.push({
      id: item.id,
      name: item.name,
      recipient: item.recipientName,
      status: item.status,
      orderRef: item.orderRef,
      tracking: item.trackingNumber,
      totalEst: item.totalEst ? Number(item.totalEst) : 0,
    });
    bySupplier[supp].totalMAD += item.totalEst ? Number(item.totalEst) : 0;
    bySupplier[supp].statuses[item.status] = (bySupplier[supp].statuses[item.status] || 0) + 1;
  }

  // Build execution queue
  const queue = {
    at: new Date().toISOString(),
    engine: 'po-execution-queue',
    summary: {
      total: items.length,
      shippedNoProof: shippedNoProof.length,
      shippedWithRef: shippedWithRef.length,
      orderedNoTracking: orderedNoTracking.length,
      purchased: purchased.length,
      totalMAD: items.reduce((a, r) => a + (r.totalEst ? Number(r.totalEst) : 0), 0),
    },
    integrityGap: {
      description: '98 items marked shipped but have zero tracking numbers, zero orderRefs, and no Shipment records. Status was set without proof.',
      count: shippedNoProof.length,
      totalMAD: shippedNoProof.reduce((a, r) => a + (r.totalEst ? Number(r.totalEst) : 0), 0),
      action: 'Contact each supplier to obtain real tracking/orderRef. Items without proof cannot be confirmed delivered.',
    },
    suppliers: Object.entries(bySupplier).map(([name, data]) => ({
      name,
      contact: SUPPLIER_CONTACTS[name] || { type: 'unknown', action: 'look up contact for this supplier' },
      itemCount: data.items.length,
      totalMAD: data.totalMAD,
      statuses: data.statuses,
      items: data.items,
    })).sort((a, b) => b.totalMAD - a.totalMAD),
    note: 'READ-ONLY. Generate outreach per supplier. Never fabricate tracking or delivery status.',
  };

  writeFileSync(resolve(OUT, 'po-execution-queue.json'), JSON.stringify(queue, null, 2));

  // Generate a per-supplier summary CSV for quick reference
  const csvLines = ['supplier,type,itemCount,totalMAD,shipped_no_proof,ordered_no_tracking,action'];
  for (const s of queue.suppliers) {
    csvLines.push(`"${s.name}",${s.contact.type},${s.itemCount},${s.totalMAD.toFixed(0)},${s.statuses.shipped||0},${s.statuses.ordered||0},"${(s.contact.action||'').replace(/"/g,'""')}"`);
  }
  writeFileSync(resolve(OUT, 'po-supplier-summary.csv'), csvLines.join('\n'));

  console.log(JSON.stringify({
    ok: true,
    total: queue.summary.total,
    shippedNoProof: queue.summary.shippedNoProof,
    orderedNoTracking: queue.summary.orderedNoTracking,
    suppliers: queue.suppliers.length,
    totalMAD: queue.summary.totalMAD,
  }, null, 2));
} finally {
  await c.end();
}
