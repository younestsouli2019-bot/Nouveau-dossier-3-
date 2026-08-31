import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getOwnerEmail, getOwnerDisplayName, getOwnerNameUpper, tryGetOwnerEmail, tryGetOwnerNameUpper } from '@/lib/owner-config';
import { requireOpsAuth } from '@/lib/api-auth';
import { isSyntheticOracleHash } from '@/lib/procurement/payment-gateway-router';

// ─── AUTO-PILOT ENGINE (HONEST-INTENT) ─────────────────────────────────────
// Hands-free pipeline support: report → queue → build intent → notify humans.
// Modeled after Khwarizmian Swarm's fix_all.py + monitor.py --watch
//
// DEFANGED 2026-08-30 (fabrication-vector closure). The previous phases minted
// synthetic provider refs (`PB-…-AP-…`, `UC-…`, `PP-…`), force-completed
// items/batches, auto-confirmed revenue and deliveries, and stamped
// notification/delivery timestamps for messages that were never sent — the
// exact GooglePay-refund phantom-completed class the truth guards now reject
// (they 500'd the whole run at the first write). New contract for EVERY phase:
//   (a) INTENT-BUILDING only (pending_approval batches, pending items) — a
//       human still executes at the provider (Lessons Learned #4);
//   (b) REPORT-ONLY for anything that would assert an external-world fact
//       (delivery, provider execution, notification, recovery);
//   (c) HONEST HYGIENE that asserts nothing unverifiable.
// Nothing here may write status=completed/settled without a real external ref.

const PHASES = [
  'confirm_pending_revenue',
  'auto_approve_batches',
  'advance_approved_batches',
  'advance_processing_batches',
  'retry_failed_items',
  'retry_failed_batches',
  'confirm_deliveries',
  'fix_timestamps',
  'notify_recipients',
  'batch_unassigned_revenue',
  'advance_paypal_batches',
  'retry_unclaimed_items',
  'recover_misplaced_settlements',
  'recover_crypto_misplaced',
  'reconcile_transactions',
  'resolve_orphan_transactions',
  'carrier_resolve',
  'crbt_reconcile',
  'procurement_quarantine',
] as const;

type Phase = (typeof PHASES)[number];

async function audit(entityType: string, entityId: string, action: string, oldValue: string | null, newValue: string, reason: string, payoutBatchId?: string, payoutItemId?: string) {
  await db.payoutAuditLog.create({
    data: { entityType, entityId, action, oldValue, newValue, reason, performedBy: 'auto-pilot', payoutBatchId, payoutItemId },
  });
}

async function logRun(phase: Phase, status: string, itemsAffected: number, amountAffected: number, details: string, durationMs: number) {
  await db.autoPilotRun.create({
    data: { trigger: 'api', phase, status, itemsAffected, amountAffected, details, durationMs },
  });
}

/** A provider reference is REAL only if it exists and is not locally-minted. */
function isRealProviderRef(ref: string | null | undefined): boolean {
  if (!ref || !ref.trim()) return false;
  return !isSyntheticOracleHash(ref) && !/^(PB-|UC-|PP-\d+|TXRECON-|RECOVER(Y|ED)?-|REV-|CRYPTO-RECOVERY-)/i.test(ref.trim());
}

/**
 * Anti-fabrication completion (2026-08-30 defang). An item is marked
 * completed ONLY when a REAL provider reference is already on the row
 * (gateway webhook / MT103 / onchain hash — never locally-minted). Otherwise
 * it is parked in `needs_manual_proof` so the review queue can attach real
 * proof or reject it. deliveryConfirmed is never invented here.
 */
async function completeWithRealProof(item: {
  id: string; status: string; externalRef: string | null; transactionRef: string | null; proofHash: string | null;
  amount: number; payoutBatchId: string | null; recipientName: string; batchNumber: string; failureReason: string | null; retryCount: number;
}, reason: string, auditAction: string): Promise<boolean> {
  const realRef = isRealProviderRef(item.externalRef) || isRealProviderRef(item.transactionRef);
  if (!realRef) {
    await db.payoutItem.update({
      where: { id: item.id },
      data: {
        status: 'needs_manual_proof',
        failureReason: `AUTO-PILOT DEFANG: ${reason} — no REAL provider externalRef/transactionRef on row. Attach a real provider receipt (MT103 UETR, PayPal txn, onchain hash) or reject.`,
        deliveryConfirmed: false,
        deliveryConfirmedAt: null,
      },
    });
    await audit('PayoutItem', item.id, auditAction + '_HELD', `status=${item.status}`, 'status=needs_manual_proof',
      `Auto-Pilot defang: ${reason} — held for real proof (${item.recipientName}, ${item.amount.toFixed(2)})`, item.payoutBatchId ?? undefined, item.id);
    return false;
  }
  await db.payoutItem.update({
    where: { id: item.id },
    data: {
      status: 'completed',
      processedAt: new Date(),
      proofHash: item.proofHash || null,
      failureReason: null,
      ...(item.retryCount > 0 ? { lastRetryAt: new Date(), retryCount: item.retryCount + 1 } : {}),
    },
  });
  await audit('PayoutItem', item.id, auditAction, `status=${item.status}`, 'status=completed',
    `Auto-Pilot: ${reason} — item completed with real provider ref. deliveryConfirmed left for operator/evidence`, item.payoutBatchId ?? undefined, item.id);
  return true;
}

// ── Phase 1: Confirm pending revenue — REPORT-ONLY ──────────────────────
// Revenue confirmation required external proof; the old bulk auto-confirm was
// the fabrication seed for everything downstream. Surface what's pending and
// whether each event carries proof, for HUMAN confirmation.
async function confirmPendingRevenue() {
  const start = Date.now();
  const events = await db.revenueEvent.findMany({
    where: { status: 'pending' },
    select: { id: true, amount: true, proofHash: true, proofType: true },
  });
  const withProof = events.filter((e) => e.proofHash && e.proofType).length;

  await logRun('confirm_pending_revenue', 'success', events.length,
    events.reduce((s, e) => s + e.amount, 0),
    `REPORT-ONLY: ${events.length} pending revenue events (${withProof} carry proof hashes; ${events.length - withProof} lack proof and CANNOT be confirmed). Human confirmation required — bulk auto-confirm removed (fabrication vector).`,
    Date.now() - start);
  return events.length;
}

// ── Phase 2: Approve batches — INTENT-ONLY, triple-gated ─────────────────
// Auto-approval is only legitimate for pre-set owner accounts with genuine
// external proof (Lessons Learned). Gates: explicit env opt-in + threshold + a
// real provider ref on EVERY item. Any miss → report for manual approval.
async function autoApproveBatches() {
  const start = Date.now();
  const allow = process.env.AUTOPILOT_ALLOW_BATCH_APPROVAL === 'true';
  const threshold = Number(process.env.AUTO_APPROVE_THRESHOLD_USD || '5000');
  const batches = await db.payoutBatch.findMany({
    where: { status: 'pending_approval' },
    include: { items: { select: { id: true, externalRef: true, transactionRef: true } } },
  });

  let approved = 0;
  if (allow) {
    for (const batch of batches) {
      const allProved = batch.items.length > 0 &&
        batch.items.every((i) => isRealProviderRef(i.externalRef) || isRealProviderRef(i.transactionRef));
      if (batch.totalAmount > threshold || !allProved) continue;
      await db.payoutBatch.update({
        where: { id: batch.id },
        data: { status: 'approved', approvedBy: 'Auto-Pilot', autoApproved: true, autoApprovedAt: new Date() },
      });
      await audit('PayoutBatch', batch.id, 'auto_approve', 'status=pending_approval', 'status=approved',
        `Auto-Pilot: approved within threshold $${threshold} with real provider refs on all ${batch.items.length} items`, batch.id);
      approved++;
    }
  }

  const blocked = batches.length - approved;
  await logRun('auto_approve_batches', 'success', approved, 0,
    `${approved} batches auto-approved${allow ? '' : ' (AUTOPILOT_ALLOW_BATCH_APPROVAL!=true — approvals disabled)'}; ${blocked} awaiting MANUAL approval${blocked ? ' (threshold/proof gates not met)' : ''}.`,
    Date.now() - start);
  return approved;
}

// ── Phase 3: Advance approved batches → processing → completed ───────────
// DEFANGED (2026-08-30): no synthetic AP- refs, no fabricated completed +
// deliveryConfirmed. Items advance only on REAL provider proof; otherwise held.
async function advanceApprovedBatches() {
  const start = Date.now();
  const batches = await db.payoutBatch.findMany({
    where: { status: 'approved' },
    include: { items: true },
  });

  let itemsFixed = 0;
  let amountFixed = 0;
  let held = 0;

  for (const batch of batches) {
    const prevStatus = batch.status;
    let batchAdvanced = true;
    for (const item of batch.items) {
      if (item.status === 'failed' || item.status === 'pending') {
        const ok = await completeWithRealProof(item, `retry/process in approved batch ${batch.batchNumber}`, 'auto_retry');
        if (ok) { itemsFixed++; amountFixed += item.amount; }
        else { held++; batchAdvanced = false; }
      }
    }

    // Mark the batch completed ONLY if every actionable item was honestly completed.
    if (batchAdvanced || batch.items.length === 0) {
      await db.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: 'completed', processedDate: new Date(), autoProcessed: true,
          autoProcessedAt: new Date(),
          resolutionNote: `Auto-Pilot: Approved → Completed. ${itemsFixed} items completed with real provider proof.${held ? ` ${held} held for real proof.` : ''}`,
          resolvedAt: new Date(),
        },
      });
      await audit('PayoutBatch', batch.id, 'auto_advance', `status=${prevStatus}`, 'status=completed',
        `Auto-Pilot: Batch advanced from approved to completed (${itemsFixed} items with real proof${held ? `, ${held} held` : ''})`, batch.id);
    } else {
      await audit('PayoutBatch', batch.id, 'auto_advance_HELD', `status=${prevStatus}`, 'status=approved',
        `Auto-Pilot defang: batch ${batch.batchNumber} NOT auto-completed — items lack real provider proof; left approved for human review.`, batch.id);
    }
  }

  await logRun('advance_approved_batches', 'success', itemsFixed, amountFixed,
    `Advanced approved batches: ${itemsFixed} items completed w/ real proof, ${held} held (no synthetic AP- refs minted)`, Date.now() - start);
  return itemsFixed;
}

// ── Phase 4: Advance processing batches (stale items) ────────────────────
// DEFANGED: no synthetic AP- refs; complete only on real provider proof.
async function advanceProcessingBatches() {
  const start = Date.now();
  const batches = await db.payoutBatch.findMany({
    where: { status: 'processing' },
    include: { items: true },
  });

  let itemsFixed = 0;
  let amountFixed = 0;
  let held = 0;

  for (const batch of batches) {
    const prevStatus = batch.status;
    for (const item of batch.items) {
      if (item.status === 'processing' || item.status === 'pending') {
        const ok = await completeWithRealProof(item, `stale item in ${batch.batchNumber}`, 'auto_complete_stale');
        if (ok) { itemsFixed++; amountFixed += item.amount; }
        else { held++; }
      }
    }

    // Recalculate batch status
    const remaining = await db.payoutItem.findMany({ where: { payoutBatchId: batch.id } });
    const allDone = held === 0 && remaining.every((i) => i.status === 'completed');
    const hasFailed = remaining.some((i) => i.status === 'failed');

    const newBatchStatus = hasFailed ? 'failed' : allDone ? 'completed' : 'processing';
    await db.payoutBatch.update({
      where: { id: batch.id },
      data: {
        status: newBatchStatus,
        ...(allDone ? { processedDate: new Date(), autoProcessed: true, autoProcessedAt: new Date(), resolvedAt: new Date() } : {}),
        resolutionNote: `Auto-Pilot: ${itemsFixed} stale items completed w/ real proof; ${held} held. Final batch status: ${newBatchStatus}`,
      },
    });
    await audit('PayoutBatch', batch.id, 'auto_recalculate', `status=${prevStatus}`, `status=${newBatchStatus}`,
      `Auto-Pilot: Batch recalc after processing items (${itemsFixed} completed, ${held} held)`, batch.id);
  }

  await logRun('advance_processing_batches', 'success', itemsFixed, amountFixed,
    `Advanced ${batches.length} processing batches: ${itemsFixed} completed w/ real proof, ${held} held`, Date.now() - start);
  return itemsFixed;
}

// ── Phase 5: Retry failed items ──────────────────────────────────────────
async function retryFailedItems() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({
    where: { status: 'failed' },
    include: { payoutBatch: true },
  });

  let total = 0;
  let amount = 0;
  let held = 0;

  for (const item of items) {
    const ok = await completeWithRealProof(item, `retry failed item (${item.failureReason})`, 'auto_retry_failed');
    if (ok) { total++; amount += item.amount; }
    else { held++; }
  }

  await logRun('retry_failed_items', 'success', total, amount,
    `Retried ${total} failed items w/ real proof; ${held} held for real provider proof`, Date.now() - start);
  return total;
}

// ── Phase 6: Retry failed batches ────────────────────────────────────────
// DEFANGED: no synthetic APBR- refs; only items with REAL provider proof complete.
async function retryFailedBatches() {
  const start = Date.now();
  const batches = await db.payoutBatch.findMany({ where: { status: 'failed' } });
  let total = 0;
  let held = 0;

  for (const batch of batches) {
    // Process ALL non-completed items in the failed batch (failed + pending)
    const items = await db.payoutItem.findMany({
      where: { payoutBatchId: batch.id, status: { in: ['failed', 'pending', 'processing'] } },
    });
    let amount = 0;
    for (const item of items) {
      const ok = await completeWithRealProof(item, `retry failed batch ${batch.batchNumber}`, 'auto_retry_batch');
      if (ok) { amount += item.amount; total++; }
      else { held++; }
    }
    // Batch completes ONLY if all actionable items completed with real proof.
    const remaining = await db.payoutItem.findMany({ where: { payoutBatchId: batch.id } });
    const allDone = held === 0 && remaining.every((i) => i.status === 'completed');
    if (allDone) {
      await db.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: 'completed', processedDate: new Date(), autoProcessed: true,
          autoProcessedAt: new Date(),
          resolutionNote: `Auto-Pilot: Failed batch recovered w/ real proof. ${items.length} items processed.`,
          resolvedAt: new Date(),
        },
      });
      await audit('PayoutBatch', batch.id, 'auto_retry_batch', 'status=failed', 'status=completed',
        `Auto-Pilot: Failed batch recovered — ${items.length} items processed w/ real proof`, batch.id);
    } else {
      await audit('PayoutBatch', batch.id, 'auto_retry_batch_HELD', 'status=failed', 'status=failed',
        `Auto-Pilot defang: batch ${batch.batchNumber} NOT auto-recovered — ${held} item(s) lack real provider proof; left for human review.`, batch.id);
    }
  }

  await logRun('retry_failed_batches', 'success', total,
    batches.reduce((s, b) => s + b.totalAmount, 0),
    `Retried ${batches.length} failed batches: ${total} items completed w/ real proof; ${held} held`, Date.now() - start);
  return total;
}

// ── Phase 7: Confirm deliveries ──────────────────────────────────────────
// DEFANGED: delivery confirmation requires REAL evidence (actualDelivery /
// POD / signature). Auto-toggling deliveryConfirmed=true on completed items
// that never had a physical delivery is a fabrication vector — removed.
async function confirmDeliveries() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({
    where: { status: 'completed', deliveryConfirmed: { not: true } },
    select: { id: true, amount: true, payoutBatchId: true, transactionRef: true, externalRef: true },
  });
  let total = 0;

  for (const item of items) {
    await audit('PayoutItem', item.id, 'confirm_delivery_HELD', 'deliveryConfirmed=false', 'deliveryConfirmed=false',
      'Auto-Pilot defang: delivery auto-confirm removed. deliveryConfirmed=true requires REAL POD/signature/actualDelivery evidence attached by operator.', item.payoutBatchId ?? undefined, item.id);
    total++;
  }

  await logRun('confirm_deliveries', 'success', 0,
    items.reduce((s, i) => s + i.amount, 0),
    `DEFANGED: ${total} deliveries NOT auto-confirmed (require REAL evidence)`, Date.now() - start);
  return 0;
}

// ── Phase 8: Fix timestamps — REPORT-ONLY ────────────────────────────────
// DEFANGED: processedAt cannot be backfilled from updatedAt — that fabricates
// a processing timestamp. processedAt must come from real provider evidence.
async function fixTimestamps() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({ where: { status: 'completed', processedAt: null } });

  for (const item of items) {
    await audit('PayoutItem', item.id, 'fix_timestamp_HELD', 'processedAt=null', 'processedAt=null',
      `Defang: processedAt must come from REAL provider evidence/ref, not a backfill guess — held for real proof (${item.recipientName}, ${item.amount.toFixed(2)})`, item.payoutBatchId ?? undefined, item.id);
  }

  await logRun('fix_timestamps', 'success', 0, 0,
    `DEFANGED: ${items.length} completed items with null processedAt are NOT backfilled — real processedAt required`, Date.now() - start);
  return 0;
}

// ── Phase 9: Notify recipients — REPORT-ONLY ─────────────────────────────
// DEFANGED: this phase cannot email/WhatsApp; stamping recipientNotifiedAt
// claimed a notification was SENT without sending anything. Wire a real
// messaging provider or mark manually.
async function notifyRecipients() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({ where: { status: 'completed', recipientNotifiedAt: null } });

  for (const item of items) {
    await audit('PayoutItem', item.id, 'notify_HELD', 'recipientNotifiedAt=null', 'recipientNotifiedAt=null',
      `Defang: notification NOT sent — this phase cannot email; wire a real email/WhatsApp provider or mark manually (${item.recipientName}, ${item.amount.toFixed(2)})`, item.payoutBatchId ?? undefined, item.id);
  }

  await logRun('notify_recipients', 'success', 0, 0,
    `DEFANGED: ${items.length} recipient notifications NOT sent — this phase cannot email; wire a real email/WhatsApp provider or mark manually`, Date.now() - start);
  return 0;
}

// ── Phase 10: Batch unassigned revenue ───────────────────────────────────
// Revenue Reconciliation: Find confirmed revenue events with no batch, assign them
// All revenue belongs to the OWNER — items are created with OWNER_NAME/OWNER_EMAIL
async function batchUnassignedRevenue() {
  const start = Date.now();
  const unbatchedEvents = await db.revenueEvent.findMany({
    where: { status: 'confirmed', payoutBatchId: null },
  });

  if (unbatchedEvents.length === 0) {
    await logRun('batch_unassigned_revenue', 'success', 0, 0, 'No unbatched revenue events found', Date.now() - start);
    return 0;
  }

  const OWNER_NAME = getOwnerDisplayName();
  const OWNER_EMAIL = getOwnerEmail();

  // Try to find an existing pending_approval batch to add to
  let targetBatch: { id: string; batchNumber: string; itemCount: number; totalAmount: number } | null =
    await db.payoutBatch.findFirst({
      where: { status: 'pending_approval' },
    });

  const totalAmount = unbatchedEvents.reduce((s, e) => s + e.amount, 0);

  if (targetBatch) {
    // Add to existing pending_approval batch
    const itemCount = targetBatch.itemCount + unbatchedEvents.length;
    const newTotal = targetBatch.totalAmount + totalAmount;

    for (const ev of unbatchedEvents) {
      await db.payoutItem.create({
        data: {
          payoutBatchId: targetBatch.id,
          batchNumber: targetBatch.batchNumber,
          recipientName: OWNER_NAME,
          recipientEmail: OWNER_EMAIL,
          amount: ev.amount,
          status: 'pending',
        },
      });
      await db.revenueEvent.update({
        where: { id: ev.id },
        data: { payoutBatchId: targetBatch.id, batchedAt: new Date() },
      });
      await audit('RevenueEvent', ev.id, 'auto_batch_assign', 'payoutBatchId=null',
        `payoutBatchId=${targetBatch.id}`, `Auto-Pilot: Revenue event added to existing batch ${targetBatch.batchNumber}`);
    }

    await db.payoutBatch.update({
      where: { id: targetBatch.id },
      data: { totalAmount: newTotal, itemCount },
    });
    await audit('PayoutBatch', targetBatch.id, 'auto_batch_add_items', `itemCount=${targetBatch.itemCount}`,
      `itemCount=${itemCount}`, `Auto-Pilot: Added ${unbatchedEvents.length} revenue items to batch`, targetBatch.id);

    await logRun('batch_unassigned_revenue', 'success', unbatchedEvents.length, totalAmount,
      `Added ${unbatchedEvents.length} revenue events to existing batch ${targetBatch.batchNumber}`, Date.now() - start);
  } else {
    // Create a new batch
    const now = new Date();
    const batchNum = `PB-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const batchCount = await db.payoutBatch.count();
    const batchNumber = `${batchNum}-${String(batchCount + 1).padStart(4, '0')}`;

    targetBatch = await db.payoutBatch.create({
      data: {
        batchNumber,
        totalAmount,
        status: 'pending_approval',
        itemCount: unbatchedEvents.length,
        notes: `Auto-Pilot: Created for ${unbatchedEvents.length} unbatched revenue events`,
      },
    });

    for (const ev of unbatchedEvents) {
      await db.payoutItem.create({
        data: {
          payoutBatchId: targetBatch.id,
          batchNumber: targetBatch.batchNumber,
          recipientName: OWNER_NAME,
          recipientEmail: OWNER_EMAIL,
          amount: ev.amount,
          status: 'pending',
        },
      });
      await db.revenueEvent.update({
        where: { id: ev.id },
        data: { payoutBatchId: targetBatch.id, batchedAt: new Date() },
      });
      await audit('RevenueEvent', ev.id, 'auto_batch_assign', 'payoutBatchId=null',
        `payoutBatchId=${targetBatch.id}`, `Auto-Pilot: Revenue event assigned to new batch ${batchNumber}`);
    }

    await audit('PayoutBatch', targetBatch.id, 'auto_batch_create', 'N/A',
      `batchNumber=${batchNumber},itemCount=${unbatchedEvents.length}`,
      `Auto-Pilot: New batch created for ${unbatchedEvents.length} unbatched revenue events`, targetBatch.id);

    await logRun('batch_unassigned_revenue', 'success', unbatchedEvents.length, totalAmount,
      `Created new batch ${batchNumber} with ${unbatchedEvents.length} revenue events`, Date.now() - start);
  }

  return unbatchedEvents.length;
}

// ── Phase 11: Advance PayPal batches — REAL-PROOF ONLY ───────────────────
// PayPal Bottleneck: stale submitted_to_paypal batches. DEFANGED: no synthetic
// PP- refs. Items complete ONLY via completeWithRealProof (real PayPal provider
// ref already on the row); batch completes only when every actionable item did.
async function advancePaypalBatches() {
  const start = Date.now();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const batches = await db.payoutBatch.findMany({
    where: {
      status: 'submitted_to_paypal',
      submittedAt: { lt: twoHoursAgo },
    },
    include: { items: true },
  });

  let itemsCompleted = 0;
  let amountCompleted = 0;
  let held = 0;

  for (const batch of batches) {
    const prevStatus = batch.status;
    let batchAdvanced = true;

    for (const item of batch.items) {
      if (item.status === 'processing' || item.status === 'pending') {
        const ok = await completeWithRealProof(item, `stale PayPal submission in ${batch.batchNumber}`, 'auto_paypal_complete');
        if (ok) { itemsCompleted++; amountCompleted += item.amount; }
        else { held++; batchAdvanced = false; }
      }
    }

    // Mark the batch completed ONLY if every actionable item completed with real proof.
    if (batchAdvanced || batch.items.length === 0) {
      await db.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: 'completed',
          processedDate: new Date(),
          autoProcessed: true,
          autoProcessedAt: new Date(),
          resolvedAt: new Date(),
          resolutionNote: `Auto-Pilot: PayPal batch advanced after 2h+ stale submission. ${itemsCompleted} items completed with real provider proof.${held ? ` ${held} held.` : ''}`,
        },
      });
      await audit('PayoutBatch', batch.id, 'auto_paypal_advance', `status=${prevStatus}`,
        'status=completed', `Auto-Pilot: PayPal batch completed after >2h stale (${itemsCompleted} items with real provider proof${held ? `, ${held} held` : ''})`, batch.id);
    } else {
      await audit('PayoutBatch', batch.id, 'auto_paypal_advance_HELD', `status=${prevStatus}`, 'status=submitted_to_paypal',
        `Auto-Pilot defang: batch ${batch.batchNumber} NOT auto-completed — items lack REAL PayPal provider refs; no synthetic PP- refs minted; left for human review.`, batch.id);
    }
  }

  await logRun('advance_paypal_batches', 'success', itemsCompleted, amountCompleted,
    `${batches.length} stale PayPal batches: ${itemsCompleted} items completed w/ real proof; ${held} held (no synthetic PP- refs minted)`, Date.now() - start);
  return itemsCompleted;
}

// ── Phase 12: Retry unclaimed items — REAL-PROOF ONLY ────────────────────
// Unclaimed Payout. DEFANGED: no synthetic UC- refs, no force-complete, no
// invented delivery/notification timestamps. Items complete ONLY via
// completeWithRealProof; a parent batch is completed only when NO item was held.
async function retryUnclaimedItems() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({
    where: { status: 'unclaimed' },
    include: { payoutBatch: true },
  });

  let total = 0;
  let amount = 0;
  let held = 0;
  const heldByBatch: Record<string, number> = {};

  for (const item of items) {
    const ok = await completeWithRealProof(item, 'unclaimed item retry', 'auto_retry_unclaimed');
    if (ok) { total++; amount += item.amount; }
    else {
      held++;
      if (item.payoutBatchId) heldByBatch[item.payoutBatchId] = (heldByBatch[item.payoutBatchId] || 0) + 1;
    }
  }

  // Recalculate parent batch statuses — complete a batch ONLY when no item in it was held.
  const affectedBatchIds = [...new Set(items.map(i => i.payoutBatchId))];
  for (const batchId of affectedBatchIds) {
    if (!batchId) continue;
    const batchHeld = heldByBatch[batchId] || 0;
    if (batchHeld > 0) {
      await audit('PayoutBatch', batchId, 'auto_retry_unclaimed_HELD', 'status=pending', 'status=pending',
        `Auto-Pilot defang: batch NOT auto-completed — ${batchHeld} unclaimed item(s) lack real provider proof; left for human review.`, batchId);
      continue;
    }
    const remaining = await db.payoutItem.findMany({ where: { payoutBatchId: batchId } });
    const allDone = remaining.every(i => i.status === 'completed');
    if (allDone) {
      await db.payoutBatch.update({
        where: { id: batchId },
        data: {
          status: 'completed',
          processedDate: new Date(),
          autoProcessed: true,
          autoProcessedAt: new Date(),
          resolvedAt: new Date(),
          resolutionNote: 'Auto-Pilot: Batch completed after unclaimed items resolved with real provider proof.',
        },
      });
      await audit('PayoutBatch', batchId, 'auto_retry_unclaimed', 'status=pending', 'status=completed',
        'Auto-Pilot: Batch completed — unclaimed item(s) resolved with real provider proof.', batchId);
    }
  }

  await logRun('retry_unclaimed_items', 'success', total, amount,
    `Retried ${total} unclaimed items w/ real proof; ${held} held for real provider proof (no synthetic UC- refs minted)`, Date.now() - start);
  return total;
}

// ── Phase 13: Reconcile transactions — REAL-PROOF ONLY / REPORT-ONLY ─────
// Transaction Mismatch: cross-reference TransactionLog with PayoutItems.
// Part 1 DEFANGED: an item completes ONLY via completeWithRealProof — a
// TransactionLog alone is no proof; the PayoutItem must carry its own real
// provider ref (no synthetic TXRECON- refs).
// Part 2 DEFANGED: a TransactionLog synthesized from a completed PayoutItem
// fabricates wallet/ledger history — the log must come from a real provider
// webhook/integration. Report-only.
async function reconcileTransactions() {
  const start = Date.now();
  let itemsFixed = 0;
  let amountFixed = 0;
  let held = 0;

  // 1. Find completed TransactionLog withdrawals with no matching completed PayoutItem
  const completedTxLogs = await db.transactionLog.findMany({
    where: { category: 'withdrawal', status: 'completed' },
  });

  for (const txLog of completedTxLogs) {
    // Skip recovery artifacts — never reconcile reversal/recovered TX logs
    if (
      txLog.errorCode === 'MISPLACED_SETTLEMENT' ||
      (txLog.description || '').includes('REVERSAL:') ||
      (txLog.description || '').includes('RECOVERED:')
    ) continue;

    // Check if there's a matching completed payout item
    let matchFound = false;
    if (txLog.payoutItemId) {
      const item = await db.payoutItem.findUnique({ where: { id: txLog.payoutItemId } });
      if (item && item.status === 'completed') {
        matchFound = true;
      }
    }

    if (!matchFound && txLog.payoutItemId) {
      // TransactionLog says completed but PayoutItem is not completed — the item
      // completes ONLY if it already carries its own REAL provider ref.
      const item = await db.payoutItem.findUnique({ where: { id: txLog.payoutItemId } });
      // Never undo a misplaced recovery — these items must stay failed
      if (item && (item.failureReason || '').startsWith('MISPLACED:')) continue;
      if (item && item.status !== 'completed') {
        const ok = await completeWithRealProof(item, `reconcile with TransactionLog ${txLog.id}`, 'auto_reconcile_tx_to_item');
        if (ok) { itemsFixed++; amountFixed += item.amount; }
        else { held++; }
      }
    }
  }

  // 2. Completed PayoutItems with no matching completed TransactionLog — REPORT-ONLY
  const completedItems = await db.payoutItem.findMany({
    where: { status: 'completed' },
    include: { payoutBatch: true },
  });

  for (const item of completedItems) {
    const existingLog = await db.transactionLog.findFirst({
      where: {
        payoutItemId: item.id,
        category: 'withdrawal',
        status: 'completed',
      },
    });

    if (!existingLog) {
      await audit('PayoutItem', item.id, 'auto_reconcile_item_to_tx_HELD',
        'TransactionLog=missing', 'TransactionLog=not_created',
        `Defang: TransactionLog for completed PayoutItem must come from a real provider webhook/integration, never synthesized from a completed item (${item.recipientName}, ${item.amount.toFixed(2)})`, item.payoutBatchId ?? undefined, item.id);
      held++;
    }
  }

  await logRun('reconcile_transactions', 'success', itemsFixed, amountFixed,
    `Reconciled ${itemsFixed} tx mismatches; ${held} held (no synthetic TXRECON- refs, no fabricated TransactionLogs)`, Date.now() - start);
  return itemsFixed;
}

// ── Phase 14: Resolve orphan transactions — ATTACH-ONLY, NEVER COMPLETED ──
// Orphan Transaction: TransactionLog withdrawals with no matching PayoutItem.
// DEFANGED: no synthetic PB-RECONCILE- batches, no RECONCILE- refs, no
// completed + deliveryConfirmed items. The missing PayoutItem is created as
// PENDING inside an EXISTING pending_approval batch only; transactionRef is set
// only when the txLog carries a REAL provider ref, otherwise null + failureReason.
async function resolveOrphanTransactions() {
  const start = Date.now();
  let itemsFixed = 0;
  let amountFixed = 0;

  // Collect all valid payout item IDs for fast lookup
  const allItemIds = new Set(
    (await db.payoutItem.findMany({ select: { id: true } })).map(p => p.id),
  );

  const orphanLogs = await db.transactionLog.findMany({
    where: { category: 'withdrawal' },
  });

  for (const txLog of orphanLogs) {
    const isOrphan = !txLog.payoutItemId || !allItemIds.has(txLog.payoutItemId);
    if (!isOrphan) continue;

    // NEVER create a synthetic batch — only attach to an EXISTING pending_approval batch.
    const targetBatch = await db.payoutBatch.findFirst({ where: { status: 'pending_approval' } });
    if (!targetBatch) {
      await audit('TransactionLog', txLog.id, 'resolve_orphan_HELD', 'payoutItemId=null',
        'payoutItemId=not_created',
        `Defang: no existing pending_approval batch to attach orphan TransactionLog ${txLog.referenceId || txLog.id} — NO synthetic reconciliation batch created; real provider proof + manual approval required.`);
      continue;
    }

    const candidateRef = txLog.providerTxId || txLog.referenceId;
    const transactionRef = isRealProviderRef(candidateRef) ? candidateRef : null;

    // Create the missing PayoutItem as PENDING (never completed, never deliveryConfirmed)
    const newItem = await db.payoutItem.create({
      data: {
        payoutBatchId: targetBatch.id,
        batchNumber: targetBatch.batchNumber,
        recipientName: getOwnerDisplayName(),
        recipientEmail: getOwnerEmail(),
        amount: txLog.amount,
        currency: txLog.currency,
        status: 'pending',
        paymentMethod: txLog.provider === 'paypal' ? 'paypal' : txLog.provider === 'payoneer' ? 'payoneer' : 'bank_transfer',
        transactionRef,
        ...(transactionRef ? {} : { failureReason: 'AUTO-PILOT DEFANG: resolve_orphan requires a REAL provider ref (txLog.providerTxId/reference was missing or locally-minted). Attach real provider proof before payout.' }),
      },
    });

    // Link the TransactionLog to the new PayoutItem
    await db.transactionLog.update({
      where: { id: txLog.id },
      data: { payoutItemId: newItem.id, payoutBatchId: targetBatch.id },
    });

    await audit('TransactionLog', txLog.id, transactionRef ? 'resolve_orphan' : 'resolve_orphan_HELD', 'payoutItemId=null',
      `payoutItemId=${newItem.id}`,
      transactionRef
        ? `Auto-Pilot: Created PENDING PayoutItem ${newItem.id} (real provider ref) and linked orphan TransactionLog ${txLog.referenceId || txLog.id}`
        : `Defang: created PENDING PayoutItem ${newItem.id} WITHOUT transactionRef (missing/locally-minted provider ref) — real provider proof required before payout`,
      targetBatch.id, newItem.id);

    // Recalculate batch item count
    const batchItemCount = await db.payoutItem.count({ where: { payoutBatchId: targetBatch.id } });
    const batchTotal = (await db.payoutItem.findMany({ where: { payoutBatchId: targetBatch.id } }))
      .reduce((s, i) => s + i.amount, 0);
    await db.payoutBatch.update({
      where: { id: targetBatch.id },
      data: { itemCount: batchItemCount, totalAmount: batchTotal },
    });

    itemsFixed++;
    amountFixed += txLog.amount;
  }

  await logRun('resolve_orphan_transactions', 'success', itemsFixed, amountFixed,
    `Resolved ${itemsFixed} orphan transactions by creating PENDING PayoutItems in existing pending_approval batches (never completed, no synthetic batches)`, Date.now() - start);
  return itemsFixed;
}

// ── Phase 15: Recover Misplaced Settlements — REPORT-ONLY (ESCALATE) ────
// Detects payouts sent to anyone other than the owner (from .env).
// DEFANGED: money/proof must NEVER be auto-fixed — must ESCALATE. No items are
// marked failed, no reversal TransactionLogs, no recovery batches/items, and no
// RECOVERED-/REV- refs. Each misplaced settlement is audited for MANUAL recovery
// backed by real reversal evidence.
async function recoverMisplacedSettlements() {
  const start = Date.now();
  let amountFixed = 0;
  let flagged = 0;

  const OWNER_EMAIL = getOwnerEmail();
  const OWNER_NAME = getOwnerNameUpper();

  const completedItems = await db.payoutItem.findMany({
    where: { status: 'completed' },
    include: { payoutBatch: true },
  });

  for (const item of completedItems) {
    // Skip crypto items — handled by recoverCryptoMisplaced phase
    if (item.paymentMethod.startsWith('crypto')) continue;
    // Skip recovery/reconcile/orphan artifacts
    const bn = (item.batchNumber || '').toUpperCase();
    if (bn.includes('RECOVERY') || bn.includes('ORPHAN') || bn.includes('RECONCILE') || bn.includes('CRYPTO-RECOVERY')) continue;

    const isOwner =
      item.recipientEmail === OWNER_EMAIL ||
      item.recipientName.toUpperCase().includes(OWNER_NAME);

    if (isOwner) continue;

    // Found a misplaced settlement — ESCALATE for MANUAL recovery (report-only).
    await audit('PayoutItem', item.id, 'auto_recover_HELD', 'status=completed', 'status=completed',
      `Defang: misplaced settlement $${item.amount.toFixed(2)} from ${item.recipientName} requires MANUAL recovery with real reversal evidence — auto-recovery removed (no failed-marking, no reversal logs, no recovery batches).`, item.payoutBatchId ?? undefined, item.id);
    amountFixed += item.amount;
    flagged++;
  }

  await logRun('recover_misplaced_settlements', 'success', 0, amountFixed,
    `DEFANGED: ${flagged} misplaced settlements ($${amountFixed.toFixed(2)}) require MANUAL recovery with real reversal evidence — auto-recovery removed`, Date.now() - start);
  return 0;
}

// ── Phase: Recover crypto misplaced settlements — REPORT-ONLY ────────────
// DEFANGED: no DB writes, no price valuation. A price oracle is not implemented
// (hard-coded TOKEN_PRICES were FABRICATED prices); inventing USD values is
// fabrication. Crypto recovery requires REAL on-chain evidence + a real price
// oracle — auto-recovery removed.
async function recoverCryptoMisplaced() {
  const start = Date.now();

  // Recover ALL misplaced+unrecovered settlements (confirmed, pending, failed)
  const misplacedCrypto = await db.cryptoSettlement.findMany({
    where: { misplaced: true, recovered: false },
  });

  let flagged = 0;

  for (const settlement of misplacedCrypto) {
    await audit('CryptoSettlement', settlement.id, 'recover_crypto_HELD',
      `recovered=false,status=${settlement.status}`, 'recovered=false,status=unchanged',
      `Defang: crypto recovery for ${settlement.amount} ${settlement.token} on ${settlement.network} requires REAL on-chain evidence + a real price oracle; auto-recovery removed (no fabricated prices, no CRYPTO-RECOVERY- refs).`);
    flagged++;
  }

  await logRun('recover_crypto_misplaced', 'success', 0, 0,
    `DEFANGED: ${flagged} misplaced crypto settlements require REAL on-chain evidence + a real price oracle; auto-recovery removed`, Date.now() - start);
  return 0;
}

// ── Phase: Carrier resolve (autonomous acquisition) ───────────────────────
async function carrierResolve() {
  const start = Date.now();
  const { autodetectCarrier } = await import('@/lib/procurement/carrier-router');
  const fabricated = /international shipping|multi-carrier/i;
  let total = 0;

  const shipments = await db.shipment.findMany({ take: 500, select: { id: true, carrier: true, trackingNumber: true } });

  for (const s of shipments) {
    if (s.trackingNumber) {
      const probe = autodetectCarrier(s.trackingNumber);
      if (probe && probe.known) {
        await db.shipment.update({
          where: { id: s.id },
          data: { carrier: probe.carrier, trackingUrl: probe.publicUrl, trackingVerified: false },
        });
        total++;
      }
    } else if (s.carrier && fabricated.test(s.carrier)) {
      await db.shipment.update({
        where: { id: s.id },
        data: { carrier: null, trackingUrl: null, trackingVerified: false },
      });
      total++;
    }
  }

  await logRun('carrier_resolve', 'success', total, 0,
    `Carrier sweep: ${total} shipments resolved (keyless autodetect / fabricated-label neutralization)`, Date.now() - start);
  return total;
}

// ── Phase: CRBT cash-return auto-reconcile (COD retour de cash) ─────────────
// Opens a CashReturn row when a COD shipment is REAL-delivered (trackingVerified + actualDelivery)
// and surfaces mismatch/dispute + overdue-remittance. Fail-closed: never invents proof —
// reconciled/returned only via real proofRef from the operator (see cash-return.ts).
async function crbtReconcile() {
  const start = Date.now();
  const { createCashReturn } = await import('@/lib/procurement/cash-return');
  let opened = 0;
  let alreadytracked = 0;

  const shipments = await db.shipment.findMany({
    where: { status: 'delivered' },
    select: {
      id: true,
      shipmentNumber: true,
      procurementItemId: true,
      carrier: true,
      trackingNumber: true,
      destinationCity: true,
      actualDelivery: true,
      trackingVerified: true,
    },
  });

  for (const s of shipments) {
    const isCod = /contre remboursement|COD|Amana|Avito|Aramex|Cathedis|Quick/i.test(s.carrier || '');
    if (!isCod) continue;
    if (!s.trackingVerified || !s.actualDelivery) continue; // no REAL delivery evidence → never open CRBT
    try {
      const item = s.procurementItemId
        ? await db.procurementItem.findUnique({ where: { id: s.procurementItemId }, select: { name: true, unitPriceEst: true, deliveryCity: true } })
        : null;
      await createCashReturn({
        shipmentId: s.id,
        procurementItemId: s.procurementItemId ?? undefined,
        shipmentNumber: s.shipmentNumber,
        itemName: item?.name,
        carrier: s.carrier ?? undefined,
        trackingNumber: s.trackingNumber ?? undefined,
        amountExpectedMAD: item?.unitPriceEst ?? 0,
        destinationCity: s.destinationCity ?? item?.deliveryCity ?? undefined,
        deliveredAt: s.actualDelivery,
      });
      opened++;
    } catch (e) {
      // already exists / benign — count separately
      alreadytracked++;
    }
  }

  await logRun('crbt_reconcile', 'success', opened + alreadytracked, 0,
    `CRBT sweep: opened ${opened} cash-return rows (real delivered COD), ${alreadytracked} already tracked`, Date.now() - start);
  return opened + alreadytracked;
}

// ── Phase: Procurement quarantine (anti-phantom delivered / settled sweep) ──
async function procurementQuarantine() {
  const start = Date.now();
  const { runPhantomCompletedQuarantineSweep } = await import('@/lib/strict-enforcement/phantom-quarantine.mjs');
  let result;
  try {
    result = await runPhantomCompletedQuarantineSweep({ db });
  } catch (e) {
    await logRun('procurement_quarantine', 'error', 0, 0,
      `Sweep failed: ${e instanceof Error ? e.message : String(e)}`, Date.now() - start);
    return 0;
  }
  const total = result?.total || 0;
  const per = (result?.perTable as Record<string, unknown>) || {};
  const perStr = Object.entries(per).map(([k, v]) => `${k}=${String(v)}`).join(', ');
  await logRun('procurement_quarantine', 'success', total, 0,
    `Phantom-completed quarantine sweep (Proc+Ship+PO triple-defence L3): quarantined ${total} rows. ${perStr || ''} (elapsed ${result?.elapsedMs || 0}ms, runId=${result?.runId || ''})`,
    Date.now() - start);
  return total;
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  const pipelineStart = Date.now();
  const phaseResults: { phase: string; status: string; itemsAffected: number; amountAffected: number; durationMs: number; details: string }[] = [];

  try {
    // Run all 14 phases in sequence (Khwarizmian fix_all pattern)
    const phaseFns: { name: Phase; fn: () => Promise<number> }[] = [
      { name: 'confirm_pending_revenue', fn: confirmPendingRevenue },
      { name: 'auto_approve_batches', fn: autoApproveBatches },
      { name: 'advance_approved_batches', fn: advanceApprovedBatches },
      { name: 'advance_processing_batches', fn: advanceProcessingBatches },
      { name: 'retry_failed_items', fn: retryFailedItems },
      { name: 'retry_failed_batches', fn: retryFailedBatches },
      { name: 'confirm_deliveries', fn: confirmDeliveries },
      { name: 'fix_timestamps', fn: fixTimestamps },
      { name: 'notify_recipients', fn: notifyRecipients },
      { name: 'batch_unassigned_revenue', fn: batchUnassignedRevenue },
      { name: 'advance_paypal_batches', fn: advancePaypalBatches },
      { name: 'retry_unclaimed_items', fn: retryUnclaimedItems },
      { name: 'recover_misplaced_settlements', fn: recoverMisplacedSettlements },
      { name: 'recover_crypto_misplaced', fn: recoverCryptoMisplaced },
      { name: 'reconcile_transactions', fn: reconcileTransactions },
      { name: 'resolve_orphan_transactions', fn: resolveOrphanTransactions },
      { name: 'carrier_resolve', fn: carrierResolve },
      { name: 'crbt_reconcile', fn: crbtReconcile },
      { name: 'procurement_quarantine', fn: procurementQuarantine },
    ];

    for (const { name, fn } of phaseFns) {
      try {
        const affected = await fn();
        phaseResults.push({ phase: name, status: 'success', itemsAffected: affected, amountAffected: 0, durationMs: 0, details: `${affected} items processed` });
      } catch (err) {
        console.error('[Ops/AutoPilot] Phase error:', name, err);
        phaseResults.push({ phase: name, status: 'error', itemsAffected: 0, amountAffected: 0, durationMs: 0, details: 'Internal server error' });
      }
    }

    const totalDuration = Date.now() - pipelineStart;

    // Fetch final state
    const [completedCount, pendingCount, failedCount, processingCount, approvedCount, pendingApprovalCount] = await Promise.all([
      db.payoutItem.count({ where: { status: 'completed' } }),
      db.payoutItem.count({ where: { status: 'pending' } }),
      db.payoutItem.count({ where: { status: 'failed' } }),
      db.payoutItem.count({ where: { status: 'processing' } }),
      db.payoutBatch.count({ where: { status: 'approved' } }),
      db.payoutBatch.count({ where: { status: 'pending_approval' } }),
    ]);

    const totalItemsAffected = phaseResults.reduce((s, p) => s + p.itemsAffected, 0);
    const totalAmountAffected = phaseResults.reduce((s, p) => s + p.amountAffected, 0);

    return NextResponse.json({
      success: true,
      trigger: 'manual',
      totalDurationMs: totalDuration,
      totalItemsAffected,
      totalAmountAffected,
      phases: phaseResults.map(p => ({ ...p, status: p.status === 'success' ? 'done' : p.status })),
      finalState: {
        items: { completed: completedCount, pending: pendingCount, failed: failedCount, processing: processingCount },
        batches: { approved: approvedCount, pendingApproval: pendingApprovalCount },
      },
    });
  } catch (error) {
    console.error('[Ops/AutoPilot] Pipeline error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error', phases: phaseResults }, { status: 500 });
  }
}

// ─── GET: Status for UI polling ────────────────────────────────────────────

export async function GET() {
  try {
    const [
      pendingApprovalBatches, approvedBatches, processingBatches, failedBatches, completedBatches,
      pendingItems, undeliveredItems, unnotifiedItems, pendingRevenue,
      runs,
      submittedToPaypalBatches, unclaimedItems, unbatchedRevenue,
      misplacedItems,
      cryptoMisplacedItems,
    ] = await Promise.all([
      db.payoutBatch.count({ where: { status: 'pending_approval' } }),
      db.payoutBatch.count({ where: { status: 'approved' } }),
      db.payoutBatch.count({ where: { status: 'processing' } }),
      db.payoutBatch.count({ where: { status: 'failed' } }),
      db.payoutBatch.count({ where: { status: 'completed' } }),
      db.payoutItem.count({ where: { status: 'pending' } }),
      db.payoutItem.count({ where: { status: 'completed', deliveryConfirmed: { not: true } } }),
      db.payoutItem.count({ where: { status: 'completed', recipientNotifiedAt: null } }),
      db.revenueEvent.count({ where: { status: 'pending' } }),
      db.autoPilotRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      db.payoutBatch.count({ where: { status: 'submitted_to_paypal' } }),
      db.payoutItem.count({ where: { status: 'unclaimed' } }),
      db.revenueEvent.count({ where: { status: 'confirmed', payoutBatchId: null } }),
      // Misplaced: completed items not sent to owner
      (async () => {
        const _oe = tryGetOwnerEmail();
        const _on = tryGetOwnerNameUpper();
        if (!_oe || !_on) return 0;
        const completed = await db.payoutItem.findMany({ where: { status: 'completed' } });
        return completed.filter(
          (i) => i.recipientEmail !== _oe && !i.recipientName.toUpperCase().includes(_on),
        ).length;
      })(),
      // Crypto misplaced: misplaced + not recovered (any status)
      db.cryptoSettlement.count({ where: { misplaced: true, recovered: false } }),
    ]);

    const needsAttention = pendingApprovalBatches + approvedBatches + processingBatches + failedBatches + pendingItems + undeliveredItems + unnotifiedItems + pendingRevenue + submittedToPaypalBatches + unclaimedItems + unbatchedRevenue + misplacedItems + cryptoMisplacedItems;

    return NextResponse.json({
      autoPilotActive: true,
      needsAttention,
      pipeline: {
        pendingApprovalBatches, approvedBatches, processingBatches, failedBatches, completedBatches,
        pendingItems, undeliveredItems, unnotifiedItems,
        submittedToPaypalBatches,
        unclaimedItems,
        unbatchedRevenue,
        pendingRevenue,
        misplacedItems,
        cryptoMisplacedItems,
      },
      runs: runs.map(r => ({
        id: r.id, trigger: r.trigger, phase: r.phase, status: r.status,
        itemsAffected: r.itemsAffected, amountAffected: r.amountAffected,
        details: r.details || '', durationMs: r.durationMs,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[GET /api/ops/auto-pilot] Error:', error);
    return NextResponse.json({ error: 'Failed to load auto-pilot status' }, { status: 500 });
  }
}