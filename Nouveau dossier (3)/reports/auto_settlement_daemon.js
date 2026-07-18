import { buildBase44ServiceClient } from '../src/base44-client.mjs';
import { getRevenueConfigFromEnv } from '../src/base44-revenue.mjs';
import { createPayPalPayoutBatch } from '../src/paypal-api.mjs';
import { validateOwnerDirectiveSetup, preExecutionOwnerCheck, enforceOwnerDirective } from '../src/owner-directive.mjs';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Settlement frequency
  CHECK_INTERVAL_MS: Number(process.env.SETTLEMENT_CHECK_INTERVAL_MS ?? 60 * 1000) || 60 * 1000,
  
  // Auto-approval thresholds (no manual approval needed)
  AUTO_APPROVE_THRESHOLD: Number(process.env.AUTO_APPROVE_THRESHOLD_USD ?? 5000) || 5000,
  AUTO_APPROVE_ROLES: String(process.env.AUTO_APPROVE_ROLES ?? "finance,compliance")
    .split(/[|,; ]/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
  
  // Batch configuration
  MIN_BATCH_SIZE: 1, // Settle even single events
  MAX_BATCH_SIZE: 100, // Max events per batch
  
  // Settlement urgency
  MAX_SETTLEMENT_DELAY_HOURS: 0.25, // 15 minutes max from verification to settlement
  
  // Rail preferences (in order)
  RAIL_PRIORITY: ['PAYPAL', 'BANK_WIRE', 'PAYONEER'],
  
  // Modes
  ENABLE_IMMEDIATE_SETTLEMENT: true, // Settle as soon as verified
  ENABLE_EMERGENCY_MODE: false, // Bypass all checks (use with caution)
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

class SettlementState {
  constructor() {
    this.running = false;
    this.lastCheck = null;
    this.lastSettlement = null;
    this.totalSettled = 0;
    this.settlementCount = 0;
    this.errors = [];
  }

  markCheck() {
    this.lastCheck = new Date().toISOString();
  }

  markSettlement(amount) {
    this.lastSettlement = new Date().toISOString();
    this.totalSettled += amount;
    this.settlementCount += 1;
  }

  addError(error) {
    this.errors.push({
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack
    });
    // Keep only last 50 errors
    if (this.errors.length > 50) {
      this.errors = this.errors.slice(-50);
    }
  }

  getStatus() {
    return {
      running: this.running,
      lastCheck: this.lastCheck,
      lastSettlement: this.lastSettlement,
      totalSettled: this.totalSettled,
      settlementCount: this.settlementCount,
      errorCount: this.errors.length,
      uptime: this.running ? Date.now() - new Date(this.lastCheck).getTime() : 0
    };
  }
}

const state = new SettlementState();

// ============================================================================
// MAIN SETTLEMENT LOOP
// ============================================================================

export async function startAutoSettlementDaemon() {
  console.log('🚀 Starting Autonomous Settlement Daemon...');
  console.log('📋 Configuration:', JSON.stringify(CONFIG, null, 2));

  // Validate owner directive setup
  try {
    validateOwnerDirectiveSetup();
    console.log('✅ Owner Directive validated');
  } catch (error) {
    console.error('❌ Owner Directive validation failed:', error.message);
    process.exit(1);
  }

  state.running = true;
  console.log('✅ Daemon started - settlements will be processed every', CONFIG.CHECK_INTERVAL_MS / 1000, 'seconds');

  // Initial immediate check
  await performSettlementCycle();

  // Schedule regular checks
  const intervalId = setInterval(async () => {
    try {
      await performSettlementCycle();
    } catch (error) {
      console.error('❌ Settlement cycle error:', error);
      state.addError(error);
    }
  }, CONFIG.CHECK_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down settlement daemon...');
    clearInterval(intervalId);
    state.running = false;
    console.log('📊 Final stats:', state.getStatus());
    process.exit(0);
  });

  return intervalId;
}

/**
 * Main settlement cycle - runs periodically
 */
async function performSettlementCycle() {
  state.markCheck();
  console.log(`\n🔄 [${new Date().toISOString()}] Starting settlement cycle...`);

  try {
    await executeApprovedBatchesSunday();
    await retryAndRerouteFailedPayouts();
    // Step 1: Fetch verified revenue events ready for settlement
    const readyEvents = await fetchReadyForSettlement();
    
    if (readyEvents.length === 0) {
      console.log('✅ No events ready for settlement');
      return;
    }

    console.log(`📦 Found ${readyEvents.length} events ready for settlement`);

    // Step 2: Group events by optimal rail
    const batchesByRail = groupEventsByRail(readyEvents);

    // Step 3: Process each rail batch
    for (const [rail, events] of Object.entries(batchesByRail)) {
      console.log(`\n💰 Processing ${rail} batch: ${events.length} events`);
      
      try {
        await processRailBatch(rail, events);
      } catch (error) {
        console.error(`❌ Failed to process ${rail} batch:`, error.message);
        state.addError(error);
      }
    }

  } catch (error) {
    console.error('❌ Settlement cycle error:', error);
    state.addError(error);
  }
}

// ============================================================================
// DATA FETCHING
// ============================================================================

/**
 * Fetches revenue events that are verified and ready for settlement
 */
async function fetchReadyForSettlement() {
  // In production, this would query Base44 or your database
  // For now, we simulate the query
  
  try {
    // Simulated query - replace with actual Base44 query
    const events = await queryRevenueEvents({
      status: 'VERIFIED',
      settled: false,
      verification_proof: { $ne: null },
      // Only events older than X minutes (avoid settling too quickly)
      created_at: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
    });

    // Filter by settlement delay threshold
    const urgentEvents = events.filter(event => {
      const ageHours = (Date.now() - new Date(event.created_at).getTime()) / (1000 * 60 * 60);
      return ageHours < CONFIG.MAX_SETTLEMENT_DELAY_HOURS;
    });

    return urgentEvents;
  } catch (error) {
    console.error('❌ Failed to fetch ready events:', error);
    return [];
  }
}

/**
 * Mock query function - replace with actual Base44 SDK call
 */
async function queryRevenueEvents(query) {
  // TODO: Replace with actual Base44 query
  // const base44 = new Base44Client();
  // return await base44.RevenueEvent.find(query);
  
  console.log('📊 Querying revenue events with:', JSON.stringify(query));
  
  // Simulated response
  return [
    {
      id: 'REV_001',
      amount: 125.50,
      currency: 'USD',
      verification_proof: { psp_id: 'TXN_123' },
      status: 'VERIFIED',
      created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString()
    }
  ];
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Groups events by optimal payment rail
 */
function groupEventsByRail(events) {
  const batches = {};

  for (const event of events) {
    const rail = selectOptimalOwnerAccount(event.amount, event.currency).type;

    if (!batches[rail]) {
      batches[rail] = [];
    }

    batches[rail].push(event);
  }

  return batches;
}

/**
 * Processes a batch of events for a specific rail
 */
async function processRailBatch(rail, events, options = {}) {
  console.log(`⚡ Processing ${rail} batch: ${events.length} events`);

  // Step 1: Create payout batch
  const batch = await createPayoutBatch(rail, events, options);
  console.log(`📦 Created batch: ${batch.batch_id}`);

  // Step 2: Auto-approve (if under threshold)
  const totalAmount = events.reduce((sum, e) => sum + e.amount, 0);
  
  if (totalAmount <= CONFIG.AUTO_APPROVE_THRESHOLD || CONFIG.ENABLE_EMERGENCY_MODE) {
    console.log(`✅ Auto-approving batch (${totalAmount} ${events[0]?.currency || 'USD'})`);
    await approveBatch(batch.batch_id);
  } else {
    const role = String(process.env.AUTONOMOUS_ROLE ?? process.env.RUNTIME_ROLE ?? "").toLowerCase()
    if (role && CONFIG.AUTO_APPROVE_ROLES.includes(role)) {
      console.log(`✅ Role-based auto-approve (${role}) for amount ${totalAmount}`)
      await approveBatch(batch.batch_id);
    } else {
      console.log(`⏳ Batch requires manual approval (${totalAmount} ${events[0]?.currency || 'USD'})`);
      return; // Wait for manual approval
    }
  }

  // Step 3: Validate owner directive (CRITICAL)
  try {
    await preExecutionOwnerCheck({ batch });
    console.log('✅ Owner directive validated');
  } catch (error) {
    console.error('❌ Owner directive violation:', error.message);
    throw error;
  }

  if (CONFIG.ENABLE_IMMEDIATE_SETTLEMENT || isSundayNow()) {
    await executeSettlement(rail, batch);
    await markEventsSettled(events.map(e => e.id), batch.batch_id);
  } else {
    console.log('⏳ Execution scheduled for Sunday');
  }

  state.markSettlement(totalAmount);
  console.log(`✅ Settled ${events.length} events via ${rail}`);
}

// ============================================================================
// PAYOUT EXECUTION
// ============================================================================

/**
 * Creates a payout batch in the ledger
 */
async function createPayoutBatch(rail, events, options = {}) {
  const totalAmount = events.reduce((sum, e) => sum + e.amount, 0);
  const currency = events[0]?.currency || 'USD';
  const ownerAccounts = getOwnerAccounts();
  const recipient =
    rail === 'PAYPAL'
      ? ownerAccounts.paypal
      : rail === 'BANK_WIRE'
        ? ownerAccounts.bank.rib
        : ownerAccounts.payoneer.accountId;

  const batch = {
    batch_id: `BATCH_${rail}_${Date.now()}`,
    rail,
    total_amount: totalAmount,
    currency,
    status: 'pending_approval',
    revenue_event_ids: events.map(e => e.id),
    items: events.map(e => ({
      amount: e.amount,
      currency: e.currency,
      recipient,
      recipient_type: 'owner',
      sender_item_id: `ITEM_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
      revenue_event_id: e.id
    })),
    created_at: new Date().toISOString(),
    owner_directive_enforced: true,
    micro_reroute: options?.microReroute === true
  };

  // Validate all destinations
  for (const item of batch.items) {
    enforceOwnerDirective(item.recipient, item.recipient_type);
  }

  console.log(`📝 Created batch:`, {
    id: batch.batch_id,
    events: batch.revenue_event_ids.length,
    amount: totalAmount,
    currency
  });

  if (shouldWritePayoutLedger()) {
    const base44 = buildBase44ServiceClient();
    const payoutBatchEntity = base44.asServiceRole.entities['PayoutBatch'];
    const payoutItemEntity = base44.asServiceRole.entities['PayoutItem'];
    const created = await payoutBatchEntity.create({
      batch_id: batch.batch_id,
      status: 'pending_approval',
      total_amount: totalAmount,
      currency,
      notes: { recipient, recipient_type: 'owner', micro_reroute: options?.microReroute === true },
      payout_method: rail,
      revenue_event_ids: batch.revenue_event_ids,
      owner_directive_enforced: true,
      created_at: batch.created_at
    });
    for (const it of batch.items) {
      await payoutItemEntity.create({
        item_id: it.sender_item_id,
        batch_id: batch.batch_id,
        status: 'pending',
        amount: it.amount,
        currency: it.currency,
        recipient: it.recipient,
        recipient_type: it.recipient_type,
        revenue_event_id: it.revenue_event_id,
        created_at: new Date().toISOString()
      }).catch(() => null);
    }
  }

  return batch;
}

/**
 * Approves a payout batch
 */
async function approveBatch(batchId) {
  console.log(`✅ Approving batch: ${batchId}`);
  
  if (shouldWritePayoutLedger()) {
    const base44 = buildBase44ServiceClient();
    const entity = base44.asServiceRole.entities['PayoutBatch'];
    const recs = await entity.filter({ batch_id: String(batchId) }, "-created_date", 1, 0);
    const id = Array.isArray(recs) && recs[0]?.id ? recs[0].id : null;
    if (id) {
      await entity.update(id, {
        status: 'approved',
        approved_at: new Date().toISOString(),
        notes: { auto_approved: true }
      }).catch(() => null);
    }
  }
  
  return true;
}

/**
 * Executes settlement on the payment rail
 */
async function executeSettlement(rail, batch) {
  console.log(`🚀 Executing ${rail} settlement...`);

  switch (rail) {
    case 'PAYPAL':
      return await executePayPalSettlement(batch);
    
    case 'BANK_WIRE':
      return await executeBankWireSettlement(batch);
    
    case 'PAYONEER':
      return await executePayoneerSettlement(batch);
    
    case 'CRYPTO':
      return await executeCryptoSettlement(batch);
    
    default:
      throw new Error(`Unsupported rail: ${rail}`);
  }
}

/**
 * PayPal Payout execution
 */
async function executePayPalSettlement(batch) {
  console.log('💳 Executing PayPal payout...');

  if (!shouldWritePayoutLedger()) return { ok: true };
  if (!isPayPalPayoutSendEnabled()) return { ok: false, reason: 'paypal_send_disabled' };
  requireLiveMode('submit_paypal_payout_batch');
  const items = batch.items.map(item => ({
    recipient_type: 'EMAIL',
    receiver: item.recipient,
    amount: { value: Number(item.amount).toFixed(2), currency: item.currency },
    note: `Payout ${batch.batch_id}`,
    sender_item_id: item.sender_item_id
  }));
  const response = await createPayPalPayoutBatch({
    senderBatchId: batch.batch_id,
    items,
    emailSubject: 'You have a payout',
    emailMessage: `Payout batch ${batch.batch_id}`
  });
  const paypalBatchId = response?.batch_header?.payout_batch_id ?? null;
  console.log('✅ PayPal payout submitted:', paypalBatchId);
  const base44 = buildBase44ServiceClient();
  const batchEntity = base44.asServiceRole.entities['PayoutBatch'];
  const itemEntity = base44.asServiceRole.entities['PayoutItem'];
  const recs = await batchEntity.filter({ batch_id: String(batch.batch_id) }, "-created_date", 1, 0);
  const id = Array.isArray(recs) && recs[0]?.id ? recs[0].id : null;
  if (id) {
    const submittedAt = new Date().toISOString();
    const notes = { paypal_payout_batch_id: paypalBatchId, paypal_batch_status: response?.batch_header?.batch_status ?? null };
    await batchEntity.update(id, { status: 'submitted_to_paypal', submitted_at: submittedAt, notes }).catch(() => null);
  }
  const bySenderId = new Map();
  const itemsInLedger = await itemEntity.filter({ batch_id: String(batch.batch_id) }, "-created_date", 500, 0).catch(() => []);
  for (const it of Array.isArray(itemsInLedger) ? itemsInLedger : []) {
    const sid = it?.item_id ?? null;
    if (sid) bySenderId.set(String(sid), it?.id ?? null);
  }
  const respItems = Array.isArray(response?.items) ? response.items : [];
  for (const ri of respItems) {
    const payoutItemId = ri?.payout_item_id ?? ri?.payout_item?.payout_item_id ?? null;
    const senderItemId = ri?.payout_item?.sender_item_id ?? ri?.sender_item_id ?? null;
    const transactionStatus = ri?.transaction_status ?? ri?.payout_item?.transaction_status ?? null;
    const internalId = senderItemId ? bySenderId.get(String(senderItemId)) : null;
    if (!internalId) continue;
    await itemEntity.update(internalId, {
      status: 'processing',
      paypal_status: transactionStatus ? String(transactionStatus) : null,
      paypal_item_id: payoutItemId ? String(payoutItemId) : null
    }).catch(() => null);
  }
  return { ok: true, paypalBatchId };
}

/**
 * Bank Wire execution (generates CSV for manual upload)
 */
async function executeBankWireSettlement(batch) {
  console.log('🏦 Generating Bank Wire CSV...');

  // Generate bank wire CSV
  const csv = generateBankWireCSV(batch);
  const filename = `bank_wire_${batch.batch_id}.csv`;

  // TODO: Write CSV file
  // const fs = require('fs');
  // fs.writeFileSync(`./exports/${filename}`, csv);

  console.log(`✅ Bank Wire CSV generated: ${filename}`);

  // TODO: Update ledger
  // await base44.PayoutBatch.update(batch.batch_id, {
  //   status: 'export_ready',
  //   exported_at: new Date().toISOString(),
  //   notes: { export_filename: filename }
  // });

  return { filename, csv };
}

/**
 * Payoneer execution (generates CSV for manual upload)
 */
async function executePayoneerSettlement(batch) {
  console.log('💼 Generating Payoneer CSV...');

  // Generate Payoneer CSV
  const csv = generatePayoneerCSV(batch);
  const filename = `payoneer_${batch.batch_id}.csv`;

  // TODO: Write CSV file
  // fs.writeFileSync(`./exports/${filename}`, csv);

  console.log(`✅ Payoneer CSV generated: ${filename}`);

  return { filename, csv };
}

// ============================================================================
// CSV GENERATION
// ============================================================================

function generateBankWireCSV(batch) {
  const headers = 'Beneficiary RIB,Amount,Currency,Reference,Date';
  const rows = batch.items.map(item => 
    `${getOwnerAccounts().bank.rib},${item.amount},${item.currency},${item.sender_item_id},${new Date().toISOString()}`
  );
  return [headers, ...rows].join('\n');
}

function generatePayoneerCSV(batch) {
  const headers = 'Account ID,Amount,Currency,Description,Reference';
  const rows = batch.items.map(item =>
    `${getOwnerAccounts().payoneer.accountId},${item.amount},${item.currency},${item.note},${item.sender_item_id}`
  );
  return [headers, ...rows].join('\n');
}

async function executeCryptoSettlement(batch) {
  const allowMicro = String(process.env.ALLOW_MICROPAYMENTS_TO_OWNER ?? 'true').toLowerCase() === 'true';
  const minMicro = Number(process.env.MIN_MICRO_AMOUNT_USD ?? '0.01');
  const minNet = Number(process.env.CRYPTO_MIN_NET_USD ?? '1');
  const token = String(process.env.CRYPTO_TOKEN ?? 'USDT');
  const chain = String(process.env.CRYPTO_CHAIN ?? 'ERC20');
  const receiver = String(process.env.OWNER_CRYPTO_ADDRESS ?? process.env.OWNER_TRUST_WALLET ?? '').trim();
  if (!receiver) return { ok: false, reason: 'missing_owner_crypto_address' };
  const payload = [];
  for (const it of batch.items) {
    const amt = Number(it?.amount ?? 0);
    const microAmt = allowMicro ? Math.max(minMicro, amt) : amt;
    if (microAmt < minNet) continue;
    payload.push({
      receiver,
      token,
      chain,
      amount: Number(microAmt).toFixed(2),
      reference: it?.sender_item_id ?? null
    });
  }
  if (payload.length === 0 && allowMicro) {
    const events = batch.items
      .map(x => ({ id: x?.revenue_event_id ?? null, amount: Math.max(minMicro, Number(x?.amount ?? 0)), currency: x?.currency ?? 'USD' }))
      .filter(e => e.id);
    if (events.length > 0) {
      await processRailBatch('PAYPAL', events, { microReroute: true }).catch(() => {});
    }
  }
  if (!shouldWritePayoutLedger()) return { ok: true, crypto_export_ready: payload.length };
  const base44 = buildBase44ServiceClient();
  const batchEntity = base44.asServiceRole.entities['PayoutBatch'];
  const recs = await batchEntity.filter({ batch_id: String(batch.batch_id) }, "-created_date", 1, 0).catch(() => []);
  const id = Array.isArray(recs) && recs[0]?.id ? recs[0].id : null;
  if (id) {
    const notes = { ...(recs[0]?.notes ?? {}), crypto_export_ready: true, crypto_payload: payload, token, chain, receiver };
    await batchEntity.update(id, { status: 'export_ready_crypto', notes }).catch(() => null);
  }
  return { ok: true, crypto_export_ready: payload.length };
}

// ============================================================================
// STATE UPDATES
// ============================================================================

/**
 * Marks events as settled in the ledger
 */
async function markEventsSettled(eventIds, batchId) {
  console.log(`📝 Marking ${eventIds.length} events as settled`);

  if (!shouldWritePayoutLedger()) return;
  const base44 = buildBase44ServiceClient();
  const cfg = getRevenueConfigFromEnv();
  const entity = base44.asServiceRole.entities[cfg.entityName];
  for (const id of eventIds) {
    const recs = await entity.filter({ [cfg.fieldMap.externalId]: String(id) }, "-created_date", 1, 0).catch(() => []);
    const internalId = Array.isArray(recs) && recs[0]?.id ? recs[0].id : null;
    if (!internalId) continue;
    const patch = {};
    if (cfg.fieldMap.status) patch[cfg.fieldMap.status] = 'paid_out';
    if (cfg.fieldMap.payoutBatchId) patch[cfg.fieldMap.payoutBatchId] = String(batchId);
    await entity.update(internalId, patch).catch(() => null);
  }
}

// ============================================================================
// MONITORING & HEALTH
// ============================================================================

/**
 * Returns daemon health status
 */
export function getDaemonHealth() {
  return {
    ...state.getStatus(),
    config: CONFIG,
    owner_accounts: Object.keys(getOwnerAccounts()).map(key => ({
      type: key,
      enabled: true,
      priority: 1
    }))
  };
}

/**
 * Emergency stop - halts all settlements
 */
export function emergencyStop() {
  console.log('🚨 EMERGENCY STOP ACTIVATED');
  state.running = false;
  CONFIG.ENABLE_IMMEDIATE_SETTLEMENT = false;
  CONFIG.ENABLE_EMERGENCY_MODE = false;
}

/**
 * Manual trigger - forces immediate settlement check
 */
export async function triggerManualSettlement() {
  console.log('⚡ Manual settlement triggered');
  await performSettlementCycle();
}

function getOwnerAccounts() {
  return {
    paypal: String(process.env.OWNER_PAYPAL_EMAIL ?? 'younestsouli2019@gmail.com'),
    bank: { rib: String(process.env.OWNER_BANK_RIB ?? '007810000448500030594182') },
    payoneer: { accountId: String(process.env.OWNER_PAYONEER_ACCOUNT_ID ?? 'PRINCIPAL_ACCOUNT') }
  };
}

function shouldWritePayoutLedger() {
  return String(process.env.BASE44_ENABLE_PAYOUT_LEDGER_WRITE ?? 'false').toLowerCase() === 'true';
}

function isPayPalPayoutSendEnabled() {
  const a = String(process.env.PAYPAL_PPP2_APPROVED ?? 'false').toLowerCase() === 'true';
  const b = String(process.env.PAYPAL_PPP2_ENABLE_SEND ?? 'false').toLowerCase() === 'true';
  return a && b;
}

function isSundayNow() {
  const d = new Date();
  return d.getUTCDay() === 0;
}

function requireLiveMode(reason) {
  const live = String(process.env.SWARM_LIVE ?? 'false').toLowerCase() === 'true';
  if (!live) throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
  const offline =
    String(process.env.BASE44_OFFLINE ?? 'false').toLowerCase() === 'true' ||
    String(process.env.BASE44_OFFLINE_MODE ?? 'false').toLowerCase() === 'true';
  if (offline) throw new Error(`LIVE MODE NOT GUARANTEED (offline mode enabled: ${reason})`);
  const paypalMode = String(process.env.PAYPAL_MODE ?? 'live').toLowerCase();
  const paypalBase = String(process.env.PAYPAL_API_BASE_URL ?? '').toLowerCase();
  if (paypalMode === 'sandbox' || paypalBase.includes('sandbox.paypal.com')) {
    throw new Error(`LIVE MODE NOT GUARANTEED (PayPal sandbox configured: ${reason})`);
  }
}

function getRoutingPriority() {
  const raw = String(process.env.PAYMENT_ROUTING_PRIORITY ?? "").trim();
  if (!raw) return ['PAYPAL', 'BANK_WIRE', 'PAYONEER'];
  const map = {
    bank: 'BANK_WIRE',
    payoneer: 'PAYONEER',
    paypal: 'PAYPAL',
    crypto: 'CRYPTO'
  };
  return raw.split(/[|,; ]/g).map(x => map[String(x).toLowerCase()] || '').filter(Boolean);
}

function selectOptimalOwnerAccount(amount, currency) {
  const prio = getRoutingPriority();
  for (const p of prio) return { type: p };
  return { type: 'PAYPAL' };
}

async function executeApprovedBatchesSunday() {
  if (!isSundayNow() || !shouldWritePayoutLedger()) return;
  const base44 = buildBase44ServiceClient();
  const batchEntity = base44.asServiceRole.entities['PayoutBatch'];
  const batches = await batchEntity.filter({ status: 'approved' }, "-created_date", 250, 0).catch(() => []);
  for (const b of Array.isArray(batches) ? batches : []) {
    const rail = b?.payout_method ?? 'PAYPAL';
    const rec = {
      batch_id: b?.batch_id ?? null,
      items: await loadBatchItems(base44, b?.batch_id)
    };
    if (!rec.batch_id) continue;
    await executeSettlement(rail, rec).catch(() => {});
  }
}

async function loadBatchItems(base44, batchId) {
  const itemEntity = base44.asServiceRole.entities['PayoutItem'];
  const list = await itemEntity.filter({ batch_id: String(batchId) }, "-created_date", 500, 0).catch(() => []);
  return Array.isArray(list)
    ? list.map(it => ({
        amount: it?.amount ?? 0,
        currency: it?.currency ?? 'USD',
        recipient: it?.recipient ?? null,
        recipient_type: it?.recipient_type ?? 'owner',
        sender_item_id: it?.item_id ?? null,
        revenue_event_id: it?.revenue_event_id ?? null
      }))
    : [];
}

async function retryAndRerouteFailedPayouts() {
  if (!shouldWritePayoutLedger()) return;
  const base44 = buildBase44ServiceClient();
  const batchEntity = base44.asServiceRole.entities['PayoutBatch'];
  const itemEntity = base44.asServiceRole.entities['PayoutItem'];
  const failed = await itemEntity.filter({ status: 'failed' }, "-created_date", 500, 0).catch(() => []);
  if (!Array.isArray(failed) || failed.length === 0) return;
  const grouped = new Map();
  for (const it of failed) {
    const batchId = it?.batch_id ?? null;
    if (!batchId) continue;
    const arr = grouped.get(batchId) ?? [];
    arr.push(it);
    grouped.set(batchId, arr);
  }
  for (const [batchId, items] of grouped.entries()) {
    const allowMicro = String(process.env.ALLOW_MICROPAYMENTS_TO_OWNER ?? 'true').toLowerCase() === 'true';
    const minMicro = Number(process.env.MIN_MICRO_AMOUNT_USD ?? '0.01');
    const next = allowMicro ? 'PAYPAL' : 'PAYONEER';
    let original = null;
    try {
      const list = await batchEntity.filter({ batch_id: String(batchId) }, "-created_date", 1, 0);
      original = Array.isArray(list) ? list[0] ?? null : null;
    } catch {}
    const alreadyMicro = Boolean(original?.notes?.micro_reroute === true);
    const originalRail = String(original?.payout_method ?? '').toUpperCase();
    if (alreadyMicro && next === 'PAYPAL') {
      continue;
    }
    if (originalRail === next && next === 'PAYPAL' && alreadyMicro) {
      continue;
    }
    const events = items
      .map(x => {
        const amt = Number(x?.amount ?? 0);
        const microAmt = allowMicro ? Math.max(minMicro, amt) : amt;
        return { id: x?.revenue_event_id ?? null, amount: microAmt, currency: x?.currency ?? 'USD' };
      })
      .filter(e => e.id);
    if (events.length === 0) continue;
    await processRailBatch(next, events, { microReroute: allowMicro && next === 'PAYPAL' }).catch(() => {});
    if (original?.id) {
      const notes = { ...(original?.notes ?? {}), micro_reroute: allowMicro && next === 'PAYPAL', rerouted_to: next, rerouted_at: new Date().toISOString() };
      await batchEntity.update(original.id, { notes }).catch(() => {});
    }
  }
}

// ============================================================================
// STARTUP
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🎯 Starting as standalone daemon...');
  startAutoSettlementDaemon().catch(error => {
    console.error('💥 Daemon startup failed:', error);
    process.exit(1);
  });
}

export default {
  startAutoSettlementDaemon,
  getDaemonHealth,
  emergencyStop,
  triggerManualSettlement
};
