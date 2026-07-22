#!/usr/bin/env node
/**
 * Procurement Delivery Tracker
 * Updates and reports on delivery status across all batches
 * Usage: node delivery-tracker.mjs [--batch=01] [--action=status|update|report]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..');

function loadTracker(batchNum) {
  const padded = batchNum.toString().padStart(2, '0');
  const file = join(BASE, 'exports', 'procurement-requests', 'trackers', `batch-${padded}-tracker.json`);
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function saveTracker(batchNum, tracker) {
  const padded = batchNum.toString().padStart(2, '0');
  const file = join(BASE, 'exports', 'procurement-requests', 'trackers', `batch-${padded}-tracker.json`);
  writeFileSync(file, JSON.stringify(tracker, null, 2), 'utf8');
}

function getStatusSummary() {
  const summary = [];

  for (let i = 1; i <= 11; i++) {
    const tracker = loadTracker(i);
    const total = tracker.items.length;
    const confirmed = tracker.items.filter(item => item.price_quoted !== null).length;
    const ordered = tracker.items.filter(item => item.order_status === 'ordered').length;
    const shipped = tracker.items.filter(item => item.order_status === 'shipped').length;
    const delivered = tracker.items.filter(item => item.order_status === 'delivered').length;
    const totalCost = tracker.items.reduce((sum, item) => sum + ((item.price_quoted || 0) * item.quantity), 0);

    summary.push({
      batch: i.toString().padStart(2, '0'),
      name: tracker.batch_name,
      recipient: tracker.recipient,
      budget: tracker.budget,
      total,
      confirmed,
      ordered,
      shipped,
      delivered,
      totalCost,
      currency: tracker.items[0]?.currency || 'MAD',
      vendorsContacted: tracker.vendors_contacted.length,
      progress: total > 0 ? Math.round((delivered / total) * 100) : 0
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

  Object.assign(item, updates, { updated_at: new Date().toISOString() });
  saveTracker(batchNum, tracker);

  console.log(`Updated: ${itemName}`);
  console.log(`  Status: ${item.order_status}`);
  console.log(`  Tracking: ${item.tracking_number || 'N/A'}`);
  console.log(`  Delivery Date: ${item.delivery_date || 'N/A'}`);

  return true;
}

function generateReport() {
  const summary = getStatusSummary();

  const totalItems = summary.reduce((s, b) => s + b.total, 0);
  const totalConfirmed = summary.reduce((s, b) => s + b.confirmed, 0);
  const totalOrdered = summary.reduce((s, b) => s + b.ordered, 0);
  const totalDelivered = summary.reduce((s, b) => s + b.delivered, 0);
  const totalCostMAD = summary.filter(b => b.currency === 'MAD').reduce((s, b) => s + b.totalCost, 0);
  const totalCostUSD = summary.filter(b => b.currency === 'USD').reduce((s, b) => s + b.totalCost, 0);

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          PROCUREMENT DELIVERY STATUS REPORT                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total Items:     ${totalItems}`);
  console.log(`  Confirmed:       ${totalConfirmed}/${totalItems} (${Math.round((totalConfirmed/totalItems)*100)}%)`);
  console.log(`  Ordered:         ${totalOrdered}/${totalItems} (${Math.round((totalOrdered/totalItems)*100)}%)`);
  console.log(`  Delivered:       ${totalDelivered}/${totalItems} (${Math.round((totalDelivered/totalItems)*100)}%)`);
  console.log(`  Total Cost:      ${totalCostMAD.toLocaleString()} MAD + $${totalCostUSD.toLocaleString()} USD`);
  console.log('');

  console.log('  Batch Details:');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('  Batch  Name                    Recipient          Status');
  console.log('  ─────────────────────────────────────────────────────────────');

  for (const b of summary) {
    const status = `${b.delivered}/${b.total} delivered`;
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
      delivered: totalDelivered,
      cost_mad: totalCostMAD,
      cost_usd: totalCostUSD
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

  updateItemStatus(batchNum, itemName, updates);
} else {
  console.log('Usage:');
  console.log('  node delivery-tracker.mjs --action=report                    # Full report');
  console.log('  node delivery-tracker.mjs --action=update --batch=08 --item="Wireless Mouse" --status=ordered --tracking=ABC123');
  console.log('');
  console.log('Status options: pending, confirmed, ordered, shipped, delivered');
}
