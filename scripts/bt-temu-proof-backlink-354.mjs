import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { createHash } from 'crypto';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

const piRows = await prisma.$queryRawUnsafe(`
  SELECT id, status, "recipientName", currency, "totalEst",
         "deliveryProofHash", "receiptConfirmedAt", "orderRef",
         "supplierName", name
  FROM "ProcurementItem"
  WHERE "recipientName" IN ('Bachir Tsouli','Hind Tsouli','Younes Tsouli','Rais Wafae','Wafae Rais','Rais','Wafae Rais Rais')
  ORDER BY "recipientName", status, id
  LIMIT 500;
`);

const sh = await prisma.$queryRawUnsafe(`
  SELECT "shipmentNumber", "procurementItemId", "itemName", "destinationName", "destinationAddress",
         status, "estimatedDelivery", "actualDelivery", "trackingNumber",
         "carrier", notes
  FROM "Shipment"
  WHERE ("shipmentNumber" LIKE 'WR%' OR "shipmentNumber" LIKE 'SHP-LOCAL%')
  ORDER BY "shipmentNumber"
  LIMIT 400;
`);

console.log('[TEMU-backlink] ProcurementItem rows=' + piRows.length + '  Shipment rows=' + sh.length);
console.log('');
console.log('Recipient status breakdown (missing receipt):');
const recipientMap = new Map();
const MAD_USD = 0.1;
for (const r of piRows) {
  const recipient = r.recipientName || '-';
  const status = r.status || 'UNKNOWN';
  if (!recipientMap.has(recipient)) recipientMap.set(recipient, new Map());
  const byS = recipientMap.get(recipient);
  const cur = (r.currency || 'USD').toUpperCase() === 'MAD' ? MAD_USD : 1;
  const val = (r.totalEst || 0) * cur;
  if (!byS.has(status)) byS.set(status, { rows: 0, missing_proof: 0, missing_receipt: 0, value_usd: 0 });
  const b = byS.get(status);
  b.rows++;
  if (!r.deliveryProofHash) b.missing_proof++;
  if (!r.receiptConfirmedAt) b.missing_receipt++;
  b.value_usd += val;
}
for (const [rec, byS] of recipientMap) {
  console.log('  * ' + rec);
  for (const [status, b] of byS) {
    const pct = b.rows === 0 ? 0 : Math.round((b.missing_receipt / b.rows) * 100);
    console.log(
      '    - status=' + status.padEnd(18) +
      ' rows=' + String(b.rows).padStart(3) +
      ' missing_proof=' + String(b.missing_proof).padStart(3) +
      ' missing_receipt=' + String(b.missing_receipt).padStart(3) +
      ' (' + pct + '%)  value~$' + b.value_usd.toFixed(2)
    );
  }
}

console.log('');
console.log('TEMU WR + SHP-LOCAL shipments (actualDelivery vs estimatedDelivery):');
for (const s of sh) {
  const isWR = String(s.shipmentNumber || '').startsWith('WR');
  const isLocal = String(s.shipmentNumber || '').startsWith('SHP-LOCAL');
  if (!isWR && !isLocal) continue;
  const stamp = s.actualDelivery || s.estimatedDelivery;
  const d = stamp ? new Date(stamp).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' }) : '-';
  const note = (s.notes || '').slice(0, 120);
  const dest = (s.destinationName || '').padEnd(18);
  const statusLine = '  [' + (s.shipmentNumber || '').padEnd(16) + '] ' + (s.status || '').padEnd(10) + ' -> ' + dest + ' @ ' + d + (note ? '  * ' + note : '');
  console.log(statusLine);
}

const wrDelivered = sh.filter(s => s.status === 'delivered' && String(s.shipmentNumber).startsWith('WR')).length;
const localDelivered = sh.filter(s => s.status === 'delivered' && String(s.shipmentNumber).startsWith('SHP-LOCAL')).length;
console.log('');
console.log('Write plan (NO DB write yet - AUDIT ONLY):');
console.log('  1. TEMU WR delivered rows: ' + wrDelivered + ' → ProcurementItem JOIN via Shipment.procurementItemId = ProcurementItem.id → set receiptConfirmedAt=actualDelivery, status=receipt_confirmed, deliveryProofHash=sha256(shipmentNumber+actualDelivery+destinationAddress).');
console.log('  2. SHP-LOCAL delivered rows: ' + localDelivered + ' → same back-link via procurementItemId; set receiptConfirmedAt=actualDelivery (Bachir Tsouli Agdal 45 Ibn Sina).');
console.log('  3. Outstanding pending shipments (WR non-delivered, SHP-LOCAL 0002..013) → NO OP; user reports "nothing received yet" matches these still-in-flight rows.');
console.log('  4. ProcurementItem supplierName=TEMU or name/orderRef containing WR → back-link by name fuzzy when procurementItemId is NULL.');
console.log('');

await prisma.$disconnect();
await pool.end();
