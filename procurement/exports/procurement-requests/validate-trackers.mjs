#!/usr/bin/env node
/**
 * Validate procurement trackers
 *
 * Scans all `trackers/batch-*-tracker.json` files and reports:
 * - status/field inconsistencies (e.g., delivered without receipt evidence)
 * - missing vendor or price for confirmed/ordered items
 * - shipped/delivered without tracking number
 *
 * Usage:
 *   node procurement/exports/procurement-requests/validate-trackers.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  normalizeTracker,
  parsePositiveMoney,
  validateItemUpdate,
} from './tracker-utils.mjs';

const BASE = process.cwd();
const TRACKERS_DIR = path.join(BASE, 'procurement', 'exports', 'procurement-requests', 'trackers');

function listTrackerFiles() {
  if (!fs.existsSync(TRACKERS_DIR)) return [];
  return fs.readdirSync(TRACKERS_DIR)
    .filter((f) => /^batch-\d{2}-tracker\.json$/.test(f))
    .map((f) => path.join(TRACKERS_DIR, f))
    .sort();
}

function loadTracker(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return normalizeTracker(JSON.parse(raw));
}

function validateTrackerFile(filePath) {
  const tracker = loadTracker(filePath);
  const batch = path.basename(filePath).match(/batch-(\d{2})-tracker\.json/)?.[1] || '??';
  const issues = [];

  tracker.items.forEach((item) => {
    const updates = {
      order_status: item.order_status,
      vendor_assigned: item.vendor_assigned,
      price_quoted: item.price_quoted,
      tracking_number: item.tracking_number,
      delivery_date: item.delivery_date,
      receipt_reference: item.receipt_reference,
      receipt_amount: parsePositiveMoney(item.receipt_amount),
      received_by: item.received_by,
    };

    const err = validateItemUpdate(item, updates);
    if (err) {
      issues.push({
        batch,
        item: item.name,
        status: item.order_status,
        error: err,
      });
    }
  });

  return { batch, trackerName: tracker.batch_name, issues };
}

function main() {
  const files = listTrackerFiles();
  if (files.length === 0) {
    console.log('No tracker files found.');
    process.exit(0);
  }

  const report = files.map(validateTrackerFile);
  const totalIssues = report.reduce((sum, r) => sum + r.issues.length, 0);

  console.log('=== PROCUREMENT TRACKER VALIDATION ===\n');
  console.log(`Trackers scanned: ${files.length}`);
  console.log(`Issues found:     ${totalIssues}\n`);

  if (totalIssues === 0) {
    console.log('All trackers look consistent.');
    process.exit(0);
  }

  for (const entry of report) {
    if (entry.issues.length === 0) continue;
    console.log(`Batch ${entry.batch} — ${entry.trackerName}: ${entry.issues.length} issue(s)`);
    for (const issue of entry.issues) {
      console.log(`  - ${issue.item} [${issue.status}]: ${issue.error}`);
    }
    console.log('');
  }

  process.exit(1);
}

main();

