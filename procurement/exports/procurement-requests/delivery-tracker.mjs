#!/usr/bin/env node
/**
 * Procurement Delivery Tracker
 * Updates and reports on delivery status across all batches
 * Usage: node delivery-tracker.mjs [--batch=01] [--action=status|update|report]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  hasConfirmedReceipt,
  normalizeTracker,
  parsePositiveMoney,
  summarizeTracker,
  updateTrackerStatus,
  validateItemUpdate,
} from './tracker-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..');

function loadTracker(batchNum) {
  const padded = batchNum.toString().padStart(2, '0');
  const file = join(BASE, 'exports', 'procurement-requests', 'trackers', `batch-${padded}-tracker.json`);
  return normalizeTracker(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
}

function saveTracker(batchNum, tracker) {
  const padded = batchNum.toString().padStart(2, '0');
  const file = join(BASE, 'exports', 'procurement-requests', 'trackers', `batch-${padded}-tracker.json`);
  writeFileSync(file, JSON.stringify(updateTrackerStatus(normalizeTracker(tracker)), null, 2), 'utf8');
}

function getStatusSummary() {
  const summary = [];

  for (let i = 1; i <= 11; i++) {
    const tracker = loadTracker(i);
    const summaryMetrics = summarizeTracker(tracker);

    summary.push({
      batch: i.toString().padStart(2, '0'),
      name: tracker.batch_name,
      recipient: tracker.recipient,
      budget: tracker.budget,
      total: summaryMetrics.total,
      confirmed: summaryMetrics.confirmed,
      ordered: summaryMetrics.ordered,
      shipped: summaryMetrics.shipped,
      delivered: summaryMetrics.delivered,
      receiptConfirmed: summaryMetrics.receiptConfirmed,
      totalCost: summaryMetrics.totalCost,
      receiptAmount: summaryMetrics.receiptAmount,
      currency: tracker.items[0]?.currency || 'MAD',
      vendorsContacted: tracker.vendors_contacted.length,
      progress: summaryMetrics.progress,
      trackerStatus: tracker.status,
    });
  }

  return summary;
}

function updateItemStatus(batchNum, itemName, updates) {
  const tracker = loadTracker(batchNum);
  const item = tracker.items.find(i => i.name === itemName);

  if (!item) {
    console.error(`Item not found: ${itemName} in batch ${batchNum}`);
    return false;
  }

  const normalizedUpdates = { ...updates };
  if ('receipt_amount' in normalizedUpdates) {
    normalizedUpdates.receipt_amount = parsePositiveMoney(normalizedUpdates.receipt_amount);
  }
  if (normalizedUpdates.order_status === 'delivered' && !normalizedUpdates.received_at && !item.received_at) {
    normalizedUpdates.received_at = new Date().toISOString();
  }

  const validationError = validateItemUpdate(item, normalizedUpdates);
  if (validationError) {
    console.error(`Validation failed: ${validationError}`);
    return false;
  }

  Object.assign(item, normalizedUpdates, { updated_at: new Date().toISOString() });
  updateTrackerStatus(tracker);
  saveTracker(batchNum, tracker);

  console.log(`Updated: ${itemName}`);
  console.log(`  Status: ${item.order_status}`);
  console.log(`  Tracker Status: ${tracker.status}`);
  console.log(`  Tracking: ${item.tracking_number || 'N/A'}`);
  console.log(`  Delivery Date: ${item.delivery_date || 'N/A'}`);
  console.log(`  Receipt Ref: ${item.receipt_reference || 'N/A'}`);
  console.log(`  Received By: ${item.received_by || 'N/A'}`);
  console.log(`  Receipt Amount: ${item.receipt_amount || 'N/A'}`);

  return true;
}

function generateReport() {
  const summary = getStatusSummary();

  const totalItems = summary.reduce((s, b) => s + b.total, 0);
  const totalConfirmed = summary.reduce((s, b) => s + b.confirmed, 0);
  const totalOrdered = summary.reduce((s, b) => s + b.ordered, 0);
  const totalShipped = summary.reduce((s, b) => s + b.shipped, 0);
  const totalDelivered = summary.reduce((s, b) => s + b.delivered, 0);
  const totalReceiptConfirmed = summary.reduce((s, b) => s + b.receiptConfirmed, 0);
  const totalCostMAD = summary.filter(b => b.currency === 'MAD').reduce((s, b) => s + b.totalCost, 0);
  const totalCostUSD = summary.filter(b => b.currency === 'USD').reduce((s, b) => s + b.totalCost, 0);
  const totalReceiptMAD = summary.filter(b => b.currency === 'MAD').reduce((s, b) => s + b.receiptAmount, 0);
  const totalReceiptUSD = summary.filter(b => b.currency === 'USD').reduce((s, b) => s + b.receiptAmount, 0);

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          PROCUREMENT DELIVERY STATUS REPORT                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total Items:     ${totalItems}`);
  console.log(`  Confirmed:       ${totalConfirmed}/${totalItems} (${Math.round((totalConfirmed/totalItems)*100)}%)`);
  console.log(`  Ordered:         ${totalOrdered}/${totalItems} (${Math.round((totalOrdered/totalItems)*100)}%)`);
  console.log(`  Shipped:         ${totalShipped}/${totalItems} (${Math.round((totalShipped/totalItems)*100)}%)`);
  console.log(`  Delivered:       ${totalDelivered}/${totalItems} (${Math.round((totalDelivered/totalItems)*100)}%)`);
  console.log(`  Receipts Logged: ${totalReceiptConfirmed}/${totalItems} (${Math.round((totalReceiptConfirmed/totalItems)*100)}%)`);
  console.log(`  Total Cost:      ${totalCostMAD.toLocaleString()} MAD + $${totalCostUSD.toLocaleString()} USD`);
  console.log(`  Receipt Value:   ${totalReceiptMAD.toLocaleString()} MAD + $${totalReceiptUSD.toLocaleString()} USD`);
  console.log('');

  console.log('  Batch Details:');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('  Batch  Name                    Recipient          Status');
  console.log('  ─────────────────────────────────────────────────────────────');

  for (const b of summary) {
    const status = `${b.delivered}/${b.total} delivered (${b.receiptConfirmed} receipts)`;
    const name = b.name.padEnd(23).substring(0, 23);
    const recipient = b.recipient.substring(0, 18).padEnd(18);
    console.log(`  ${b.batch}    ${name} ${recipient} ${status}`);
  }

  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('');

  // Save report to file
  const reportFile = join(BASE, 'exports', 'procurement-requests', 'delivery-report.json');
  writeFileSync(reportFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    summary: {
      total_items: totalItems,
      confirmed: totalConfirmed,
      ordered: totalOrdered,
      shipped: totalShipped,
      delivered: totalDelivered,
      receipt_confirmed: totalReceiptConfirmed,
      cost_mad: totalCostMAD,
      cost_usd: totalCostUSD,
      receipt_mad: totalReceiptMAD,
      receipt_usd: totalReceiptUSD,
    },
    batches: summary
  }, null, 2), 'utf8');

  console.log(`  Report saved: ${reportFile}`);
}

// --- Main ---
const args = process.argv.slice(2);
const batchArg = args.find(a => a.startsWith('--batch='));
const actionArg = args.find(a => a.startsWith('--action='));
const updateArg = args.find(a => a.startsWith('--item='));
const statusArg = args.find(a => a.startsWith('--status='));

const action = actionArg?.split('=')[1] || 'report';

if (action === 'report' || action === 'status') {
  generateReport();
} else if (action === 'update' && batchArg && updateArg) {
  const batchNum = parseInt(batchArg.split('=')[1]);
  const itemName = updateArg.split('=')[1];
  const updates = {};

  if (statusArg) updates.order_status = statusArg.split('=')[1];
  if (args.find(a => a.startsWith('--tracking='))) updates.tracking_number = args.find(a => a.startsWith('--tracking=')).split('=')[1];
  if (args.find(a => a.startsWith('--delivery-date='))) updates.delivery_date = args.find(a => a.startsWith('--delivery-date=')).split('=')[1];
  if (args.find(a => a.startsWith('--receipt-ref='))) updates.receipt_reference = args.find(a => a.startsWith('--receipt-ref=')).split('=')[1];
  if (args.find(a => a.startsWith('--receipt-amount='))) updates.receipt_amount = args.find(a => a.startsWith('--receipt-amount=')).split('=')[1];
  if (args.find(a => a.startsWith('--received-by='))) updates.received_by = args.find(a => a.startsWith('--received-by=')).split('=')[1];
  if (args.find(a => a.startsWith('--receipt-url='))) updates.receipt_document_url = args.find(a => a.startsWith('--receipt-url=')).split('=')[1];
  if (args.find(a => a.startsWith('--receipt-notes='))) updates.receipt_notes = args.find(a => a.startsWith('--receipt-notes=')).split('=')[1];

  updateItemStatus(batchNum, itemName, updates);
} else {
  console.log('Usage:');
  console.log('  node delivery-tracker.mjs --action=report                    # Full report');
  console.log('  node delivery-tracker.mjs --action=update --batch=08 --item="Wireless Mouse" --status=ordered');
  console.log('  node delivery-tracker.mjs --action=update --batch=08 --item="Wireless Mouse" --status=delivered --tracking=ABC123 --delivery-date=2026-07-24 --receipt-ref=RCPT-08-001 --receipt-amount=500 --received-by=Owner');
  console.log('');
  console.log('Status options: pending, confirmed, ordered, shipped, delivered, cancelled');
}
