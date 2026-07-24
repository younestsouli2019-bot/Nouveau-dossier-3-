#!/usr/bin/env node
/**
 * Procurement Purchase Order Generator
 * Generates POs from tracker files with confirmed vendor responses
 * Usage: node generate-po.mjs --batch=01 [--format=json|html|pdf]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizeTracker, parsePositiveMoney } from './tracker-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..');

function loadTracker(batchNum) {
  const padded = batchNum.toString().padStart(2, '0');
  const file = join(BASE, 'exports', 'procurement-requests', 'trackers', `batch-${padded}-tracker.json`);
  return normalizeTracker(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
}

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
  return JSON.parse(readFileSync(join(BASE, 'exports', 'procurement-requests', files[padded]), 'utf8').replace(/^\uFEFF/, ''));
}

function generatePONumber(batchNum) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `PO-${dateStr}-B${batchNum.toString().padStart(2, '0')}`;
}

function calculateSubtotal(items) {
  return items.reduce((sum, item) => {
    const price = item.price_quoted || 0;
    const qty = item.quantity || 1;
    return sum + (price * qty);
  }, 0);
}

function generateJSON(batchNum, tracker, batchData) {
  const poNumber = generatePONumber(batchNum);
  const confirmedItems = tracker.items.filter(i => i.price_quoted !== null);

  if (confirmedItems.length === 0) {
    console.log(`  [SKIP] No confirmed prices for batch ${batchNum}`);
    return null;
  }

  const subtotal = calculateSubtotal(confirmedItems);

  const po = {
    po_number: poNumber,
    batch: batchNum.toString().padStart(2, '0'),
    batch_name: tracker.batch_name,
    status: 'draft',
    created_at: new Date().toISOString(),
    recipient: {
      name: tracker.recipient,
      address: tracker.address,
      phone: batchData.ownerPhone || null
    },
    budget: {
      max: tracker.budget,
      currency: tracker.items[0]?.currency || 'MAD',
      subtotal: subtotal,
      remaining: 0
    },
    items: confirmedItems.map(item => ({
      name: item.name,
      brand: item.brand,
      category: item.category,
      quantity: item.quantity,
      unit_price: item.price_quoted,
      total: item.price_quoted * item.quantity,
      currency: item.currency,
      vendor: item.vendor_assigned,
      order_status: item.order_status,
      tracking: item.tracking_number,
      receipt_reference: item.receipt_reference,
      receipt_amount: parsePositiveMoney(item.receipt_amount),
      received_by: item.received_by,
      receipt_document_url: item.receipt_document_url,
      notes: item.notes
    })),
    vendors: [...new Set(confirmedItems.map(i => i.vendor_assigned).filter(Boolean))],
    delivery: {
      address: tracker.address,
      expected_date: null,
      tracking_numbers: confirmedItems.map(i => i.tracking_number).filter(Boolean),
      delivered_items: confirmedItems.filter((i) => i.order_status === 'delivered').length,
      receipt_confirmed_items: confirmedItems.filter((i) => i.receipt_reference && i.received_by).length,
    },
    total_actual: subtotal,
    total_estimated: tracker.total_estimated
  };

  po.budget.remaining = subtotal - parseFloat(tracker.budget.replace(/[^0-9.]/g, ''));

  return po;
}

function generateHTML(batchNum, tracker, batchData, po) {
  if (!po) return '<p>No confirmed prices yet</p>';

  const items = po.items.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.brand || '-'}</td>
        <td>${item.quantity}</td>
        <td>${item.unit_price} ${item.currency}</td>
        <td>${item.total} ${item.currency}</td>
        <td>${item.vendor || '-'}</td>
        <td>${item.order_status}</td>
        <td>${item.tracking || '-'}</td>
        <td>${item.receipt_reference ? `${item.receipt_reference}${item.receipt_amount ? ` (${item.receipt_amount} ${item.currency})` : ''}` : '-'}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Purchase Order ${po.po_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; padding: 20px; }
    .po { background: white; max-width: 900px; margin: 0 auto; padding: 40px; border: 1px solid #ddd; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 3px solid #2196F3; padding-bottom: 20px; }
    .header h1 { color: #2196F3; font-size: 28px; }
    .header .po-number { font-size: 18px; color: #666; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
    .meta-card { background: #f9f9f9; padding: 15px; border-radius: 8px; }
    .meta-card h3 { color: #333; margin-bottom: 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
    .meta-card p { color: #555; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #2196F3; color: white; padding: 12px 8px; text-align: left; font-size: 13px; }
    td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 13px; }
    tr:hover { background: #f5f5f5; }
    .totals { text-align: right; margin-top: 20px; }
    .totals .row { margin: 5px 0; }
    .totals .total { font-size: 20px; font-weight: bold; color: #2196F3; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: bold; }
    .status-draft { background: #FF9800; color: white; }
    .status-confirmed { background: #4CAF50; color: white; }
    .status-sent { background: #2196F3; color: white; }
  </style>
</head>
<body>
  <div class="po">
    <div class="header">
      <div>
        <h1>PURCHASE ORDER</h1>
        <div class="po-number">${po.po_number}</div>
      </div>
      <div>
        <span class="status-badge status-${po.status}">${po.status.toUpperCase()}</span>
        <div style="margin-top: 10px; color: #666; font-size: 13px;">${new Date(po.created_at).toLocaleDateString()}</div>
      </div>
    </div>

    <div class="meta">
      <div class="meta-card">
        <h3>Recipient</h3>
        <p>
          <strong>${po.recipient.name}</strong><br>
          ${po.recipient.address}<br>
          ${po.recipient.phone ? `Phone: ${po.recipient.phone}` : ''}
        </p>
      </div>
      <div class="meta-card">
        <h3>Delivery</h3>
        <p>
          <strong>${po.delivery.address}</strong><br>
          Expected: ${po.delivery.expected_date || 'TBD'}<br>
          Tracking: ${po.delivery.tracking_numbers.join(', ') || 'None'}
          <br>Delivered Items: ${po.delivery.delivered_items}
          <br>Receipts Logged: ${po.delivery.receipt_confirmed_items}
        </p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Brand</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Total</th>
          <th>Vendor</th>
          <th>Status</th>
          <th>Tracking</th>
          <th>Receipt</th>
        </tr>
      </thead>
      <tbody>
        ${items}
      </tbody>
    </table>

    <div class="totals">
      <div class="row">Subtotal: <strong>${po.budget.subtotal} ${po.budget.currency}</strong></div>
      <div class="row">Budget: ${po.budget.max}</div>
      <div class="row">Vendors: ${po.vendors.length}</div>
      <div class="row total">Total: ${po.budget.subtotal} ${po.budget.currency}</div>
    </div>

    <div class="footer">
      Generated by Procurement Swarm System | ${new Date().toISOString()}
    </div>
  </div>
</body>
</html>`;
}

function generateTrackerUpdate(batchNum, tracker, vendorId, itemId, updates) {
  const item = tracker.items.find(i => i.name === itemId);
  if (item) {
    Object.assign(item, updates);
    item.updated_at = new Date().toISOString();
  }

  if (!tracker.vendors_contacted.includes(vendorId)) {
    tracker.vendors_contacted.push(vendorId);
  }

  const trackerFile = join(BASE, 'exports', 'procurement-requests', 'trackers',
    `batch-${batchNum.toString().padStart(2, '0')}-tracker.json`);
  writeFileSync(trackerFile, JSON.stringify(tracker, null, 2), 'utf8');
}

// --- Main ---
const args = process.argv.slice(2);
const batchArg = args.find(a => a.startsWith('--batch='));
const formatArg = args.find(a => a.startsWith('--format='));
const updateArg = args.find(a => a.startsWith('--update='));
const batchNum = batchArg ? parseInt(batchArg.split('=')[1]) : null;

if (!batchNum) {
  console.log('Usage:');
  console.log('  node generate-po.mjs --batch=01 --format=json     # JSON PO');
  console.log('  node generate-po.mjs --batch=01 --format=html     # HTML PO');
  console.log('  node generate-po.mjs --batch=01 --update=item|vendor|price|status');
  console.log('');
  console.log('Update example:');
  console.log('  node generate-po.mjs --batch=08 --update=v015|Wireless Mouse|500|confirmed');
  process.exit(0);
}

const format = formatArg?.split('=')[1] || 'json';
const tracker = loadTracker(batchNum);
const batchData = loadBatch(batchNum);

if (updateArg) {
  const [vendorId, itemName, price, status] = updateArg.split('=');
  console.log(`Updating batch ${batchNum}: vendor=${vendorId}, item=${itemName}, price=${price}, status=${status}`);

  const item = tracker.items.find(i => i.name === itemName);
  if (item) {
    item.vendor_assigned = vendorId;
    item.price_quoted = parseFloat(price);
    item.order_status = status;
    item.updated_at = new Date().toISOString();

    const trackerFile = join(BASE, 'exports', 'procurement-requests', 'trackers',
      `batch-${batchNum.toString().padStart(2, '0')}-tracker.json`);
    writeFileSync(trackerFile, JSON.stringify(tracker, null, 2), 'utf8');
    console.log('Updated tracker');
  } else {
    console.error(`Item not found: ${itemName}`);
    process.exit(1);
  }
}

console.log(`\n=== Generating PO for Batch ${batchNum.toString().padStart(2, '0')} ===`);
console.log(`Format: ${format}`);
console.log(`Confirmed items: ${tracker.items.filter(i => i.price_quoted !== null).length}`);

const po = generateJSON(batchNum, tracker, batchData);

if (po) {
  const padded = batchNum.toString().padStart(2, '0');
  const outDir = join(BASE, 'exports', 'procurement-requests', 'purchase-orders');

  if (format === 'html') {
    const html = generateHTML(batchNum, tracker, batchData, po);
    const outFile = join(outDir, `PO-${padded}.html`);
    writeFileSync(outFile, html, 'utf8');
    console.log(`Written: ${outFile}`);
  } else {
    const outFile = join(outDir, `PO-${padded}.json`);
    writeFileSync(outFile, JSON.stringify(po, null, 2), 'utf8');
    console.log(`Written: ${outFile}`);
  }

  console.log(`\nPO Summary:`);
  console.log(`  Number: ${po.po_number}`);
  console.log(`  Items: ${po.items.length}`);
  console.log(`  Subtotal: ${po.budget.subtotal} ${po.budget.currency}`);
  console.log(`  Budget: ${po.budget.max}`);
  console.log(`  Vendors: ${po.vendors.length}`);
} else {
  console.log('No confirmed prices — PO not generated');
}
