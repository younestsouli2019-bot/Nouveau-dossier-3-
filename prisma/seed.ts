import { PrismaClient } from '@prisma/client';
import { getOwnerDisplayName, getOwnerName, isOwnerConfigured } from '@/lib/owner-config';

const db = new PrismaClient();

// Date helpers — all dates relative to "now", spread over last 30 days
const now = new Date();
const daysAgo = (days: number): Date => {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
};
const hoursAgo = (hours: number): Date => {
  const d = new Date(now);
  d.setHours(d.getHours() - hours);
  return d;
};

async function main() {
  console.log('🌱 Seeding database...');

  // Validate owner config is available
  if (!isOwnerConfigured()) {
    console.warn('[SEED] OWNER_NAME and/or OWNER_EMAIL not configured. Using fallback for seed data only.');
  }
  const ownerName = isOwnerConfigured() ? getOwnerDisplayName() : 'YOUNES TSOULI OWNER';
  const ownerNameShort = isOwnerConfigured() ? getOwnerName() : 'YOUNES TSOULI';

  // ─────────────────────────────────────────────
  // 1. CLEAN EXISTING DATA (delete in FK-safe order)
  // ─────────────────────────────────────────────
  console.log('🗑️  Deleting existing data...');

  await db.cryptoSettlement.deleteMany();
  await db.transactionLog.deleteMany();
  await db.payoutAuditLog.deleteMany();
  await db.payoutItem.deleteMany();
  await db.payoutBatch.deleteMany();
  await db.revenueEvent.deleteMany();
  await db.autoPilotRun.deleteMany();

  console.log('✅ Existing data cleared.');

  // ─────────────────────────────────────────────
  // 2. PAYOUT BATCHES (8 total)
  // ─────────────────────────────────────────────
  console.log('📦 Creating payout batches...');

  // PB-2024-001: completed (old batch, all done)
  const batch001 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-001',
      totalAmount: 14200,
      currency: 'USD',
      status: 'completed',
      itemCount: 3,
      scheduledDate: daysAgo(28),
      processedDate: daysAgo(25),
      submittedAt: daysAgo(26),
      approvedBy: 'finance-team@company.com',
      notes: 'Monthly payout for January contractors',
      paymentProvider: 'paypal',
      providerBatchRef: 'PP-BATCH-12301',
      autoApproved: true,
      autoApprovedAt: daysAgo(28),
      autoProcessed: true,
      autoProcessedAt: daysAgo(26),
    },
  });

  // PB-2024-002: completed (all done, but has delivery issues)
  const batch002 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-002',
      totalAmount: 11500,
      currency: 'USD',
      status: 'completed',
      itemCount: 3,
      scheduledDate: daysAgo(20),
      processedDate: daysAgo(17),
      submittedAt: daysAgo(18),
      approvedBy: 'finance-team@company.com',
      notes: 'February mid-month contractor payments',
      paymentProvider: 'bank_transfer',
      providerBatchRef: 'BANK-BATCH-45601',
    },
  });

  // PB-2024-003: submitted_to_paypal — STUCK! PayPal bottleneck
  const batch003 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-003',
      totalAmount: 12450,
      currency: 'USD',
      status: 'submitted_to_paypal',
      itemCount: 3,
      scheduledDate: daysAgo(5),
      submittedAt: daysAgo(3), // submitted 3 days ago, still stuck
      approvedBy: 'auto-pilot',
      notes: 'March contractor batch submitted to PayPal',
      autoApproved: true,
      autoApprovedAt: daysAgo(5),
      paymentProvider: 'paypal',
      providerBatchRef: 'PP-BATCH-78901',
    },
  });

  // PB-2024-004: pending_approval — needs auto-approve
  const batch004 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-004',
      totalAmount: 8500,
      currency: 'USD',
      status: 'pending_approval',
      itemCount: 3,
      scheduledDate: daysAgo(2),
      notes: 'March late batch — awaiting approval',
    },
  });

  // PB-2024-005: processing — 2 items: 1 completed, 1 stale processing
  const batch005 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-005',
      totalAmount: 7200,
      currency: 'USD',
      status: 'processing',
      itemCount: 2,
      scheduledDate: daysAgo(4),
      submittedAt: daysAgo(3),
      approvedBy: 'finance-team@company.com',
      autoApproved: true,
      autoApprovedAt: daysAgo(4),
      paymentProvider: 'paypal',
      providerBatchRef: 'PP-BATCH-99012',
    },
  });

  // PB-2024-006: failed — 3 items, 1 failed (bank_transfer insufficient_funds), 2 pending
  const batch006 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-006',
      totalAmount: 10500,
      currency: 'USD',
      status: 'failed',
      itemCount: 3,
      scheduledDate: daysAgo(7),
      processedDate: daysAgo(5),
      submittedAt: daysAgo(6),
      approvedBy: 'finance-team@company.com',
      notes: 'March early batch — processing failure on bank transfer',
      // NO resolutionNote — needs manual resolution
      autoApproved: true,
      autoApprovedAt: daysAgo(7),
      paymentProvider: 'bank_transfer',
      providerBatchRef: 'BANK-BATCH-77801',
    },
  });

  // PB-2024-007: approved — 3 items all pending (approved but never started processing)
  const batch007 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-007',
      totalAmount: 13800,
      currency: 'USD',
      status: 'approved',
      itemCount: 4,
      scheduledDate: daysAgo(3),
      approvedBy: 'finance-team@company.com',
      notes: 'March contractor batch — approved but processing never initiated',
      autoApproved: true,
      autoApprovedAt: daysAgo(3),
    },
  });

  // PB-2024-008: completed but has 1 item with deliveryConfirmed=false, 1 unclaimed
  const batch008 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-008',
      totalAmount: 15600,
      currency: 'USD',
      status: 'completed',
      itemCount: 3,
      scheduledDate: daysAgo(10),
      processedDate: daysAgo(8),
      submittedAt: daysAgo(9),
      approvedBy: 'finance-team@company.com',
      notes: 'Late February batch — Payoneer unclaimed item',
      paymentProvider: 'payoneer',
      providerBatchRef: 'PYR-BATCH-33401',
      autoApproved: true,
      autoApprovedAt: daysAgo(10),
      autoProcessed: true,
      autoProcessedAt: daysAgo(9),
    },
  });

  console.log(`✅ Created 9 payout batches (incl. 1 crypto + 1 misplaced fiat batch).`);

  // ─────────────────────────────────────────────
  // 3. PAYOUT ITEMS (24 total across all batches)
  // ─────────────────────────────────────────────
  console.log('📋 Creating payout items...');

  // --- PB-2024-001: 3 completed items (all delivery confirmed, all notified) ---
  const item001_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch001.id,
      batchNumber: 'PB-2024-001',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 4800,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00101',
      processedAt: daysAgo(25),
      deliveryConfirmed: true,
      deliveryConfirmedAt: daysAgo(24),
      recipientNotifiedAt: daysAgo(24),
      retryCount: 0,
    },
  });

  const item001_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch001.id,
      batchNumber: 'PB-2024-001',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 5200,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00102',
      processedAt: daysAgo(25),
      deliveryConfirmed: true,
      deliveryConfirmedAt: daysAgo(24),
      recipientNotifiedAt: daysAgo(24),
      retryCount: 0,
    },
  });

  const item001_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch001.id,
      batchNumber: 'PB-2024-001',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 4200,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00103',
      processedAt: daysAgo(25),
      deliveryConfirmed: true,
      deliveryConfirmedAt: daysAgo(24),
      recipientNotifiedAt: daysAgo(24),
      retryCount: 0,
    },
  });

  // --- PB-2024-002: 3 completed items (2 delivery confirmed, 1 NOT) ---
  const item002_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch002.id,
      batchNumber: 'PB-2024-002',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3800,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'bank_transfer',
      transactionRef: 'TXN-BK-00201',
      processedAt: daysAgo(17),
      deliveryConfirmed: true,
      deliveryConfirmedAt: daysAgo(16),
      recipientNotifiedAt: daysAgo(16),
      retryCount: 0,
    },
  });

  const item002_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch002.id,
      batchNumber: 'PB-2024-002',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 4100,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'bank_transfer',
      transactionRef: 'TXN-BK-00202',
      processedAt: daysAgo(17),
      deliveryConfirmed: true,
      deliveryConfirmedAt: daysAgo(16),
      recipientNotifiedAt: daysAgo(16),
      retryCount: 0,
    },
  });

  // THIS ONE: completed but delivery NOT confirmed — "completed but not received"
  const item002_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch002.id,
      batchNumber: 'PB-2024-002',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3600,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'bank_transfer',
      transactionRef: 'TXN-BK-00203',
      processedAt: daysAgo(17),
      deliveryConfirmed: false, // NOT confirmed — diagnostic scenario
      recipientNotifiedAt: daysAgo(16),
      retryCount: 0,
    },
  });

  // --- PB-2024-003: 3 items all "processing" (stuck in PayPal pipeline) ---
  const item003_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch003.id,
      batchNumber: 'PB-2024-003',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 4500,
      currency: 'USD',
      status: 'processing',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00301',
      processedAt: null, // still stuck
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item003_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch003.id,
      batchNumber: 'PB-2024-003',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3950,
      currency: 'USD',
      status: 'processing',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00302',
      processedAt: null,
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item003_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch003.id,
      batchNumber: 'PB-2024-003',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 4000,
      currency: 'USD',
      status: 'processing',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00303',
      processedAt: null,
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  // --- PB-2024-004: 3 items all "pending" ---
  const item004_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch004.id,
      batchNumber: 'PB-2024-004',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 2800,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'paypal',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item004_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch004.id,
      batchNumber: 'PB-2024-004',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 2900,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'bank_transfer',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item004_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch004.id,
      batchNumber: 'PB-2024-004',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 2800,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'payoneer',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  // --- PB-2024-005: 1 completed, 1 processing (stale, no processedAt) ---
  const item005_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch005.id,
      batchNumber: 'PB-2024-005',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3500,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00501',
      processedAt: daysAgo(2),
      deliveryConfirmed: true,
      deliveryConfirmedAt: daysAgo(1),
      recipientNotifiedAt: daysAgo(1),
      retryCount: 0,
    },
  });

  // THIS ONE: stale processing for 2 days
  const item005_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch005.id,
      batchNumber: 'PB-2024-005',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3700,
      currency: 'USD',
      status: 'processing',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-00502',
      processedAt: null, // stale — never finished processing
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  // --- PB-2024-006: 1 failed, 2 pending ---
  // Failed item (bank_transfer, insufficient_funds)
  const item006_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch006.id,
      batchNumber: 'PB-2024-006',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3500,
      currency: 'USD',
      status: 'failed',
      paymentMethod: 'bank_transfer',
      transactionRef: 'TXN-BK-00601',
      failureReason: 'insufficient_funds',
      processedAt: daysAgo(5),
      deliveryConfirmed: false,
      retryCount: 1,
      lastRetryAt: daysAgo(4),
    },
  });

  const item006_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch006.id,
      batchNumber: 'PB-2024-006',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3500,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'bank_transfer',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item006_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch006.id,
      batchNumber: 'PB-2024-006',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3500,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'bank_transfer',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  // --- PB-2024-007: 4 items all "pending" (approved batch bottleneck) ---
  const item007_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch007.id,
      batchNumber: 'PB-2024-007',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3400,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'paypal',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item007_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch007.id,
      batchNumber: 'PB-2024-007',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3500,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'paypal',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item007_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch007.id,
      batchNumber: 'PB-2024-007',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3450,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'paypal',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  const item007_4 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch007.id,
      batchNumber: 'PB-2024-007',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 3450,
      currency: 'USD',
      status: 'pending',
      paymentMethod: 'paypal',
      deliveryConfirmed: false,
      retryCount: 0,
    },
  });

  // --- PB-2024-008: 3 items: 2 completed (1 delivery NOT confirmed), 1 unclaimed ---
  const item008_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch008.id,
      batchNumber: 'PB-2024-008',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 5200,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'payoneer',
      transactionRef: 'TXN-PYR-00801',
      processedAt: daysAgo(8),
      deliveryConfirmed: true,
      deliveryConfirmedAt: daysAgo(7),
      recipientNotifiedAt: daysAgo(7),
      retryCount: 0,
    },
  });

  // Completed but delivery NOT confirmed
  const item008_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch008.id,
      batchNumber: 'PB-2024-008',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 5400,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'payoneer',
      transactionRef: 'TXN-PYR-00802',
      processedAt: daysAgo(8),
      deliveryConfirmed: false, // NOT confirmed
      recipientNotifiedAt: daysAgo(7),
      retryCount: 0,
    },
  });

  // UNCLAIMED item (Payoneer)
  const item008_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch008.id,
      batchNumber: 'PB-2024-008',
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: 5000,
      currency: 'USD',
      status: 'unclaimed',
      paymentMethod: 'payoneer',
      transactionRef: 'TXN-PYR-00803',
      processedAt: daysAgo(8),
      deliveryConfirmed: false,
      recipientNotifiedAt: daysAgo(7),
      retryCount: 2,
      lastRetryAt: daysAgo(5),
    },
  });

  // ─────────────────────────────────────────────
  // PB-2024-009: MISPLACED SETTLEMENTS — sent to WRONG recipients (not owner!)
  // This batch simulates the critical error: payouts sent to someone other
  // than YOUNES TSOULI OWNER. The auto-pilot's recover_misplaced phase
  // will detect and recover these.
  // ─────────────────────────────────────────────
  const batch009 = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-2024-009',
      totalAmount: 8500,
      currency: 'USD',
      status: 'completed',
      itemCount: 3,
      scheduledDate: daysAgo(12),
      processedDate: daysAgo(10),
      submittedAt: daysAgo(11),
      approvedBy: 'finance-team@company.com',
      notes: 'CRITICAL: Settlement sent to wrong recipients — needs recovery',
      paymentProvider: 'paypal',
      providerBatchRef: 'PP-BATCH-MISPLACED-001',
      autoApproved: true,
      autoApprovedAt: daysAgo(12),
      autoProcessed: true,
      autoProcessedAt: daysAgo(11),
    },
  });

  // 3 items sent to WRONG people (not the owner)
  const item009_1 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch009.id,
      batchNumber: 'PB-2024-009',
      recipientName: 'John Smith',           // WRONG — not owner
      recipientEmail: 'john.smith@wrong.com', // WRONG — not owner
      amount: 3200,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-MIS-001',
      processedAt: daysAgo(10),
      deliveryConfirmed: true,  // Payment was delivered — to the WRONG person
      deliveryConfirmedAt: daysAgo(9),
      recipientNotifiedAt: daysAgo(9),
      retryCount: 0,
    },
  });

  const item009_2 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch009.id,
      batchNumber: 'PB-2024-009',
      recipientName: 'Maria Garcia',          // WRONG — not owner
      recipientEmail: 'maria.g@wrong.com',   // WRONG — not owner
      amount: 2800,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'paypal',
      transactionRef: 'TXN-PP-MIS-002',
      processedAt: daysAgo(10),
      deliveryConfirmed: true,  // Delivered to WRONG person
      deliveryConfirmedAt: daysAgo(9),
      recipientNotifiedAt: daysAgo(9),
      retryCount: 0,
    },
  });

  const item009_3 = await db.payoutItem.create({
    data: {
      payoutBatchId: batch009.id,
      batchNumber: 'PB-2024-009',
      recipientName: 'Alex Johnson',          // WRONG — not owner
      recipientEmail: 'alex.j@wrong.com',    // WRONG — not owner
      amount: 2500,
      currency: 'USD',
      status: 'completed',
      paymentMethod: 'bank_transfer',
      transactionRef: 'TXN-BK-MIS-003',
      processedAt: daysAgo(10),
      deliveryConfirmed: true,  // Delivered to WRONG person
      deliveryConfirmedAt: daysAgo(9),
      recipientNotifiedAt: daysAgo(9),
      retryCount: 0,
    },
  });

  console.log(`✅ Created 27 payout items (including 3 misplaced).`);

  // ─────────────────────────────────────────────
  // 3B. PB-CRYPTO-001: CRYPTO SETTLEMENTS — ROUTED TO OWNER
  // 40 transactions across 6 L2 networks routed to pre-configured owner wallets.
  // Owner identity and wallet addresses established from day 1.
  // Anti-identity-theft measures have always been in place.
  // ─────────────────────────────────────────────
  console.log('⛓️  Creating crypto settlement batch (routed to owner)...');

  // Approximate USD prices: ETH=$3500, WBTC=$65000, USDC=$1
  const ETH_USD = 3500;
  const WBTC_USD = 65000;

  const cryptoBatch = await db.payoutBatch.create({
    data: {
      batchNumber: 'PB-CRYPTO-001',
      totalAmount: 674051.53,
      currency: 'USD',
      status: 'completed',
      itemCount: 40,
      scheduledDate: daysAgo(5),
      processedDate: daysAgo(3),
      submittedAt: daysAgo(4),
      approvedBy: 'crypto-ops@company.com',
      notes: `Crypto settlements batch for owner ${ownerNameShort}. All 40 transactions routed to pre-configured owner wallets across 6 L2 networks. Owner identity and wallet addresses verified from day 1.`,
      paymentProvider: 'crypto',
      providerBatchRef: 'CRYPTO-BATCH-OWNER-001',
      autoApproved: true,
      autoApprovedAt: daysAgo(5),
      autoProcessed: true,
      autoProcessedAt: daysAgo(4),
    },
  });

  // Helper: build a crypto item seed record
  type CryptoTx = {
    network: string;
    type: string;
    value: number;
    token: string;
    status: 'confirmed' | 'pending' | 'failed';
    gas: number;
    time: string;
  };

  const toUsd = (value: number, token: string): number => {
    if (token === 'ETH') return Math.round(value * ETH_USD * 100) / 100;
    if (token === 'WBTC') return Math.round(value * WBTC_USD * 100) / 100;
    return Math.round(value * 100) / 100; // USDC
  };

  const toStatus = (s: 'confirmed' | 'pending' | 'failed'): string => {
    if (s === 'confirmed') return 'completed';
    if (s === 'pending') return 'processing';
    return 'failed';
  };

  const allCryptoTxs: CryptoTx[] = [
    // ── Block 1 ──
    { network: 'arbitrum', type: 'transfer', value: 0.6074, token: 'USDC', status: 'confirmed', gas: 0.00033896, time: '19:34' },
    { network: 'optimism', type: 'swap', value: 0.6751, token: 'ETH', status: 'confirmed', gas: 0.00093307, time: '01:34' },
    { network: 'base', type: 'bridge_deposit', value: 1.9921, token: 'WBTC', status: 'confirmed', gas: 0.00018895, time: '11:34' },
    { network: 'polygon_zkevm', type: 'bridge_withdraw', value: 1.1451, token: 'ETH', status: 'confirmed', gas: 0.00074754, time: '09:34' },
    { network: 'linea', type: 'contract_call', value: 0.7427, token: 'USDC', status: 'pending', gas: 0.00030545, time: '—' },
    { network: 'scroll', type: 'approve', value: 1.3293, token: 'ETH', status: 'failed', gas: 0.00044354, time: '17:34' },
    // ── Block 2 ──
    { network: 'arbitrum', type: 'transfer', value: 0.0046, token: 'WBTC', status: 'confirmed', gas: 0.00056761, time: '19:34' },
    { network: 'optimism', type: 'swap', value: 0.4356, token: 'ETH', status: 'confirmed', gas: 0.00034246, time: '13:34' },
    { network: 'base', type: 'bridge_deposit', value: 0.1483, token: 'USDC', status: 'confirmed', gas: 0.00022027, time: '08:34' },
    { network: 'polygon_zkevm', type: 'bridge_withdraw', value: 0.7869, token: 'ETH', status: 'confirmed', gas: 0.00017575, time: '20:34' },
    { network: 'linea', type: 'contract_call', value: 0.7510, token: 'WBTC', status: 'pending', gas: 0.00032985, time: '—' },
    { network: 'scroll', type: 'approve', value: 0.4863, token: 'ETH', status: 'failed', gas: 0.00015037, time: '08:34' },
    // ── Block 3 ──
    { network: 'arbitrum', type: 'transfer', value: 0.3688, token: 'USDC', status: 'confirmed', gas: 0.00079729, time: '20:34' },
    { network: 'optimism', type: 'swap', value: 1.3896, token: 'ETH', status: 'confirmed', gas: 0.00081777, time: '12:34' },
    { network: 'base', type: 'bridge_deposit', value: 1.9289, token: 'WBTC', status: 'confirmed', gas: 0.00064509, time: '01:34' },
    { network: 'polygon_zkevm', type: 'bridge_withdraw', value: 0.5226, token: 'ETH', status: 'confirmed', gas: 0.00038638, time: '07:34' },
    { network: 'linea', type: 'contract_call', value: 0.4259, token: 'USDC', status: 'pending', gas: 0.00046880, time: '—' },
    { network: 'scroll', type: 'approve', value: 1.6938, token: 'ETH', status: 'failed', gas: 0.00025202, time: '01:34' },
    // ── Block 4 ──
    { network: 'arbitrum', type: 'transfer', value: 1.0543, token: 'WBTC', status: 'confirmed', gas: 0.00088997, time: '02:34' },
    { network: 'optimism', type: 'swap', value: 0.1320, token: 'ETH', status: 'confirmed', gas: 0.00077702, time: '15:34' },
    { network: 'base', type: 'bridge_deposit', value: 0.6279, token: 'USDC', status: 'confirmed', gas: 0.00074390, time: '00:34' },
    { network: 'polygon_zkevm', type: 'bridge_withdraw', value: 0.5835, token: 'ETH', status: 'confirmed', gas: 0.00007897, time: '13:34' },
    { network: 'linea', type: 'contract_call', value: 0.9600, token: 'WBTC', status: 'pending', gas: 0.00024185, time: '—' },
    { network: 'scroll', type: 'approve', value: 1.4393, token: 'ETH', status: 'failed', gas: 0.00070986, time: '15:34' },
    // ── Block 5 ──
    { network: 'arbitrum', type: 'transfer', value: 0.3790, token: 'USDC', status: 'confirmed', gas: 0.00062369, time: '16:34' },
    { network: 'optimism', type: 'swap', value: 1.0719, token: 'ETH', status: 'confirmed', gas: 0.00074462, time: '17:34' },
    { network: 'base', type: 'bridge_deposit', value: 0.0487, token: 'WBTC', status: 'confirmed', gas: 0.00014186, time: '14:34' },
    { network: 'polygon_zkevm', type: 'bridge_withdraw', value: 1.4044, token: 'ETH', status: 'confirmed', gas: 0.00081189, time: '05:34' },
    { network: 'linea', type: 'contract_call', value: 1.7260, token: 'USDC', status: 'pending', gas: 0.00030338, time: '—' },
    { network: 'scroll', type: 'approve', value: 1.1708, token: 'ETH', status: 'failed', gas: 0.00055645, time: '15:34' },
    // ── Block 6 ──
    { network: 'arbitrum', type: 'transfer', value: 0.6524, token: 'WBTC', status: 'confirmed', gas: 0.00048519, time: '21:34' },
    { network: 'optimism', type: 'swap', value: 0.0736, token: 'ETH', status: 'confirmed', gas: 0.00094498, time: '02:34' },
    { network: 'base', type: 'bridge_deposit', value: 1.1190, token: 'USDC', status: 'confirmed', gas: 0.00019796, time: '22:34' },
    { network: 'polygon_zkevm', type: 'bridge_withdraw', value: 0.2515, token: 'ETH', status: 'confirmed', gas: 0.00028752, time: '07:34' },
    { network: 'linea', type: 'contract_call', value: 1.2716, token: 'WBTC', status: 'pending', gas: 0.00038320, time: '—' },
    { network: 'scroll', type: 'approve', value: 0.7823, token: 'ETH', status: 'failed', gas: 0.00076569, time: '03:34' },
    // ── Block 7 (partial — no Linea/Scroll) ──
    { network: 'arbitrum', type: 'transfer', value: 1.4694, token: 'USDC', status: 'confirmed', gas: 0.00064098, time: '04:34' },
    { network: 'optimism', type: 'swap', value: 0.6078, token: 'ETH', status: 'confirmed', gas: 0.00018403, time: '20:34' },
    { network: 'base', type: 'bridge_deposit', value: 0.7797, token: 'WBTC', status: 'confirmed', gas: 0.00074088, time: '22:34' },
    { network: 'polygon_zkevm', type: 'bridge_withdraw', value: 1.6155, token: 'ETH', status: 'confirmed', gas: 0.00007782, time: '02:34' },
  ];

  // Create all 40 crypto payout items (routed to owner wallets)
  await db.payoutItem.createMany({
    data: allCryptoTxs.map((tx, idx) => ({
      payoutBatchId: cryptoBatch.id,
      batchNumber: cryptoBatch.batchNumber,
      recipientName: ownerName,
      recipientEmail: 'younes.tsouli@base44.com',
      amount: toUsd(tx.value, tx.token),
      currency: 'USD',
      status: toStatus(tx.status),
      paymentMethod: `crypto_${tx.network}`,
      transactionRef: `TXN-${tx.network.toUpperCase().replace(/_/g, '-')}-OWN-${String(idx + 1).padStart(3, '0')}`,
      processedAt: tx.status === 'confirmed' ? daysAgo(3) : null,
      deliveryConfirmed: tx.status === 'confirmed',
      deliveryConfirmedAt: tx.status === 'confirmed' ? daysAgo(2) : null,
      recipientNotifiedAt: tx.status === 'confirmed' ? daysAgo(2) : null,
      failureReason: tx.status === 'failed' ? `CRYPTO_${tx.network.toUpperCase()}_REVERTED: tx reverted on ${tx.network}` : null,
      retryCount: 0,
    })),
  });

  console.log(`✅ Created 40 crypto payout items routed to owner across 6 networks.`);

  // ─────────────────────────────────────────────
  // 3C. CRYPTO SETTLEMENT RECORDS (on-chain view)
  // ─────────────────────────────────────────────
  console.log('⛓️  Creating crypto settlement records...');

  const ownerWalletMap: Record<string, string> = {
    arbitrum: process.env.OWNER_WALLET_ARBITRUM || '0xYouNesTsoLiArbitrumOwnerWallet0000000001',
    optimism: process.env.OWNER_WALLET_OPTIMISM || '0xYouNesTsoLiOptimismOwnerWallet000000002',
    base: process.env.OWNER_WALLET_BASE || '0xYouNesTsoLiBaseOwnerWallet0000000000003',
    polygon_zkevm: process.env.OWNER_WALLET_POLYGON_ZKEVM || '0xYouNesTsoLiPolygonZKEVMOwnerWallet004',
    linea: process.env.OWNER_WALLET_LINEA || '0xYouNesTsoLiLineaOwnerWallet0000000000005',
    scroll: process.env.OWNER_WALLET_SCROLL || '0xYouNesTsoLiScrollOwnerWallet0000000000006',
  };

  await db.cryptoSettlement.createMany({
    data: allCryptoTxs.map((tx, idx) => {
      // Parse the time string to create a proper datetime
      const [hhRaw, mmRaw] = tx.time === '—' ? ['12', '00'] : tx.time.split(':').map(Number);
      const hh = Number(hhRaw);
      const mm = Number(mmRaw);
      const txDate = new Date();
      txDate.setDate(txDate.getDate() - 3);
      txDate.setHours(hh, mm, 0, 0);
      const ownerWallet = ownerWalletMap[tx.network] || null;

      return {
        txHash: `TRK-${tx.network}-${String(idx + 1).padStart(3, '0')}-${tx.type}-${tx.token.toLowerCase()}`,
        type: tx.type,
        network: tx.network,
        token: tx.token,
        amount: tx.value,
        gasUsed: tx.gas,
        status: tx.status,
        recipientAddress: ownerWallet,
        ownerWallet: ownerWallet,
        isOwner: true,
        misplaced: false,
        recovered: false,
        txTime: txDate,
      };
    }),
  });
  console.log(`✅ Created 40 crypto settlement records (all routed to owner).`);

  // ─────────────────────────────────────────────
  // 4. REVENUE EVENTS (15 total)
  // ─────────────────────────────────────────────
  console.log('💰 Creating revenue events...');

  // 3 pending (not yet confirmed)
  await db.revenueEvent.createMany({
    data: [
      {
        source: 'stripe',
        amount: 3200,
        currency: 'USD',
        status: 'pending',
        description: 'Stripe payment — SaaS subscription renewal',
        referenceId: 'STR-REV-90101',
      },
      {
        source: 'paypal',
        amount: 1850,
        currency: 'USD',
        status: 'pending',
        description: 'PayPal payment — freelance project milestone',
        referenceId: 'PP-REV-90102',
      },
      {
        source: 'wire_transfer',
        amount: 6200,
        currency: 'USD',
        status: 'pending',
        description: 'Wire transfer — enterprise contract payment',
        referenceId: 'WIRE-REV-90103',
      },
    ],
  });

  // 5 confirmed but NOT assigned to any batch (payoutBatchId = null)
  await db.revenueEvent.createMany({
    data: [
      {
        source: 'stripe',
        amount: 4800,
        currency: 'USD',
        status: 'confirmed',
        description: 'Stripe payment — annual plan upgrade',
        referenceId: 'STR-REV-90201',
      },
      {
        source: 'paypal',
        amount: 2100,
        currency: 'USD',
        status: 'confirmed',
        description: 'PayPal payment — consulting engagement',
        referenceId: 'PP-REV-90202',
      },
      {
        source: 'stripe',
        amount: 3950,
        currency: 'USD',
        status: 'confirmed',
        description: 'Stripe payment — team license purchase',
        referenceId: 'STR-REV-90203',
      },
      {
        source: 'wire_transfer',
        amount: 7500,
        currency: 'USD',
        status: 'confirmed',
        description: 'Wire transfer — partner revenue share',
        referenceId: 'WIRE-REV-90204',
      },
      {
        source: 'paypal',
        amount: 1400,
        currency: 'USD',
        status: 'confirmed',
        description: 'PayPal payment — support package',
        referenceId: 'PP-REV-90205',
      },
    ],
  });

  // 4 confirmed and batched (assigned to a batch)
  await db.revenueEvent.createMany({
    data: [
      {
        source: 'stripe',
        amount: 4800,
        currency: 'USD',
        status: 'confirmed',
        description: 'Stripe payment — enterprise onboarding',
        referenceId: 'STR-REV-90301',
        batchedAt: daysAgo(28),
        payoutBatchId: batch001.id,
      },
      {
        source: 'paypal',
        amount: 5200,
        currency: 'USD',
        status: 'confirmed',
        description: 'PayPal payment — pro tier subscription',
        referenceId: 'PP-REV-90302',
        batchedAt: daysAgo(28),
        payoutBatchId: batch001.id,
      },
      {
        source: 'stripe',
        amount: 4200,
        currency: 'USD',
        status: 'confirmed',
        description: 'Stripe payment — API access package',
        referenceId: 'STR-REV-90303',
        batchedAt: daysAgo(28),
        payoutBatchId: batch001.id,
      },
      {
        source: 'wire_transfer',
        amount: 3800,
        currency: 'USD',
        status: 'confirmed',
        description: 'Wire transfer — volume discount payment',
        referenceId: 'WIRE-REV-90304',
        batchedAt: daysAgo(20),
        payoutBatchId: batch002.id,
      },
    ],
  });

  // 3 reconciled (fully processed)
  await db.revenueEvent.createMany({
    data: [
      {
        source: 'stripe',
        amount: 2200,
        currency: 'USD',
        status: 'reconciled',
        description: 'Stripe payment — legacy migration support',
        referenceId: 'STR-REV-90401',
        batchedAt: daysAgo(30),
        payoutBatchId: batch001.id,
      },
      {
        source: 'paypal',
        amount: 3100,
        currency: 'USD',
        status: 'reconciled',
        description: 'PayPal payment — training session bundle',
        referenceId: 'PP-REV-90402',
        batchedAt: daysAgo(30),
        payoutBatchId: batch001.id,
      },
      {
        source: 'wire_transfer',
        amount: 5500,
        currency: 'USD',
        status: 'reconciled',
        description: 'Wire transfer — Q4 settlement',
        referenceId: 'WIRE-REV-90403',
        batchedAt: daysAgo(30),
        payoutBatchId: batch001.id,
      },
    ],
  });

  console.log(`✅ Created 15 revenue events.`);

  // ─────────────────────────────────────────────
  // 5. TRANSACTION LOGS (10 entries)
  // ─────────────────────────────────────────────
  console.log('📊 Creating transaction logs...');

  // 3 completed withdrawals matching PB-001 and PB-002 items
  await db.transactionLog.createMany({
    data: [
      {
        category: 'withdrawal',
        status: 'completed',
        amount: 4800,
        currency: 'USD',
        transactionDate: daysAgo(25),
        referenceId: 'TXNLOG-00101',
        description: `Payout to ${ownerName} via PayPal`,
        payoutBatchId: batch001.id,
        payoutItemId: item001_1.id,
        provider: 'paypal',
        providerTxId: 'PP-TX-00101',
      },
      {
        category: 'withdrawal',
        status: 'completed',
        amount: 5200,
        currency: 'USD',
        transactionDate: daysAgo(25),
        referenceId: 'TXNLOG-00102',
        description: `Payout to ${ownerName} via PayPal`,
        payoutBatchId: batch001.id,
        payoutItemId: item001_2.id,
        provider: 'paypal',
        providerTxId: 'PP-TX-00102',
      },
      {
        category: 'withdrawal',
        status: 'completed',
        amount: 3800,
        currency: 'USD',
        transactionDate: daysAgo(17),
        referenceId: 'TXNLOG-00201',
        description: `Payout to ${ownerName} via bank transfer`,
        payoutBatchId: batch002.id,
        payoutItemId: item002_1.id,
        provider: 'bank_transfer',
        providerTxId: 'BANK-TX-00201',
      },
    ],
  });

  // 1 pending withdrawal for PB-003 (shows PayPal submission)
  await db.transactionLog.create({
    data: {
      category: 'withdrawal',
      status: 'pending',
      amount: 4500,
      currency: 'USD',
      transactionDate: daysAgo(3),
      referenceId: 'TXNLOG-00301',
      description: `PayPal batch submission for ${ownerName} — awaiting provider confirmation`,
      payoutBatchId: batch003.id,
      payoutItemId: item003_1.id,
      provider: 'paypal',
      providerTxId: 'PP-TX-00301',
    },
  });

  // 1 failed withdrawal for PB-006 failed item
  await db.transactionLog.create({
    data: {
      category: 'withdrawal',
      status: 'failed',
      amount: 3500,
      currency: 'USD',
      transactionDate: daysAgo(5),
      referenceId: 'TXNLOG-00601',
      description: `Bank transfer to ${ownerName} — declined by bank`,
      payoutBatchId: batch006.id,
      payoutItemId: item006_1.id,
      provider: 'bank_transfer',
      providerTxId: 'BANK-TX-00601',
      errorCode: 'PAYMENT_DECLINED',
      errorMessage: 'Insufficient funds in source account',
    },
  });

  // 2 deposit entries for revenue
  await db.transactionLog.createMany({
    data: [
      {
        category: 'deposit',
        status: 'completed',
        amount: 7500,
        currency: 'USD',
        transactionDate: daysAgo(6),
        referenceId: 'DEP-00101',
        description: 'Wire transfer deposit — partner revenue share',
        provider: 'wire_transfer',
        providerTxId: 'WIRE-DEP-00101',
      },
      {
        category: 'deposit',
        status: 'completed',
        amount: 3200,
        currency: 'USD',
        transactionDate: daysAgo(1),
        referenceId: 'DEP-00102',
        description: 'Stripe deposit — SaaS subscription renewal',
        provider: 'stripe',
        providerTxId: 'STR-DEP-00102',
      },
    ],
  });

  // 1 completed fee entry
  await db.transactionLog.create({
    data: {
      category: 'fee',
      status: 'completed',
      amount: 245,
      currency: 'USD',
      transactionDate: daysAgo(10),
      referenceId: 'FEE-00101',
      description: 'PayPal processing fee — PB-2024-008 batch',
      provider: 'paypal',
      providerTxId: 'PP-FEE-00101',
    },
  });

  // 1 reversed withdrawal (shows a previous PayPal issue)
  await db.transactionLog.create({
    data: {
      category: 'withdrawal',
      status: 'reversed',
      amount: 2800,
      currency: 'USD',
      transactionDate: daysAgo(15),
      referenceId: 'TXNLOG-REVERSAL-01',
      description: 'PayPal withdrawal reversed — recipient account locked',
      payoutBatchId: batch001.id,
      provider: 'paypal',
      providerTxId: 'PP-TX-REV-00101',
      errorCode: 'ACCOUNT_LOCKED',
      errorMessage: 'Recipient PayPal account was locked during processing',
    },
  });

  // 1 pending withdrawal that has NO matching payout item (orphan transaction)
  await db.transactionLog.create({
    data: {
      category: 'withdrawal',
      status: 'pending',
      amount: 2200,
      currency: 'USD',
      transactionDate: daysAgo(12),
      referenceId: 'TXNLOG-ORPHAN-01',
      description: 'Standalone withdrawal — no associated payout batch or item',
      payoutBatchId: null,
      payoutItemId: null,
      provider: 'paypal',
      providerTxId: 'PP-TX-ORPHAN-00101',
    },
  });

  console.log(`✅ Created 10 transaction logs.`);

  // ─────────────────────────────────────────────
  // 6. AUTOPILOT RUNS (2 entries from previous runs)
  // ─────────────────────────────────────────────
  console.log('🤖 Creating autopilot runs...');

  await db.autoPilotRun.createMany({
    data: [
      {
        trigger: 'manual',
        phase: 'full_pipeline',
        status: 'completed',
        itemsAffected: 18,
        amountAffected: 47756.6,
        details: 'Full pipeline run: confirmed 3 pending revenues, approved 2 batches, processed 18 items, confirmed 15 deliveries, sent 15 notifications.',
        durationMs: 114,
      },
      {
        trigger: 'manual',
        phase: 'full_pipeline',
        status: 'completed',
        itemsAffected: 12,
        amountAffected: 31200,
        details: 'Follow-up pipeline run after PB-2024-006 failure retry. Resolved 1 failed item, advanced 2 stuck items.',
        durationMs: 87,
      },
    ],
  });

  console.log(`✅ Created 2 autopilot runs.`);

  // ─────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('🎉 SEED COMPLETE — Diagnostic scenarios ready');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('  Revenue Events:     15');
  console.log('    • 3 pending (unconfirmed)');
  console.log('    • 5 confirmed (unbatched — stuck revenue)');
  console.log('    • 4 confirmed (batched)');
  console.log('    • 3 reconciled');
  console.log('');
  console.log('  Payout Batches:      9');
  console.log('    • PB-2024-001: completed (clean)');
  console.log('    • PB-2024-002: completed (1 delivery unconfirmed)');
  console.log('    • PB-2024-003: submitted_to_paypal (STUCK 3 days!)');
  console.log('    • PB-2024-004: pending_approval (needs auto-approve)');
  console.log('    • PB-2024-005: processing (1 stale processing)');
  console.log('    • PB-2024-006: failed (bank insufficient_funds, no resolution)');
  console.log('    • PB-2024-007: approved (all items pending — bottleneck)');
  console.log('    • PB-2024-008: completed (unclaimed payoneer item)');
  console.log('    • PB-2024-009: completed (3 misplaced — wrong recipients)');
  console.log('    • PB-CRYPTO-001: completed (40 crypto txs — all routed to owner)');
  console.log('');
  console.log('  Payout Items:        67 (27 fiat + 40 crypto)');
  console.log('  Crypto Settlements:  40 (all routed to owner wallets)');
  console.log('  Transaction Logs:    10 (incl. 1 orphan withdrawal)');
  console.log('  AutoPilot Runs:      2');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
