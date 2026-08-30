import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const items = await c.query(`SELECT id, name, quantity, "recipientName", "recipientAddress", "deliveryAddress", "purchaseOrderId" FROM "ProcurementItem" ORDER BY id`);

const existingShipments = await c.query(`SELECT "procurementItemId" FROM "Shipment" WHERE "procurementItemId" IS NOT NULL`);
const linkedIds = new Set(existingShipments.rows.map(r => r.procurementItemId));

const recipientAddresses = {
  'Mr Younes Tsouli': {
    destinationName: 'Mr Younes Tsouli',
    destinationAddress: 'Lot. Rita LOT C Im B, APT 17, BOUZNIKA',
    destinationCity: 'BOUZNIKA',
    destinationCountry: 'Morocco',
  },
  'M Bachir Tsouli': {
    destinationName: 'M Bachir Tsouli',
    destinationAddress: '45 Avenue Ibn Sina, Agdal, Rabat, Appt 4',
    destinationCity: 'Rabat',
    destinationCountry: 'Morocco',
  },
  'Mrs Hind Tsouli': {
    destinationName: 'Mrs Hind Tsouli',
    destinationAddress: 'Etage 2 JASMIN II IMM H3 APPT 21, SIDI-YAHYA-ZAIR, 12150 Casablanca',
    destinationCity: 'Casablanca',
    destinationCountry: 'Morocco',
  },
};

let created = 0;
let skipped = 0;

for (const item of items.rows) {
  if (linkedIds.has(item.id)) {
    skipped++;
    continue;
  }
  
  const addr = recipientAddresses[item.recipientName] || {
    destinationName: item.recipientName || 'Unknown',
    destinationAddress: item.deliveryAddress || item.recipientAddress || 'Unknown',
    destinationCity: 'Casablanca',
    destinationCountry: 'Morocco',
  };
  
  const shipmentNumber = `SHP-${new Date().getFullYear()}-${String(1000 + created).slice(-4)}`;
  
  await c.query(`INSERT INTO "Shipment" (id, "shipmentNumber", "procurementItemId", "itemName", quantity, carrier, status, "destinationName", "destinationAddress", "destinationCity", "destinationCountry", "originCountry", purpose, currency, notes, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`, [
    `shp-${Date.now()}-${created}`,
    shipmentNumber,
    item.id,
    item.name,
    item.quantity,
    'International Shipping',
    'pending',
    addr.destinationName,
    addr.destinationAddress,
    addr.destinationCity,
    addr.destinationCountry,
    'France',
    'owner_procurement',
    'USD',
    `Procurement order for ${item.recipientName}`,
  ]);
  
  created++;
}

console.log(`Created ${created} shipments, skipped ${skipped} already linked`);
console.log(`Total procurement items: ${items.rows.length}`);

await c.end();
