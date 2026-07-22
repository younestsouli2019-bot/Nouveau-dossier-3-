#!/usr/bin/env node
/**
 * Procurement WhatsApp Queue Sender
 * Sends vendor outreach messages with rate limiting and retry
 * Usage: node send-outreach.mjs --batch=01 [--dry-run] [--vendor=v001]
 * Requires: WhatsApp Web client running on port 3000
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..');

const WHATSAPP_API = process.env.WHATSAPP_API_URL || 'http://localhost:3000';
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '5000'); // 5 seconds between messages
const RETRY_DELAY_MS = 30000; // 30 seconds on failure
const MAX_RETRIES = 3;

const vendorDb = JSON.parse(
  readFileSync(join(BASE, 'exports', 'procurement-requests', 'vendor-database.json'), 'utf8')
    .replace(/^\uFEFF/, '')
);

const queueFile = join(BASE, 'exports', 'procurement-requests', 'send-queue.json');
const logFile = join(BASE, 'exports', 'procurement-requests', 'send-log.json');

function loadQueue() {
  if (existsSync(queueFile)) {
    return JSON.parse(readFileSync(queueFile, 'utf8').replace(/^\uFEFF/, ''));
  }
  return { pending: [], sent: [], failed: [] };
}

function saveQueue(queue) {
  writeFileSync(queueFile, JSON.stringify(queue, null, 2), 'utf8');
}

function appendLog(entry) {
  let log = [];
  if (existsSync(logFile)) {
    log = JSON.parse(readFileSync(logFile, 'utf8').replace(/^\uFEFF/, ''));
  }
  log.push({ ...entry, timestamp: new Date().toISOString() });
  writeFileSync(logFile, JSON.stringify(log, null, 2), 'utf8');
}

function findVendor(vendorId) {
  for (const category of Object.values(vendorDb.vendors)) {
    const found = category.find(v => v.id === vendorId);
    if (found) return found;
  }
  return null;
}

function loadOutreach(batchNum) {
  const padded = batchNum.toString().padStart(2, '0');
  const file = join(BASE, 'exports', 'procurement-requests', 'outreach', `batch-${padded}-outreach.json`);
  if (!existsSync(file)) {
    console.error(`Outreach file not found: ${file}`);
    return [];
  }
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

async function sendWhatsApp(phoneNumber, message) {
  const url = `${WHATSAPP_API}/send-message`;
  const body = {
    phone: phoneNumber,
    message: message
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
}

async function processQueue(dryRun = false, vendorFilter = null) {
  const queue = loadQueue();
  const items = vendorFilter
    ? queue.pending.filter(i => i.vendor_id === vendorFilter)
    : queue.pending;

  console.log(`\n=== Procurement WhatsApp Queue ===`);
  console.log(`Pending: ${queue.pending.length} | Sent: ${queue.sent.length} | Failed: ${queue.failed.length}`);
  console.log(`Processing: ${items.length} messages`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  let processed = 0;
  let failed = 0;

  for (const item of items) {
    const vendor = findVendor(item.vendor_id);
    if (!vendor) {
      console.log(`  [SKIP] Vendor ${item.vendor_id} not found`);
      continue;
    }

    if (!vendor.whatsapp && !vendor.phone) {
      console.log(`  [SKIP] ${vendor.name} — no WhatsApp/phone`);
      queue.pending = queue.pending.filter(i => i.id !== item.id);
      queue.failed.push({ ...item, reason: 'no_contact' });
      continue;
    }

    const phone = vendor.whatsapp || vendor.phone;
    const message = item.message;

    console.log(`  [${dryRun ? 'DRY' : 'SEND'}] → ${vendor.name} (${vendor.tiktok})`);
    console.log(`    Phone: +${phone}`);
    console.log(`    Message: ${message.substring(0, 80)}...`);

    if (!dryRun) {
      try {
        let retries = 0;
        let sent = false;

        while (!sent && retries < MAX_RETRIES) {
          try {
            await sendWhatsApp(phone, message);
            sent = true;
            console.log(`    ✅ Sent successfully`);
            appendLog({
              action: 'sent',
              vendor_id: item.vendor_id,
              vendor_name: vendor.name,
              phone: phone,
              batch: item.batch,
              message_preview: message.substring(0, 100)
            });
          } catch (error) {
            retries++;
            if (retries < MAX_RETRIES) {
              console.log(`    ⚠️ Retry ${retries}/${MAX_RETRIES}: ${error.message}`);
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            } else {
              throw error;
            }
          }
        }

        queue.sent.push(item);
        queue.pending = queue.pending.filter(i => i.id !== item.id);
        processed++;

        // Rate limit
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      } catch (error) {
        console.log(`    ❌ Failed: ${error.message}`);
        appendLog({
          action: 'failed',
          vendor_id: item.vendor_id,
          vendor_name: vendor.name,
          phone: phone,
          batch: item.batch,
          error: error.message
        });
        queue.failed.push({ ...item, error: error.message, retries: MAX_RETRIES });
        queue.pending = queue.pending.filter(i => i.id !== item.id);
        failed++;
      }
    } else {
      processed++;
    }
  }

  saveQueue(queue);
  console.log(`\nDone. Processed: ${processed} | Failed: ${failed}`);
  return { processed, failed };
}

function buildQueueForBatch(batchNum, specificVendor = null) {
  const outreach = loadOutreach(batchNum);
  const queue = loadQueue();

  let added = 0;
  for (const msg of outreach) {
    const vendor = Object.values(vendorDb.vendors)
      .flatMap(c => c)
      .find(v => v.tiktok === msg.vendor_tiktok);

    if (!vendor) continue;
    if (specificVendor && vendor.id !== specificVendor) continue;

    // Skip if already queued or sent
    const alreadyQueued = queue.pending.some(i => i.vendor_id === vendor.id && i.batch === batchNum.toString().padStart(2, '0'));
    const alreadySent = queue.sent.some(i => i.vendor_id === vendor.id && i.batch === batchNum.toString().padStart(2, '0'));
    if (alreadyQueued || alreadySent) continue;

    queue.pending.push({
      id: `${vendor.id}-${batchNum.toString().padStart(2, '0')}`,
      vendor_id: vendor.id,
      vendor_name: vendor.name,
      batch: batchNum.toString().padStart(2, '0'),
      message: msg.message_fr,
      message_ar: msg.message_ar,
      phone: vendor.whatsapp || vendor.phone,
      created_at: new Date().toISOString()
    });
    added++;
  }

  saveQueue(queue);
  return added;
}

// --- Main ---
const args = process.argv.slice(2);
const batchArg = args.find(a => a.startsWith('--batch='));
const vendorArg = args.find(a => a.startsWith('--vendor='));
const dryRun = args.includes('--dry-run');
const buildOnly = args.includes('--build-only');
const sendAll = args.includes('--send-all');
const showStatus = args.includes('--status');

if (showStatus) {
  const queue = loadQueue();
  console.log(JSON.stringify(queue, null, 2));
  process.exit(0);
}

if (!batchArg && !sendAll) {
  console.log('Usage:');
  console.log('  node send-outreach.mjs --batch=01 --build-only     # Build queue');
  console.log('  node send-outreach.mjs --batch=01 --dry-run        # Test send');
  console.log('  node send-outreach.mjs --batch=01                  # Send for batch');
  console.log('  node send-outreach.mjs --send-all --dry-run        # Dry run all');
  console.log('  node send-outreach.mjs --send-all                  # Send all queued');
  console.log('  node send-outreach.mjs --status                    # Show queue');
  process.exit(0);
}

if (buildOnly) {
  const batches = sendAll ? Array.from({ length: 11 }, (_, i) => i + 1) : [parseInt(batchArg.split('=')[1])];
  let totalAdded = 0;
  for (const b of batches) {
    const added = buildQueueForBatch(b, vendorArg?.split('=')[1]);
    console.log(`Batch ${b.toString().padStart(2, '0')}: added ${added} to queue`);
    totalAdded += added;
  }
  console.log(`Total queued: ${totalAdded}`);
} else {
  processQueue(dryRun, vendorArg?.split('=')[1]);
}
