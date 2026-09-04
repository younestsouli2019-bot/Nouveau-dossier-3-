#!/usr/bin/env node
/**
 * procurement-payment-queue.mjs  (AUTONOMOUS · READ-ONLY · no money movement)
 *
 * Generates a structured procurement payment queue from the DB and CSV worklist,
 * grouped by recipient, ready for operator execution. For Alfa Gros COD flow:
 * the operator pays cash on delivery — no pre-payment API needed.
 *
 *   node scripts/procurement-payment-queue.mjs
 *
 * Produces: data/out/procurement-payment-queue.json
 * Never orders, never pays, never fabricates.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Known suppliers with contact
const SUPPLIERS = {
  'Alfa Gros': { phone: '+212 639 158 209', location: 'Casablanca Kaysariya', type: 'electronics wholesale, COD' },
  'DAcco Shop': { phone: '+212 651 296 438', location: 'Morocco', type: 'decoration/household' },
  'Marche local Bouznika': { phone: null, location: 'Bouznika', type: 'local fresh produce, COD' },
  'Planet Electro': { phone: '+212 684 390 026', location: 'Morocco', type: 'electronics' },
  'KRTechPro': { phone: '+212 604 118 058', location: 'Morocco', type: 'refurb PCs/workstations' },
  'Mirka.ma': { phone: null, location: 'Morocco', type: 'coffee/honey' },
  'Beta Miel': { phone: null, location: 'Morocco', type: 'honey' },
};

try {
  await c.connect();

  // Get all ProcurementItems with shipment status
  const items = (await c.query(`
    SELECT pi.id, pi.name, pi.quantity, pi.status, pi."recipientName",
           pi."unitPriceEst", pi."totalEst", pi.category, pi."supplierName",
           pi."orderRef", pi."prePaidBySwarm",
           s.id as "shipmentId", s.status as "shipmentStatus",
           s."trackingNumber", s.carrier, s."trackingVerified"
    FROM "ProcurementItem" pi
    LEFT JOIN "Shipment" s ON s."procurementItemId" = pi.id
    ORDER BY pi."recipientName", pi.status, pi.name
  `)).rows;

  // Read CSV worklist for supplier mapping
  const csvPath = resolve(OUT, 'order-placement-worklist.csv');
  const csvRows = existsSync(csvPath)
    ? readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('item,'))
        .map(l => {
          const parts = l.split(',');
          return { name: (parts[0]||'').replace(/"/g,'').trim(), supplier: (parts[7]||'').trim(), contact: (parts[8]||'').trim() };
        })
    : [];

  // Group by recipient
  const byRecipient = {};
  for (const item of items) {
    const recip = item.recipientName || 'unknown';
    if (!byRecipient[recip]) byRecipient[recip] = { items: [], totalMAD: 0, totalUsd: 0 };
    const csvMatch = csvRows.find(r => r.name === item.name);
    const supplier = csvMatch?.supplier || item.supplierName || item.carrier || 'unknown';
    const contact = csvMatch?.contact || SUPPLIERS[supplier]?.phone || null;
    byRecipient[recip].items.push({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      status: item.status,
      unitPriceEst: item.unitPriceEst ? Number(item.unitPriceEst) : null,
      totalEst: item.totalEst ? Number(item.totalEst) : null,
      category: item.category,
      supplier,
      contact,
      orderRef: item.orderRef || null,
      prePaidBySwarm: item.prePaidBySwarm || false,
      shipmentStatus: item.shipmentStatus || 'not_shipped',
      trackingNumber: item.trackingNumber || null,
      carrier: item.carrier || null,
      trackingVerified: item.trackingVerified || false,
    });
    byRecipient[recip].totalMAD += item.totalEst ? Number(item.totalEst) : 0;
    byRecipient[recip].totalUsd += item.totalEst ? Number(item.totalEst) / 10 : 0;
  }

  // Build the payment queue
  const queue = {
    at: new Date().toISOString(),
    engine: 'procurement-payment-queue',
    totalItems: items.length,
    totalMAD: items.reduce((a, r) => a + (r.totalEst ? Number(r.totalEst) : 0), 0),
    totalUsd: items.reduce((a, r) => a + (r.totalEst ? Number(r.totalEst) / 10 : 0), 0),
    recipients: byRecipient,
    codFlow: {
      vendor: 'Alfa Gros',
      phone: '+212 639 158 209',
      location: 'Casablanca Kaysariya',
      paymentType: 'Cash on Delivery (COD)',
      operatorAction: 'When Alfa Gros delivers, pay cash and record the amount + delivery confirmation.',
    },
    blocked: items.filter(i => i.status === 'purchased' && !i.trackingNumber).length,
    readyToShip: items.filter(i => i.status === 'sourced' || (i.status === 'purchased' && i.trackingNumber)).length,
    note: 'READ-ONLY queue. Execute through Attijari mobile app for bank transfers, or cash for COD. No API, no fabrication.',
  };

  writeFileSync(resolve(OUT, 'procurement-payment-queue.json'), JSON.stringify(queue, null, 2));
  console.log(JSON.stringify({
    ok: true,
    totalItems: queue.totalItems,
    totalMAD: queue.totalMAD,
    totalUsd: queue.totalUsd.toFixed(2),
    recipients: Object.keys(byRecipient),
    blocked: queue.blocked,
    readyToShip: queue.readyToShip,
  }, null, 2));
} finally {
  await c.end();
}
