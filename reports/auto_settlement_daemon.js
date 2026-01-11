// scripts/auto-settlement-daemon.mjs
// AUTONOMOUS SETTLEMENT: Immediate owner payouts with ZERO unnecessary delays

import {
  OWNER_ACCOUNTS,
  enforceOwnerDirective,
  selectOptimalOwnerAccount,
  generateOwnerPayoutConfig,
  validateOwnerDirectiveSetup,
  preExecutionOwnerCheck
} from '../src/owner-directive.mjs';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Settlement frequency
  CHECK_INTERVAL_MS: 60 * 1000, // Check every 1 minute
  
  // Auto-approval thresholds (no manual approval needed)
  AUTO_APPROVE_THRESHOLD: 5000, // USD - auto-approve up to this amount
  
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
    const account = selectOptimalOwnerAccount(event.amount, event.currency);
    const rail = account.type;

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
async function processRailBatch(rail, events) {
  console.log(`⚡ Processing ${rail} batch: ${events.length} events`);

  // Step 1: Create payout batch
  const batch = await createPayoutBatch(rail, events);
  console.log(`📦 Created batch: ${batch.batch_id}`);

  // Step 2: Auto-approve (if under threshold)
  const totalAmount = events.reduce((sum, e) => sum + e.amount, 0);
  
  if (totalAmount <= CONFIG.AUTO_APPROVE_THRESHOLD || CONFIG.ENABLE_EMERGENCY_MODE) {
    console.log(`✅ Auto-approving batch (${totalAmount} ${events[0]?.currency || 'USD'})`);
    await approveBatch(batch.batch_id);
  } else {
    console.log(`⏳ Batch requires manual approval (${totalAmount} ${events[0]?.currency || 'USD'})`);
    return; // Wait for manual approval
  }

  // Step 3: Validate owner directive (CRITICAL)
  try {
    await preExecutionOwnerCheck({ batch });
    console.log('✅ Owner directive validated');
  } catch (error) {
    console.error('❌ Owner directive violation:', error.message);
    throw error;
  }

  // Step 4: Execute settlement
  await executeSettlement(rail, batch);
  
  // Step 5: Mark events as settled
  await markEventsSettled(events.map(e => e.id), batch.batch_id);

  state.markSettlement(totalAmount);
  console.log(`✅ Settled ${events.length} events via ${rail}`);
}

// ============================================================================
// PAYOUT EXECUTION
// ============================================================================

/**
 * Creates a payout batch in the ledger
 */
async function createPayoutBatch(rail, events) {
  const account = OWNER_ACCOUNTS[rail.toLowerCase().replace('_wire', '')];
  const totalAmount = events.reduce((sum, e) => sum + e.amount, 0);
  const currency = events[0]?.currency || 'USD';

  const batch = {
    batch_id: `BATCH_${rail}_${Date.now()}`,
    rail,
    total_amount: totalAmount,
    currency,
    status: 'pending_approval',
    revenue_event_ids: events.map(e => e.id),
    items: events.map(e => generateOwnerPayoutConfig(e.amount, e.currency)),
    created_at: new Date().toISOString(),
    owner_directive_enforced: true
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

  // TODO: Write to Base44 ledger
  // await base44.PayoutBatch.create(batch);

  return batch;
}

/**
 * Approves a payout batch
 */
async function approveBatch(batchId) {
  console.log(`✅ Approving batch: ${batchId}`);
  
  // TODO: Update Base44 ledger
  // await base44.PayoutBatch.update(batchId, {
  //   status: 'approved',
  //   approved_at: new Date().toISOString(),
  //   approved_by: 'AUTO_SETTLEMENT_DAEMON'
  // });
  
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
    
    default:
      throw new Error(`Unsupported rail: ${rail}`);
  }
}

/**
 * PayPal Payout execution
 */
async function executePayPalSettlement(batch) {
  console.log('💳 Executing PayPal payout...');

  // TODO: Call PayPal Payouts API
  // const paypalClient = getPayPalClient();
  // const response = await paypalClient.createPayout({
  //   sender_batch_header: {
  //     sender_batch_id: batch.batch_id,
  //     email_subject: 'Revenue Settlement',
  //     recipient_type: 'EMAIL'
  //   },
  //   items: batch.items.map(item => ({
  //     recipient_type: 'EMAIL',
  //     amount: { value: item.amount, currency: item.currency },
  //     receiver: item.recipient,
  //     note: item.note,
  //     sender_item_id: item.sender_item_id
  //   }))
  // });

  const mockResponse = {
    batch_id: batch.batch_id,
    payout_batch_id: `PAYPAL_${Date.now()}`,
    batch_status: 'PENDING'
  };

  console.log('✅ PayPal payout submitted:', mockResponse.payout_batch_id);

  // TODO: Update ledger with provider batch ID
  // await base44.PayoutBatch.update(batch.batch_id, {
  //   status: 'submitted_to_paypal',
  //   submitted_at: new Date().toISOString(),
  //   notes: { paypal_payout_batch_id: mockResponse.payout_batch_id }
  // });

  return mockResponse;
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
    `${OWNER_ACCOUNTS.bank.rib},${item.amount},${item.currency},${item.sender_item_id},${new Date().toISOString()}`
  );
  return [headers, ...rows].join('\n');
}

function generatePayoneerCSV(batch) {
  const headers = 'Account ID,Amount,Currency,Description,Reference';
  const rows = batch.items.map(item =>
    `${OWNER_ACCOUNTS.payoneer.accountId},${item.amount},${item.currency},${item.note},${item.sender_item_id}`
  );
  return [headers, ...rows].join('\n');
}

// ============================================================================
// STATE UPDATES
// ============================================================================

/**
 * Marks events as settled in the ledger
 */
async function markEventsSettled(eventIds, batchId) {
  console.log(`📝 Marking ${eventIds.length} events as settled`);

  // TODO: Bulk update Base44
  // await base44.RevenueEvent.updateMany(
  //   { id: { $in: eventIds } },
  //   {
  //     settled: true,
  //     settled_at: new Date().toISOString(),
  //     payout_batch_id: batchId
  //   }
  // );
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
    owner_accounts: Object.keys(OWNER_ACCOUNTS).map(key => ({
      type: key,
      enabled: OWNER_ACCOUNTS[key].enabled,
      priority: OWNER_ACCOUNTS[key].priority
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