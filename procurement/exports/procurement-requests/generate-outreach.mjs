#!/usr/bin/env node
/**
 * Procurement WhatsApp Outreach Generator
 * Generates contact-ready messages for each batch's matched vendors
 * Usage: node generate-outreach.mjs [--batch=01] [--all]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..');

const vendorDb = JSON.parse(readFileSync(join(BASE, 'exports', 'procurement-requests', 'vendor-database.json'), 'utf8'));

function loadBatch(batchNum) {
  const padded = batchNum.toString().padStart(2, '0');
  const files = {
    '01': 'sub-batch-01-hind-tv-soundbar.json',
    '02': 'sub-batch-02-younes-car-home.json',
    '03': 'sub-batch-03-dell-laptops.json',
    '04': 'sub-batch-04-clothing-footwear.json',
    '05': 'sub-batch-05-health-superfoods.json',
    '06': 'sub-batch-06-tobacco-coffee.json',
    '07': 'sub-batch-07-furniture-rental.json',
    '08': 'sub-batch-08-wholesale-electronics.json',
    '09': 'sub-batch-09-miscellaneous.json',
    '10': 'sub-batch-10-bachir-rabat.json',
    '11': 'sub-batch-11-oneplus-phone.json'
  };
  const content = readFileSync(join(BASE, 'exports', 'procurement-requests', files[padded]), 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

function findVendor(vendorId) {
  for (const category of Object.values(vendorDb.vendors)) {
    const found = category.find(v => v.id === vendorId);
    if (found) return found;
  }
  return null;
}

function generateWhatsAppMessage(batchNum, batchData, vendor) {
  const batchInfo = vendorDb.batch_vendor_map[batchNum.toString().padStart(2, '0')];
  const items = batchData.items || [];

  const itemList = items.map(i => `• ${i.name}${i.brand ? ` (${i.brand})` : ''} × ${i.quantity}`).join('\n');

  const phoneInfo = vendor.whatsapp
    ? `WhatsApp: +${vendor.whatsapp}`
    : vendor.phone
    ? `Phone: +212${vendor.phone}`
    : 'DM via TikTok';

  return {
    vendor_name: vendor.name,
    vendor_tiktok: vendor.tiktok,
    contact: phoneInfo,
    message_fr: `Bonjour ${vendor.name},

Je suis à la recherche de produits pour un client au Maroc. Voici la liste :

${itemList}

Budget: ${batchInfo.budget}
Livraison: ${batchInfo.address}

Pouvez-vous me confirmer la disponibilité et les prix ?
Merci !`,

    message_ar: `مرحبا ${vendor.name}

أنا أبحث عن منتجات لعميل في المغرب. إليك القائمة:

${itemList}

الميزانية: ${batchInfo.budget}
العنوان: ${batchInfo.address}

هل يمكنك تأكيد التوفر والأسعار؟
شكرا!`
  };
}

function generateSourcingTracker(batchNum, batchData) {
  const batchInfo = vendorDb.batch_vendor_map[batchNum.toString().padStart(2, '0')];
  const items = batchData.items || [];

  return {
    batch: batchNum,
    batch_name: batchInfo.batch_name,
    recipient: batchInfo.recipient,
    address: batchInfo.address,
    budget: batchInfo.budget,
    status: 'sourcing',
    items: items.map(item => ({
      name: item.name,
      brand: item.brand || null,
      category: item.category,
      quantity: item.quantity,
      vendor_assigned: null,
      price_quoted: null,
      currency: batchData.constraints?.currency || 'MAD',
      order_status: 'pending',
      tracking_number: null,
      delivery_date: null,
      notes: null
    })),
    vendors_contacted: [],
    total_estimated: null,
    total_actual: null,
    created_at: new Date().toISOString()
  };
}

// --- Main ---
const args = process.argv.slice(2);
const batchArg = args.find(a => a.startsWith('--batch='));
const allFlag = args.includes('--all');
const batchNum = batchArg ? parseInt(batchArg.split('=')[1]) : null;

if (!batchNum && !allFlag) {
  console.log('Usage: node generate-outreach.mjs --batch=01 | --all');
  process.exit(1);
}

const batches = allFlag ? Array.from({ length: 11 }, (_, i) => i + 1) : [batchNum];
const outDir = join(BASE, 'exports', 'procurement-requests', 'outreach');
const trackerDir = join(BASE, 'exports', 'procurement-requests', 'trackers');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
if (!existsSync(trackerDir)) mkdirSync(trackerDir, { recursive: true });

for (const b of batches) {
  const padded = b.toString().padStart(2, '0');
  const batchData = loadBatch(b);
  const batchInfo = vendorDb.batch_vendor_map[padded];

  console.log(`\n=== Batch ${padded}: ${batchInfo.batch_name} ===`);
  console.log(`Recipient: ${batchInfo.recipient}`);
  console.log(`Budget: ${batchInfo.budget}`);
  console.log(`Vendors: ${batchInfo.vendors.length}`);

  const outreach = [];
  for (const vid of batchInfo.vendors) {
    const vendor = findVendor(vid);
    if (!vendor) {
      console.log(`  [SKIP] Vendor ${vid} not found`);
      continue;
    }
    const msg = generateWhatsAppMessage(b, batchData, vendor);
    outreach.push(msg);
    console.log(`  [MSG] ${vendor.name} (${vendor.tiktok}) → ${msg.contact}`);
  }

  writeFileSync(
    join(outDir, `batch-${padded}-outreach.json`),
    JSON.stringify(outreach, null, 2),
    'utf8'
  );

  const tracker = generateSourcingTracker(b, batchData);
  writeFileSync(
    join(trackerDir, `batch-${padded}-tracker.json`),
    JSON.stringify(tracker, null, 2),
    'utf8'
  );

  console.log(`  → Written: outreach/batch-${padded}-outreach.json`);
  console.log(`  → Written: trackers/batch-${padded}-tracker.json`);
}

console.log('\nDone. Next steps:');
console.log('1. Send WhatsApp messages to vendors');
console.log('2. Update trackers with vendor responses and prices');
console.log('3. Run: node generate-purchase-orders.mjs --batch=XX');
