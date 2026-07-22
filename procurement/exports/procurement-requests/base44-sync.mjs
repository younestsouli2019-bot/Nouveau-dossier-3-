#!/usr/bin/env node
/**
 * Base44 ProcurementRequest Integration
 * Syncs procurement data to Base44 entities
 * Usage: node base44-sync.mjs --batch=01 [--dry-run] [--action=sync|status]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..');

const BASE44_CONFIG = {
  'agent-flow-ai': {
    appId: '6888ac155ebf84dd9855ea98',
    apiKey: '5b4be0fada884ca28142a3279e9880f6',
    baseUrl: 'https://app.base44.com/api/apps'
  },
  'agent-swarm': {
    appId: '689afeabf1db9c30efe0bd7e',
    apiKey: 'e599b5b131574c1bae885fc013620739',
    baseUrl: 'https://app.base44.com/api/apps'
  }
};

const VENDOR_DB = JSON.parse(
  readFileSync(join(BASE, 'exports', 'procurement-requests', 'vendor-database.json'), 'utf8')
    .replace(/^\uFEFF/, '')
);

async function base44Request(appName, method, path, body = null) {
  const config = BASE44_CONFIG[appName];
  if (!config) throw new Error(`Unknown app: ${appName}`);

  const url = `${config.baseUrl}/${config.appId}${path}`;
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json'
  };

  try {
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    const text = await response.text();

    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        return null; // Will trigger offline fallback
      }
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return JSON.parse(text);
  } catch (error) {
    if (error.message.includes('App not found') || error.message.includes('auth_required')) {
      console.log(`  ⚠️ Base44 app "${appName}" unavailable — using offline store`);
      return null;
    }
    throw error;
  }
}

function loadOfflineStore() {
  const storeFile = join(BASE, '.base44-offline-store.json');
  if (existsSync(storeFile)) {
    return JSON.parse(readFileSync(storeFile, 'utf8'));
  }
  return { entities: {} };
}

function saveOfflineStore(store) {
  const storeFile = join(BASE, '.base44-offline-store.json');
  writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8');
}

function loadTracker(batchNum) {
  const padded = batchNum.toString().padStart(2, '0');
  const file = join(BASE, 'exports', 'procurement-requests', 'trackers', `batch-${padded}-tracker.json`);
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
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

function buildProcurementRequestEntity(batchNum, tracker, batchData) {
  const batchInfo = VENDOR_DB.batch_vendor_map[batchNum.toString().padStart(2, '0')];

  return {
    type: 'procurement_request',
    batchId: batchNum.toString().padStart(2, '0'),
    batchName: tracker.batch_name,
    status: tracker.status,
    recipient: {
      name: tracker.recipient,
      address: tracker.address,
      phone: batchInfo?.phone || null
    },
    budget: {
      max: tracker.budget,
      currency: tracker.items[0]?.currency || 'MAD',
      totalActual: calculateTotal(tracker.items)
    },
    items: tracker.items.map(item => ({
      name: item.name,
      brand: item.brand,
      category: item.category,
      quantity: item.quantity,
      priceQuoted: item.price_quoted,
      vendorAssigned: item.vendor_assigned,
      orderStatus: item.order_status,
      trackingNumber: item.tracking_number
    })),
    vendorsContacted: tracker.vendors_contacted,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function calculateTotal(items) {
  return items.reduce((sum, item) => {
    return sum + ((item.price_quoted || 0) * item.quantity);
  }, 0);
}

async function syncToBase44(batchNum, dryRun = false) {
  console.log(`\n=== Syncing Batch ${batchNum.toString().padStart(2, '0')} to Base44 ===`);

  const tracker = loadTracker(batchNum);
  const batchData = loadBatch(batchNum);
  const entity = buildProcurementRequestEntity(batchNum, tracker, batchData);

  console.log(`Recipient: ${entity.recipient.name}`);
  console.log(`Items: ${entity.items.length}`);
  console.log(`Status: ${entity.status}`);

  if (dryRun) {
    console.log('\nDry run — entity would be:');
    console.log(JSON.stringify(entity, null, 2));
    return;
  }

  // Try online first
  const onlineResult = await base44Request('agent-swarm', 'POST', '/entities/ProcurementRequest', entity);

  if (onlineResult) {
    console.log('✅ Synced to Base44 online');
    console.log(`Entity ID: ${onlineResult._id || 'unknown'}`);
    return onlineResult;
  }

  // Fall back to offline store
  console.log('📦 Saving to offline store...');
  const store = loadOfflineStore();
  const key = `procurement_request_batch_${batchNum.toString().padStart(2, '0')}`;

  if (!store.entities.ProcurementRequest) {
    store.entities.ProcurementRequest = {};
  }

  store.entities.ProcurementRequest[key] = {
    ...entity,
    _offline: true,
    _syncedAt: new Date().toISOString()
  };

  saveOfflineStore(store);
  console.log(`Saved to offline store: ${key}`);
  return store.entities.ProcurementRequest[key];
}

async function syncStatus(batchNum) {
  const tracker = loadTracker(batchNum);
  const confirmed = tracker.items.filter(i => i.price_quoted !== null).length;
  const total = tracker.items.length;
  const ordered = tracker.items.filter(i => i.order_status === 'ordered').length;
  const delivered = tracker.items.filter(i => i.order_status === 'delivered').length;

  console.log(`\nBatch ${batchNum.toString().padStart(2, '0')}: ${tracker.batch_name}`);
  console.log(`  Items: ${total}`);
  console.log(`  Confirmed: ${confirmed}/${total}`);
  console.log(`  Ordered: ${ordered}/${total}`);
  console.log(`  Delivered: ${delivered}/${total}`);
  console.log(`  Vendors contacted: ${tracker.vendors_contacted.length}`);
  console.log(`  Total cost: ${calculateTotal(tracker.items)} ${tracker.items[0]?.currency || 'MAD'}`);
}

// --- Main ---
const args = process.argv.slice(2);
const batchArg = args.find(a => a.startsWith('--batch='));
const actionArg = args.find(a => a.startsWith('--action='));
const dryRun = args.includes('--dry-run');
const batchNum = batchArg ? parseInt(batchArg.split('=')[1]) : null;

if (!batchNum) {
  console.log('Usage:');
  console.log('  node base44-sync.mjs --batch=01                    # Sync batch');
  console.log('  node base44-sync.mjs --batch=01 --dry-run          # Preview');
  console.log('  node base44-sync.mjs --batch=01 --action=status    # Status');
  console.log('  node base44-sync.mjs --batch=01 --action=sync-all  # Sync all batches');
  process.exit(0);
}

const action = actionArg?.split('=')[1] || 'sync';

if (action === 'status') {
  if (batchNum === 0) {
    for (let i = 1; i <= 11; i++) {
      await syncStatus(i);
    }
  } else {
    await syncStatus(batchNum);
  }
} else if (action === 'sync-all') {
  for (let i = 1; i <= 11; i++) {
    await syncToBase44(i, dryRun);
  }
} else {
  await syncToBase44(batchNum, dryRun);
}
