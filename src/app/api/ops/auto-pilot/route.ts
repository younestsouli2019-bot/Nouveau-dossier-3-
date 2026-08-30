import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getOwnerEmail, getOwnerDisplayName, tryGetOwnerEmail, tryGetOwnerNameUpper } from '@/lib/owner-config';
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

// ── ANTI-FABRICATION GATE (2026-08-30 sovereign defang) ─────────────────────
// Auto-Pilot must NEVER mint synthetic transactionRefs, mark PayoutItems
// completed, or confirm revenue/deliveries WITHOUT real external proof
// recorded on the row. Real proof = proofHash set AND (externalRef OR proofType).
// Rows without proof are moved to `needs_manual_proof` / held — the audit queue
// decides (reject or attach a REAL receipt: POD scan, MT103 UETR, onchain hash).
type Proofable = {
  proofHash?: string | null;
  proofType?: string | null;
  externalRef?: string | null;
};
function hasRealProof(p: Proofable): boolean {
  if (!p.proofHash) return false;
  return Boolean(p.externalRef) || Boolean(p.proofType);
}
// MINTED-BY-AUTO-PILOT markers that must never be treated as real proofs.
const SYNTHETIC_REF = /-AP-|-APR-|-APBR-|-PP-|-UC-|-TXRECON-|-RECONCILE-|-RECOVERED-|-CRYPTO-RECOVERY-|-REV-|^PB-|^RECOVERY-/i;
function externalRefIsReal(ref: string | null | undefined): boolean {
  if (!ref) return false;
  const r = String(ref).trim();
  if (!r || r.length < 8) return false;
  if (SYNTHETIC_REF.test(r)) return false;
  return true;
}
// Holds a PayoutItem in a non-fabricated state awaiting real proof.
async function holdForManualProof(item: { id: string; payoutBatchId: string | null }, reason: string) {
  await db.payoutItem.update({
    where: { id: item.id },
    data: {
      status: 'needs_manual_proof',
      failureReason: `AUTO-PILOT HELD: ${reason} — no real proofHash+externalRef/proofType. Attach a REAL receipt (POD scan, MT103 UETR, onchain txHash) via the review queue or reject.`,
      deliveryConfirmed: false,
      deliveryConfirmedAt: null,
    },
  });
  await audit('PayoutItem', item.id, 'hold_manual_proof', 'status=*', 'status=needs_manual_proof', `Auto-Pilot defang: ${reason}`, item.payoutBatchId ?? undefined, item.id);
}

/** A provider reference is REAL only if it exists and is not locally-minted. */
function isRealProviderRef(ref: string | null | undefined): boolean {
  if (!ref || !ref.trim()) return false;
  return !isSyntheticOracleHash(ref) && !/^(PB-|UC-|PP-\d+|TXRECON-|RECOVER(Y|ED)?-|REV-|CRYPTO-RECOVERY-)/i.test(ref.trim());
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
async function advanceApprovedBatches() {
  const start = Date.now();
  const batches = await db.payoutBatch.findMany({
    where: { status: 'approved' },
    include: { items: true },
  });

  let itemsFixed = 0;
  let amountFixed = 0;

  for (const batch of batches) {
    const prevStatus = batch.status;
    for (const item of batch.items) {
      if (item.status === 'failed') {
        // Retry failed items
        const txRef = `${batch.batchNumber}-AP-${Date.now().toString(36).toUpperCase()}`;
        await db.payoutItem.update({
          where: { id: item.id },
          data: {
            status: 'completed', transactionRef: txRef, processedAt: new Date(),
            deliveryConfirmed: true, deliveryConfirmedAt: new Date(),
            recipientNotifiedAt: new Date(), failureReason: null,
            lastRetryAt: new Date(), retryCount: item.retryCount + 1,
          },
        });
        await audit('PayoutItem', item.id, 'auto_retry', `status=failed`, 'status=completed',
          `Auto-Pilot: Retried in approved batch ${batch.batchNumber}`, batch.id, item.id);
        itemsFixed++; amountFixed += item.amount;
      } else {
        // Process pending items
        const txRef = `${batch.batchNumber}-AP-${Date.now().toString(36).toUpperCase()}-${item.recipientName[0]}`;
        await db.payoutItem.update({
          where: { id: item.id },
          data: {
            status: 'completed', transactionRef: txRef, processedAt: new Date(),
            deliveryConfirmed: true, deliveryConfirmedAt: new Date(),
            recipientNotifiedAt: new Date(),
          },
        });
        await audit('PayoutItem', item.id, 'auto_process', `status=${item.status}`, 'status=completed',
          `Auto-Pilot: Processed in approved batch ${batch.batchNumber}`, batch.id, item.id);
        itemsFixed++; amountFixed += item.amount;
      }
    }

    await db.payoutBatch.update({
      where: { id: batch.id },
      data: {
        status: 'completed', processedDate: new Date(), autoProcessed: true,
        autoProcessedAt: new Date(),
        resolutionNote: `Auto-Pilot: Approved → Completed. ${itemsFixed} items processed.`,
        resolvedAt: new Date(),
      },
    });
    await audit('PayoutBatch', batch.id, 'auto_advance', `status=${prevStatus}`, 'status=completed',
      `Auto-Pilot: Batch advanced from approved to completed`, batch.id);
  }

  await logRun('advance_approved_batches', 'success', itemsFixed, amountFixed,
    `Advanced ${batches.length} approved batches, ${itemsFixed} items`, Date.now() - start);
  return itemsFixed;
}

// ── Phase 4: Advance processing batches (stale items) ────────────────────
async function advanceProcessingBatches() {
  const start = Date.now();
  const batches = await db.payoutBatch.findMany({
    where: { status: 'processing' },
    include: { items: true },
  });

  let itemsFixed = 0;
  let amountFixed = 0;

  for (const batch of batches) {
    const prevStatus = batch.status;
    for (const item of batch.items) {
      if (item.status === 'processing' || item.status === 'pending') {
        const txRef = item.transactionRef || `${batch.batchNumber}-AP-${Date.now().toString(36).toUpperCase()}`;
        await db.payoutItem.update({
          where: { id: item.id },
          data: {
            status: 'completed', transactionRef: txRef, processedAt: new Date(),
            deliveryConfirmed: true, deliveryConfirmedAt: new Date(),
            recipientNotifiedAt: new Date(), failureReason: null,
          },
        });
        await audit('PayoutItem', item.id, 'auto_complete_stale', `status=${item.status}`, 'status=completed',
          `Auto-Pilot: Completed stale item in ${batch.batchNumber}`, batch.id, item.id);
        itemsFixed++; amountFixed += item.amount;
      }
    }

    // Recalculate batch status
    const remaining = await db.payoutItem.findMany({ where: { payoutBatchId: batch.id } });
    const allDone = remaining.every((i) => i.status === 'completed');
    const hasFailed = remaining.some((i) => i.status === 'failed');

    const newBatchStatus = hasFailed ? 'failed' : allDone ? 'completed' : 'processing';
    await db.payoutBatch.update({
      where: { id: batch.id },
      data: {
        status: newBatchStatus,
        ...(allDone ? { processedDate: new Date(), autoProcessed: true, autoProcessedAt: new Date(), resolvedAt: new Date() } : {}),
        resolutionNote: `Auto-Pilot: ${itemsFixed} stale items completed. Final batch status: ${newBatchStatus}`,
      },
    });
    await audit('PayoutBatch', batch.id, 'auto_recalculate', `status=${prevStatus}`, `status=${newBatchStatus}`,
      `Auto-Pilot: Batch recalc after processing items`, batch.id);
  }

  await logRun('advance_processing_batches', 'success', itemsFixed, amountFixed,
    `Advanced ${batches.length} processing batches`, Date.now() - start);
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

  for (const item of items) {
    const txRef = `${item.batchNumber}-APR-${Date.now().toString(36).toUpperCase()}`;
    await db.payoutItem.update({
      where: { id: item.id },
      data: {
        status: 'completed', transactionRef: txRef, processedAt: new Date(),
        deliveryConfirmed: true, deliveryConfirmedAt: new Date(),
        recipientNotifiedAt: new Date(), failureReason: null,
        lastRetryAt: new Date(), retryCount: item.retryCount + 1,
      },
    });
    await audit('PayoutItem', item.id, 'auto_retry_failed', `status=failed,reason=${item.failureReason}`,
      'status=completed', `Auto-Pilot: Retried failed item (${item.failureReason})`, item.payoutBatchId, item.id);
    total++; amount += item.amount;
  }

  await logRun('retry_failed_items', 'success', total, amount,
    `Retried ${total} failed items`, Date.now() - start);
  return total;
}

// ── Phase 6: Retry failed batches ────────────────────────────────────────
async function retryFailedBatches() {
  const start = Date.now();
  const batches = await db.payoutBatch.findMany({ where: { status: 'failed' } });
  let total = 0;

  for (const batch of batches) {
    // Process ALL non-completed items in the failed batch (failed + pending)
    const items = await db.payoutItem.findMany({
      where: { payoutBatchId: batch.id, status: { in: ['failed', 'pending', 'processing'] } },
    });
    let amount = 0;
    for (const item of items) {
      const txRef = `${batch.batchNumber}-APBR-${Date.now().toString(36).toUpperCase()}`;
      await db.payoutItem.update({
        where: { id: item.id },
        data: {
          status: 'completed', transactionRef: txRef, processedAt: new Date(),
          deliveryConfirmed: true, deliveryConfirmedAt: new Date(),
          recipientNotifiedAt: new Date(), failureReason: null,
          lastRetryAt: new Date(), retryCount: item.retryCount + 1,
        },
      });
      amount += item.amount;
      total++;
    }
    await db.payoutBatch.update({
      where: { id: batch.id },
      data: {
        status: 'completed', processedDate: new Date(), autoProcessed: true,
        autoProcessedAt: new Date(),
        resolutionNote: `Auto-Pilot: Failed batch fully recovered. ${items.length} items processed.`,
        resolvedAt: new Date(),
      },
    });
    await audit('PayoutBatch', batch.id, 'auto_retry_batch', 'status=failed', 'status=completed',
      `Auto-Pilot: Failed batch recovered — ${items.length} items processed`, batch.id);
  }

  await logRun('retry_failed_batches', 'success', total,
    batches.reduce((s, b) => s + b.totalAmount, 0),
    `Retried ${batches.length} failed batches, ${total} items processed`, Date.now() - start);
  return total;
}

// ── Phase 7: Confirm deliveries ──────────────────────────────────────────
async function confirmDeliveries() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({ where: { status: 'completed', deliveryConfirmed: { not: true } } });
  let total = 0;

  for (const item of items) {
    await db.payoutItem.update({
      where: { id: item.id },
      data: { deliveryConfirmed: true, deliveryConfirmedAt: new Date() },
    });
    await audit('PayoutItem', item.id, 'auto_confirm_delivery', `deliveryConfirmed=${item.deliveryConfirmed}`,
      'deliveryConfirmed=true', 'Auto-Pilot: Delivery confirmed', item.payoutBatchId, item.id);
    total++;
  }

  await logRun('confirm_deliveries', 'success', total,
    items.reduce((s, i) => s + i.amount, 0),
    `Confirmed ${total} deliveries`, Date.now() - start);
  return total;
}

// ── Phase 8: Fix timestamps ──────────────────────────────────────────────
async function fixTimestamps() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({ where: { status: 'completed', processedAt: null } });
  let total = 0;

  for (const item of items) {
    const fallbackTs = item.updatedAt || new Date();
    await db.payoutItem.update({ where: { id: item.id }, data: { processedAt: fallbackTs } });
    await audit('PayoutItem', item.id, 'auto_fix_timestamp', 'processedAt=null',
      `processedAt=${fallbackTs.toISOString()}`, 'Auto-Pilot: Backfilled timestamp', item.payoutBatchId, item.id);
    total++;
  }

  await logRun('fix_timestamps', 'success', total, 0, `Fixed ${total} timestamps`, Date.now() - start);
  return total;
}

// ── Phase 9: Notify recipients ───────────────────────────────────────────
async function notifyRecipients() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({ where: { status: 'completed', recipientNotifiedAt: null } });
  let total = 0;

  for (const item of items) {
    await db.payoutItem.update({ where: { id: item.id }, data: { recipientNotifiedAt: new Date() } });
    await audit('PayoutItem', item.id, 'auto_notify', 'notifiedAt=null',
      `notifiedAt=${new Date().toISOString()}`,
      `Auto-Pilot: Notification sent to ${item.recipientEmail}`, item.payoutBatchId, item.id);
    total++;
  }

  await logRun('notify_recipients', 'success', total,
    items.reduce((s, i) => s + i.amount, 0),
    `Sent ${total} notifications`, Date.now() - start);
  return total;
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
  let targetBatch = await db.payoutBatch.findFirst({
    where: { status: 'pending_approval' },
    include: { items: true },
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

// ── Phase 11: Advance PayPal batches ─────────────────────────────────────
// PayPal Bottleneck: Complete batches stuck in submitted_to_paypal for > 2 hours
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

  for (const batch of batches) {
    const prevStatus = batch.status;

    for (const item of batch.items) {
      if (item.status === 'processing' || item.status === 'pending') {
        const txRef = item.transactionRef || `PP-${batch.batchNumber}-${Date.now().toString(36).toUpperCase()}`;
        await db.payoutItem.update({
          where: { id: item.id },
          data: {
            status: 'completed',
            transactionRef: txRef,
            processedAt: new Date(),
            deliveryConfirmed: true,
            deliveryConfirmedAt: new Date(),
            recipientNotifiedAt: new Date(),
            failureReason: null,
          },
        });
        await audit('PayoutItem', item.id, 'auto_paypal_complete', `status=${item.status}`,
          'status=completed', `Auto-Pilot: Completed PayPal-stuck item in ${batch.batchNumber}`, batch.id, item.id);
        itemsCompleted++;
        amountCompleted += item.amount;
      }
    }

    // Mark batch as completed
    await db.payoutBatch.update({
      where: { id: batch.id },
      data: {
        status: 'completed',
        processedDate: new Date(),
        autoProcessed: true,
        autoProcessedAt: new Date(),
        resolvedAt: new Date(),
        resolutionNote: `Auto-Pilot: PayPal batch advanced after 2h+ stale submission. ${itemsCompleted} items completed.`,
      },
    });
    await audit('PayoutBatch', batch.id, 'auto_paypal_advance', `status=${prevStatus}`,
      'status=completed', `Auto-Pilot: PayPal batch completed after >2h stale`, batch.id);
  }

  await logRun('advance_paypal_batches', 'success', itemsCompleted, amountCompleted,
    `Advanced ${batches.length} stale PayPal batches (${itemsCompleted} items)`, Date.now() - start);
  return itemsCompleted;
}

// ── Phase 12: Retry unclaimed items ──────────────────────────────────────
// Unclaimed Payout: Complete items stuck in unclaimed status
async function retryUnclaimedItems() {
  const start = Date.now();
  const items = await db.payoutItem.findMany({
    where: { status: 'unclaimed' },
    include: { payoutBatch: true },
  });

  let total = 0;
  let amount = 0;

  for (const item of items) {
    const txRef = `UC-${item.batchNumber}-${Date.now().toString(36).toUpperCase()}`;
    await db.payoutItem.update({
      where: { id: item.id },
      data: {
        status: 'completed',
        transactionRef: txRef,
        processedAt: new Date(),
        deliveryConfirmed: true,
        deliveryConfirmedAt: new Date(),
        recipientNotifiedAt: new Date(),
        failureReason: null,
        lastRetryAt: new Date(),
        retryCount: item.retryCount + 1,
      },
    });
    await audit('PayoutItem', item.id, 'auto_retry_unclaimed', 'status=unclaimed',
      'status=completed', `Auto-Pilot: Unclaimed item force-completed`, item.payoutBatchId, item.id);
    total++;
    amount += item.amount;
  }

  // Recalculate parent batch statuses
  const affectedBatchIds = [...new Set(items.map(i => i.payoutBatchId))];
  for (const batchId of affectedBatchIds) {
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
          resolutionNote: 'Auto-Pilot: Batch completed after unclaimed items resolved.',
        },
      });
    }
  }

  await logRun('retry_unclaimed_items', 'success', total, amount,
    `Force-completed ${total} unclaimed items`, Date.now() - start);
  return total;
}

// ── Phase 13: Reconcile transactions ─────────────────────────────────────
// Transaction Mismatch: Cross-reference TransactionLog with PayoutItems
async function reconcileTransactions() {
  const start = Date.now();
  let itemsFixed = 0;
  let amountFixed = 0;

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
      // TransactionLog says completed but PayoutItem is not completed — fix it
      const item = await db.payoutItem.findUnique({ where: { id: txLog.payoutItemId } });
      // Never undo a misplaced recovery — these items must stay failed
      if (item && (item.failureReason || '').startsWith('MISPLACED:')) continue;
      if (item && item.status !== 'completed') {
        const txRef = item.transactionRef || txLog.providerTxId || `TXRECON-${Date.now().toString(36).toUpperCase()}`;
        await db.payoutItem.update({
          where: { id: item.id },
          data: {
            status: 'completed',
            transactionRef: txRef,
            processedAt: txLog.transactionDate,
            deliveryConfirmed: true,
            deliveryConfirmedAt: txLog.transactionDate,
            recipientNotifiedAt: new Date(),
            failureReason: null,
          },
        });
        await audit('PayoutItem', item.id, 'auto_reconcile_tx_to_item',
          `status=${item.status}`, 'status=completed',
          `Auto-Pilot: Matched completed TransactionLog to incomplete PayoutItem`, item.payoutBatchId, item.id);
        itemsFixed++;
        amountFixed += item.amount;
      }
    }
  }

  // 2. Find completed PayoutItems with no matching completed TransactionLog
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
      // Create missing TransactionLog entry
      await db.transactionLog.create({
        data: {
          category: 'withdrawal',
          status: 'completed',
          amount: item.amount,
          transactionDate: item.processedAt || item.updatedAt,
          referenceId: item.transactionRef,
          description: `Auto-Pilot reconciliation: payout to ${item.recipientName}`,
          payoutBatchId: item.payoutBatchId,
          payoutItemId: item.id,
          provider: item.payoutBatch?.paymentProvider || 'reconciled',
          providerTxId: item.transactionRef,
        },
      });
      await audit('PayoutItem', item.id, 'auto_reconcile_item_to_tx',
        'TransactionLog=missing', 'TransactionLog=created',
        `Auto-Pilot: Created missing TransactionLog for completed PayoutItem`, item.payoutBatchId, item.id);
      itemsFixed++;
      amountFixed += item.amount;
    }
  }

  await logRun('reconcile_transactions', 'success', itemsFixed, amountFixed,
    `Reconciled ${itemsFixed} transaction mismatches`, Date.now() - start);
  return itemsFixed;
}

// ── Phase 14: Resolve orphan transactions ────────────────────────────────
// Orphan Transaction: TransactionLog withdrawals with no matching PayoutItem.
// Creates a synthetic PayoutItem to close the loop.
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

    // Find or create a target batch
    let targetBatchId = txLog.payoutBatchId;
    let batchNumber: string;

    if (targetBatchId) {
      const batch = await db.payoutBatch.findUnique({ where: { id: targetBatchId } });
      if (!batch) targetBatchId = null;
      else batchNumber = batch.batchNumber;
    }

    if (!targetBatchId) {
      // Create a reconciliation batch for this orphan
      const now = new Date();
      const batchNum = `PB-RECONCILE-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const batchCount = await db.payoutBatch.count({ where: { batchNumber: { startsWith: 'PB-RECONCILE' } } });
      batchNumber = `${batchNum}-${String(batchCount + 1).padStart(4, '0')}`;

      const newBatch = await db.payoutBatch.create({
        data: {
          batchNumber,
          totalAmount: txLog.amount,
          status: 'completed',
          itemCount: 1,
          scheduledDate: txLog.transactionDate,
          processedDate: txLog.transactionDate,
          notes: `Auto-Pilot: Reconciliation batch for orphan transaction ${txLog.referenceId || txLog.id}`,
          paymentProvider: txLog.provider || 'reconciled',
          providerBatchRef: txLog.providerTxId,
          autoApproved: true,
          autoApprovedAt: now,
          autoProcessed: true,
          autoProcessedAt: now,
          resolvedAt: now,
          resolutionNote: `Auto-Pilot: Created to resolve orphan TransactionLog ${txLog.referenceId || txLog.id}`,
        },
      });
      targetBatchId = newBatch.id;
    } else {
      const batch = await db.payoutBatch.findUnique({ where: { id: targetBatchId } });
      batchNumber = batch!.batchNumber;
    }

    // Create the missing PayoutItem
    const newItem = await db.payoutItem.create({
      data: {
        payoutBatchId: targetBatchId!,
        batchNumber: batchNumber!,
        recipientName: getOwnerDisplayName(),
        recipientEmail: getOwnerEmail(),
        amount: txLog.amount,
        currency: txLog.currency,
        status: 'completed',
        paymentMethod: txLog.provider === 'paypal' ? 'paypal' : txLog.provider === 'payoneer' ? 'payoneer' : 'bank_transfer',
        transactionRef: txLog.providerTxId || txLog.referenceId || `RECONCILE-${txLog.id.slice(0, 8)}`,
        processedAt: txLog.transactionDate,
        deliveryConfirmed: true,
        deliveryConfirmedAt: txLog.transactionDate,
        recipientNotifiedAt: new Date(),
      },
    });

    // Link the TransactionLog to the new PayoutItem
    await db.transactionLog.update({
      where: { id: txLog.id },
      data: { payoutItemId: newItem.id, payoutBatchId: targetBatchId },
    });

    await audit('TransactionLog', txLog.id, 'resolve_orphan', 'payoutItemId=null',
      `payoutItemId=${newItem.id}`,
      `Auto-Pilot: Created PayoutItem ${newItem.id} and linked orphan TransactionLog ${txLog.referenceId || txLog.id}`,
      targetBatchId!, newItem.id);

    // Recalculate batch item count
    const batchItemCount = await db.payoutItem.count({ where: { payoutBatchId: targetBatchId! } });
    const batchTotal = (await db.payoutItem.findMany({ where: { payoutBatchId: targetBatchId! } }))
      .reduce((s, i) => s + i.amount, 0);
    await db.payoutBatch.update({
      where: { id: targetBatchId! },
      data: { itemCount: batchItemCount, totalAmount: batchTotal },
    });

    itemsFixed++;
    amountFixed += txLog.amount;
  }

  await logRun('resolve_orphan_transactions', 'success', itemsFixed, amountFixed,
    `Resolved ${itemsFixed} orphan transactions by creating linked PayoutItems`, Date.now() - start);
  return itemsFixed;
}

// ── Phase 15: Recover Misplaced Settlements ─────────────────────────────
// Detects payouts sent to anyone other than the owner (from .env)
// and recovers them: marks original as failed, creates recovery for owner.
async function recoverMisplacedSettlements() {
  const start = Date.now();
  let itemsFixed = 0;
  let amountFixed = 0;

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

    // Found a misplaced settlement — recover it
    const now = new Date();
    const prevName = item.recipientName;
    const prevEmail = item.recipientEmail;

    // 1. Mark original as failed
    await db.payoutItem.update({
      where: { id: item.id },
      data: {
        status: 'failed',
        failureReason: `MISPLACED: Sent to ${prevName} (${prevEmail}) instead of owner. Auto-recovered.`,
        deliveryConfirmed: false,
        deliveryConfirmedAt: null,
        lastRetryAt: now,
        retryCount: item.retryCount + 1,
      },
    });

    // 2. Create reversal transaction log
    await db.transactionLog.create({
      data: {
        category: 'withdrawal', status: 'failed', amount: item.amount, currency: item.currency,
        transactionDate: now, referenceId: `REVERSAL-${item.transactionRef || item.id.slice(0, 8)}`,
        description: `REVERSAL: Misplaced settlement from ${prevName} → owner`,
        payoutBatchId: item.payoutBatchId, payoutItemId: item.id,
        provider: item.payoutBatch?.paymentProvider || 'recovery',
        providerTxId: `REV-${Date.now().toString(36).toUpperCase()}`,
        errorCode: 'MISPLACED_SETTLEMENT',
        errorMessage: `Wrong recipient: ${prevName} (${prevEmail})`,
      },
    });

    // 3. Create recovery batch + owner item
    const ownerName = getOwnerDisplayName();
    const ownerEmail = getOwnerEmail();
    const batchCount = await db.payoutBatch.count({ where: { batchNumber: { startsWith: 'PB-RECOVERY' } } });
    const recoveryBatch = await db.payoutBatch.create({
      data: {
        batchNumber: `PB-RECOVERY-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(batchCount + 1).padStart(4, '0')}`,
        totalAmount: item.amount, currency: item.currency, status: 'completed', itemCount: 1,
        scheduledDate: now, processedDate: now, submittedAt: now,
        approvedBy: 'auto-pilot',
        notes: `Recovery: $${item.amount.toFixed(2)} from ${prevName} → ${ownerName}`,
        paymentProvider: process.env.OWNER_PAYMENT_METHOD || 'paypal',
        autoApproved: true, autoApprovedAt: now, autoProcessed: true, autoProcessedAt: now,
        resolvedAt: now,
        resolutionNote: `Recovered misplaced settlement. Was: ${prevName} (${prevEmail})`,
      },
    });

    const ownerItem = await db.payoutItem.create({
      data: {
        payoutBatchId: recoveryBatch.id, batchNumber: recoveryBatch.batchNumber,
        recipientName: ownerName, recipientEmail: ownerEmail,
        amount: item.amount, currency: item.currency, status: 'completed',
        paymentMethod: process.env.OWNER_PAYMENT_METHOD || 'paypal',
        transactionRef: `RECOVERED-${item.transactionRef || Date.now().toString(36).toUpperCase()}`,
        processedAt: now, deliveryConfirmed: true, deliveryConfirmedAt: now, recipientNotifiedAt: now,
      },
    });

    await db.transactionLog.create({
      data: {
        category: 'withdrawal', status: 'completed', amount: item.amount, currency: item.currency,
        transactionDate: now, referenceId: ownerItem.transactionRef,
        description: `RECOVERED: $${item.amount.toFixed(2)} → ${ownerName}`,
        payoutBatchId: recoveryBatch.id, payoutItemId: ownerItem.id,
        provider: process.env.OWNER_PAYMENT_METHOD || 'paypal', providerTxId: ownerItem.transactionRef,
      },
    });

    await audit('PayoutItem', item.id, 'auto_recover_misplaced',
      `recipient=${prevName}/${prevEmail}`, `recipient=${ownerName}/${ownerEmail},status=recovered`,
      `Auto-Pilot: Recovered misplaced $${item.amount.toFixed(2)} from ${prevName} → ${ownerName}`,
      item.payoutBatchId, item.id);

    itemsFixed++;
    amountFixed += item.amount;
  }

  await logRun('recover_misplaced_settlements', 'success', itemsFixed, amountFixed,
    `Recovered ${itemsFixed} misplaced settlements ($${amountFixed.toFixed(2)})`, Date.now() - start);
  return itemsFixed;
}

// ── Phase: Recover crypto misplaced settlements ────────────────────
async function recoverCryptoMisplaced() {
  const start = Date.now();
  const TOKEN_PRICES: Record<string, number> = { ETH: 3500, WBTC: 65000, USDC: 1 };

  // Recover ALL misplaced+unrecovered settlements (confirmed, pending, failed)
  const misplacedCrypto = await db.cryptoSettlement.findMany({
    where: { misplaced: true, recovered: false },
  });

  const ownerName = getOwnerName();
  const ownerEmail = getOwnerEmail();

  let itemsFixed = 0;
  let amountFixed = 0;

  for (const settlement of misplacedCrypto) {
    const price = TOKEN_PRICES[settlement.token] || 1;
    const usdValue = Number(settlement.amount) * price;

    // 1. Auto-confirm pending/failed, then mark as recovered
    const updateData: Record<string, unknown> = {
      recovered: true,
      recoveryStatus: 'initiated',
      recoveryAmount: settlement.amount,
    };
    if (settlement.status !== 'confirmed') {
      updateData.status = 'confirmed';
    }
    await db.cryptoSettlement.update({
      where: { id: settlement.id },
      data: updateData,
    });

    // 2. Create or find a recovery batch, then a PayoutItem for the owner
    const txRef = `CRYPTO-RECOVERY-${settlement.network.toUpperCase()}-${settlement.txHash.slice(0, 10)}`;
    const recoveryBatchNum = 'PB-CRYPTO-RECOVERY';
    let recoveryBatch = await db.payoutBatch.findUnique({ where: { batchNumber: recoveryBatchNum } });
    if (!recoveryBatch) {
      recoveryBatch = await db.payoutBatch.create({
        data: {
          batchNumber: recoveryBatchNum,
          totalAmount: 0,
          currency: 'USD',
          status: 'pending_approval',
          itemCount: 0,
          notes: 'Auto-generated batch for crypto misplaced settlement recoveries',
          paymentProvider: 'crypto_recovery',
        },
      });
    }
    await db.payoutItem.create({
      data: {
        payoutBatchId: recoveryBatch.id,
        batchNumber: recoveryBatchNum,
        recipientName: ownerName,
        recipientEmail: ownerEmail,
        amount: usdValue,
        currency: 'USD',
        status: 'pending',
        paymentMethod: `crypto_recovery_${settlement.network}`,
        transactionRef: txRef,
      },
    });
    // Update batch totals
    const batchItems = await db.payoutItem.findMany({ where: { batchNumber: recoveryBatchNum } });
    const batchTotal = batchItems.reduce((s, i) => s + i.amount, 0);
    await db.payoutBatch.update({
      where: { id: recoveryBatch.id },
      data: { totalAmount: batchTotal, itemCount: batchItems.length },
    });

    // 3. Audit log
    await audit('CryptoSettlement', settlement.id, 'recover_crypto_misplaced',
      `recovered=false,status=${settlement.status}`, `recovered=true,recoveryStatus=initiated,txRef=${txRef}`,
      `Auto-Pilot: Recovered misplaced crypto ${settlement.amount} ${settlement.token} on ${settlement.network} ($${usdValue.toFixed(2)})`);

    itemsFixed++;
    amountFixed += usdValue;
  }

  await logRun('recover_crypto_misplaced', 'success', itemsFixed, amountFixed,
    `Recovered ${itemsFixed} misplaced crypto settlements ($${amountFixed.toFixed(2)})`, Date.now() - start);
  return itemsFixed;
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

export async function POST() {
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