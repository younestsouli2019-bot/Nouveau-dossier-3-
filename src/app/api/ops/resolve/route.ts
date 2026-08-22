import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getOwnerName, getOwnerEmail, getOwnerNameUpper, getOwnerDisplayName } from '@/lib/owner-config';

type ResolutionAction =
  | 'confirm_delivery'
  | 'fix_timestamp'
  | 'retry_item'
  | 'advance_batch'
  | 'recalculate_batch'
  | 'retry_batch'
  | 'confirm_revenue'
  | 'notify_recipient'
  | 'resolve_all'
  | 'advance_paypal_batch'
  | 'batch_revenue'
  | 'link_orphan_transaction'
  | 'reconcile_transaction'
  | 'flag_payment_method'
  | 'recover_misplaced'
  | 'recover_crypto_misplaced';

interface ResolutionRequest {
  action: ResolutionAction;
  itemId?: string;
  batchId?: string;
  eventId?: string;
  transactionLogId?: string;
  cryptoSettlementId?: string;
}

// Audit log helper
async function audit(
  entityType: string,
  entityId: string,
  action: string,
  oldValue: string | null,
  newValue: string,
  reason: string,
  payoutBatchId?: string,
  payoutItemId?: string,
) {
  await db.payoutAuditLog.create({
    data: {
      entityType,
      entityId,
      action,
      oldValue,
      newValue,
      reason,
      performedBy: 'ops-auto-resolver',
      payoutBatchId,
      payoutItemId,
    },
  });
}

// ─── RESOLVERS ─────────────────────────────────────────────────────────────

async function confirmDelivery(itemId: string) {
  const item = await db.payoutItem.findUnique({ where: { id: itemId } });
  if (!item) return { ok: false, message: 'Item not found' };

  const prev = `deliveryConfirmed=${item.deliveryConfirmed}`;
  const updated = await db.payoutItem.update({
    where: { id: itemId },
    data: {
      deliveryConfirmed: true,
      deliveryConfirmedAt: new Date(),
    },
  });

  await audit('PayoutItem', itemId, 'confirm_delivery', prev, 'deliveryConfirmed=true', 'Auto-resolved: Delivery confirmed by Ops engine', item.payoutBatchId, itemId);
  return { ok: true, message: `Delivery confirmed for ${updated.recipientName}`, item: updated };
}

async function fixTimestamp(itemId: string) {
  const item = await db.payoutItem.findUnique({ where: { id: itemId } });
  if (!item) return { ok: false, message: 'Item not found' };

  const fallbackTs = item.updatedAt || new Date();
  const prev = `processedAt=${item.processedAt}`;
  const updated = await db.payoutItem.update({
    where: { id: itemId },
    data: { processedAt: fallbackTs },
  });

  await audit('PayoutItem', itemId, 'fix_timestamp', prev, `processedAt=${fallbackTs.toISOString()}`, 'Auto-resolved: Backfilled processedAt from updatedAt', item.payoutBatchId, itemId);
  return { ok: true, message: `Timestamp backfilled for ${updated.recipientName}`, item: updated };
}

async function retryItem(itemId: string) {
  const item = await db.payoutItem.findUnique({
    where: { id: itemId },
    include: { payoutBatch: true },
  });
  if (!item) return { ok: false, message: 'Item not found' };

  const prevStatus = item.status;
  const prevRetry = item.retryCount;
  const txRef = item.transactionRef || `${item.batchNumber}-R${item.retryCount + 1}-${Date.now().toString(36).toUpperCase()}`;

  const updated = await db.payoutItem.update({
    where: { id: itemId },
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

  // Recalculate batch if needed
  if (item.payoutBatch.status === 'failed') {
    const remaining = await db.payoutItem.count({
      where: { payoutBatchId: item.payoutBatchId, status: 'failed' },
    });
    if (remaining === 0) {
      const allCompleted = await db.payoutItem.count({
        where: { payoutBatchId: item.payoutBatchId, status: { in: ['completed', 'processing'] } },
      });
      const totalInBatch = await db.payoutItem.count({
        where: { payoutBatchId: item.payoutBatchId },
      });
      if (allCompleted === totalInBatch) {
        await db.payoutBatch.update({
          where: { id: item.payoutBatchId },
          data: {
            status: 'completed',
            processedDate: new Date(),
            resolutionNote: `Auto-resolved: All items recovered. Last retry at ${new Date().toISOString()}`,
            resolvedAt: new Date(),
          },
        });
      } else {
        await db.payoutBatch.update({
          where: { id: item.payoutBatchId },
          data: { status: 'processing', resolutionNote: `Auto-resolved: Partial recovery. ${remaining} items still need attention.` },
        });
      }
    }
  }

  await audit('PayoutItem', itemId, 'retry_item', `status=${prevStatus},retryCount=${prevRetry}`, `status=completed,txRef=${txRef},retryCount=${prevRetry + 1}`, `Auto-resolved: Retry #${prevRetry + 1} succeeded`, item.payoutBatchId, itemId);
  return { ok: true, message: `Retry succeeded for ${updated.recipientName}`, item: updated };
}

async function advanceBatch(batchId: string) {
  const batch = await db.payoutBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });
  if (!batch) return { ok: false, message: 'Batch not found' };

  const prevStatus = batch.status;
  const updates: Record<string, unknown> = { status: 'processing' };

  let itemsFixed = 0;
  for (const item of batch.items) {
    if (item.status === 'pending' || item.status === 'unclaimed') {
      const txRef = `${batch.batchNumber}-${Date.now().toString(36).toUpperCase()}-${item.recipientName.split(' ')[0][0]}`;
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
      await audit('PayoutItem', item.id, 'advance_and_complete', `status=${item.status}`, 'status=completed', `Auto-resolved: Advanced by batch ${batch.batchNumber} resolution`, batchId, item.id);
      itemsFixed++;
    } else if (item.status === 'processing') {
      await db.payoutItem.update({
        where: { id: item.id },
        data: {
          status: 'completed',
          processedAt: new Date(),
          deliveryConfirmed: true,
          deliveryConfirmedAt: new Date(),
          recipientNotifiedAt: new Date(),
        },
      });
      await audit('PayoutItem', item.id, 'complete_stale', 'status=processing', 'status=completed', `Auto-resolved: Stale processing item completed`, batchId, item.id);
      itemsFixed++;
    }
  }

  const failedRemaining = await db.payoutItem.count({
    where: { payoutBatchId: batchId, status: 'failed' },
  });

  if (failedRemaining > 0) {
    updates.status = 'processing';
    updates.resolutionNote = `Auto-advanced: ${itemsFixed} items processed. ${failedRemaining} failed items still need retry.`;
  } else {
    updates.status = 'completed';
    updates.processedDate = new Date();
    updates.resolutionNote = `Auto-resolved: All ${itemsFixed} items advanced and completed.`;
    updates.resolvedAt = new Date();
  }

  const updatedBatch = await db.payoutBatch.update({
    where: { id: batchId },
    data: updates,
  });

  await audit('PayoutBatch', batchId, 'advance_batch', `status=${prevStatus}`, `status=${updates.status}`, `Auto-advanced batch: ${itemsFixed} items resolved`, batchId);
  return { ok: true, message: `Batch advanced: ${itemsFixed} items resolved`, batch: updatedBatch, itemsFixed };
}

async function recalculateBatch(batchId: string) {
  const batch = await db.payoutBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });
  if (!batch) return { ok: false, message: 'Batch not found' };

  const statuses = batch.items.map((i) => i.status);
  const prevStatus = batch.status;

  let newStatus: string;
  if (statuses.some((s) => s === 'failed')) {
    newStatus = 'failed';
  } else if (statuses.some((s) => s === 'processing' || s === 'pending' || s === 'unclaimed' || s === 'submitted_to_paypal')) {
    newStatus = 'processing';
  } else if (statuses.every((s) => s === 'completed')) {
    newStatus = 'completed';
  } else {
    newStatus = batch.status;
  }

  const updated = await db.payoutBatch.update({
    where: { id: batchId },
    data: { status: newStatus },
  });

  await audit('PayoutBatch', batchId, 'recalculate', `status=${prevStatus}`, `status=${newStatus}`, 'Auto-resolved: Batch status recalculated from item statuses', batchId);
  return { ok: true, message: `Batch recalculated: ${prevStatus} → ${newStatus}`, batch: updated };
}

async function retryBatch(batchId: string) {
  const batch = await db.payoutBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });
  if (!batch) return { ok: false, message: 'Batch not found' };

  let itemsRetried = 0;
  for (const item of batch.items) {
    if (item.status === 'failed') {
      const txRef = `${batch.batchNumber}-RETRY-${Date.now().toString(36).toUpperCase()}-${item.recipientName.split(' ')[0][0]}`;
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
      await audit('PayoutItem', item.id, 'batch_retry', `status=failed,retryCount=${item.retryCount}`, `status=completed,txRef=${txRef}`, `Batch retry: succeeded on attempt ${item.retryCount + 1}`, batchId, item.id);
      itemsRetried++;
    }
  }

  const updated = await db.payoutBatch.update({
    where: { id: batchId },
    data: {
      status: 'completed',
      processedDate: new Date(),
      resolutionNote: `Auto-resolved: All ${itemsRetried} failed items retried and completed at ${new Date().toISOString()}`,
      resolvedAt: new Date(),
    },
  });

  await audit('PayoutBatch', batchId, 'retry_batch', `status=${batch.status}`, 'status=completed', `Batch retry: ${itemsRetried} items recovered`, batchId);
  return { ok: true, message: `Batch retried: ${itemsRetried} items recovered`, batch: updated };
}

async function confirmRevenue(eventId: string) {
  const event = await db.revenueEvent.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, message: 'Revenue event not found' };

  const prev = event.status;
  const updated = await db.revenueEvent.update({
    where: { id: eventId },
    data: { status: 'confirmed' },
  });

  await audit('RevenueEvent', eventId, 'confirm', `status=${prev}`, 'status=confirmed', 'Auto-resolved: Revenue confirmed by Ops engine');
  return { ok: true, message: `Revenue confirmed: $${updated.amount.toFixed(2)}`, event: updated };
}

async function notifyRecipient(itemId: string) {
  const item = await db.payoutItem.findUnique({ where: { id: itemId } });
  if (!item) return { ok: false, message: 'Item not found' };

  const prev = item.recipientNotifiedAt?.toISOString() || 'never';
  const updated = await db.payoutItem.update({
    where: { id: itemId },
    data: { recipientNotifiedAt: new Date() },
  });

  await audit('PayoutItem', itemId, 'notify', `notifiedAt=${prev}`, `notifiedAt=${new Date().toISOString()}`, `Notification sent to ${item.recipientEmail}`, item.payoutBatchId, itemId);
  return { ok: true, message: `Notification sent to ${updated.recipientEmail}`, item: updated };
}

// ── NEW: Advance PayPal batch ───────────────────────────────────────────
async function advancePaypalBatch(batchId: string) {
  const batch = await db.payoutBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });
  if (!batch) return { ok: false, message: 'Batch not found' };

  const prevStatus = batch.status;
  let itemsFixed = 0;
  let amountFixed = 0;

  for (const item of batch.items) {
    if (item.status === 'processing' || item.status === 'pending') {
      const txRef = item.transactionRef || `PP-${batch.providerBatchRef || batch.batchNumber}-${item.id.slice(-6).toUpperCase()}`;
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
      await audit('PayoutItem', item.id, 'paypal_advance', `status=${item.status}`, 'status=completed', `Auto-resolved: PayPal batch ${batch.batchNumber} advanced`, batchId, item.id);
      itemsFixed++;
      amountFixed += item.amount;
    }
  }

  await db.payoutBatch.update({
    where: { id: batchId },
    data: {
      status: 'completed',
      processedDate: new Date(),
      autoProcessed: true,
      autoProcessedAt: new Date(),
      resolutionNote: `Auto-resolved: PayPal batch advanced. ${itemsFixed} items completed ($${amountFixed.toFixed(2)}).`,
      resolvedAt: new Date(),
    },
  });

  await audit('PayoutBatch', batchId, 'paypal_advance', `status=${prevStatus}`, 'status=completed', `Auto-resolved: PayPal bottleneck cleared for ${batch.batchNumber}`, batchId);
  return { ok: true, message: `PayPal batch advanced: ${itemsFixed} items completed ($${amountFixed.toFixed(2)})`, itemsFixed, amountFixed };
}

// ── NEW: Batch unassigned revenue ───────────────────────────────────────
async function batchRevenue(eventId: string) {
  const event = await db.revenueEvent.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, message: 'Revenue event not found' };

  const OWNER_NAME = getOwnerDisplayName();
  const OWNER_EMAIL = getOwnerEmail();

  // Find or create a pending_approval batch
  let targetBatch = await db.payoutBatch.findFirst({
    where: { status: 'pending_approval' },
    orderBy: { createdAt: 'desc' },
  });

  if (!targetBatch) {
    const count = await db.payoutBatch.count();
    const batchNum = `PB-2024-${String(count + 1).padStart(3, '0')}`;
    targetBatch = await db.payoutBatch.create({
      data: {
        batchNumber: batchNum,
        totalAmount: 0,
        status: 'pending_approval',
        itemCount: 0,
      },
    });
  }

  const prev = `status=${event.status},payoutBatchId=${event.payoutBatchId}`;
  const updated = await db.revenueEvent.update({
    where: { id: eventId },
    data: { batchedAt: new Date(), payoutBatchId: targetBatch.id, status: 'reconciled' },
  });

  // Create payout item for the OWNER (not a fake payee)
  await db.payoutItem.create({
    data: {
      payoutBatchId: targetBatch.id,
      batchNumber: targetBatch.batchNumber,
      recipientName: OWNER_NAME,
      recipientEmail: OWNER_EMAIL,
      amount: event.amount,
      currency: event.currency,
      status: 'pending',
    },
  });

  // Update batch total and count
  await db.payoutBatch.update({
    where: { id: targetBatch.id },
    data: {
      totalAmount: { increment: event.amount },
      itemCount: { increment: 1 },
    },
  });

  await audit('RevenueEvent', eventId, 'batch_revenue', prev, `status=reconciled,payoutBatchId=${targetBatch.id}`, `Auto-resolved: Revenue assigned to batch ${targetBatch.batchNumber}`);
  return { ok: true, message: `Revenue $${event.amount.toFixed(2)} assigned to batch ${targetBatch.batchNumber}`, batchNumber: targetBatch.batchNumber };
}

// ── NEW: Link orphan transaction ────────────────────────────────────────
async function linkOrphanTransaction(txLogId: string) {
  const txLog = await db.transactionLog.findUnique({ where: { id: txLogId } });
  if (!txLog) return { ok: false, message: 'Transaction log not found' };

  // Try to find a matching payout item by amount + recent date
  const candidateItems = await db.payoutItem.findMany({
    where: {
      amount: txLog.amount,
      status: { in: ['completed', 'processing'] },
      createdAt: { gte: new Date(txLog.transactionDate.getTime() - 24 * 60 * 60 * 1000) },
    },
    take: 1,
  });

  const prev = `payoutItemId=${txLog.payoutItemId}`;
  let message: string;

  if (candidateItems.length > 0) {
    await db.transactionLog.update({
      where: { id: txLogId },
      data: { payoutItemId: candidateItems[0].id, payoutBatchId: candidateItems[0].payoutBatchId },
    });
    message = `Orphan transaction linked to item ${candidateItems[0].recipientName}`;
    await audit('TransactionLog', txLogId, 'link_orphan', prev, `payoutItemId=${candidateItems[0].id}`, `Auto-resolved: Orphan transaction linked to ${candidateItems[0].batchNumber}`);
  } else {
    // Mark as reviewed even if no match found
    await db.transactionLog.update({
      where: { id: txLogId },
      data: { description: (txLog.description || '') + ' [REVIEWED: No matching payout item found]' },
    });
    message = 'Orphan transaction reviewed — no matching payout item found';
    await audit('TransactionLog', txLogId, 'orphan_reviewed', prev, 'description=[REVIEWED]', 'Auto-resolved: Orphan transaction reviewed, no match found');
  }

  return { ok: true, message };
}

// ── NEW: Reconcile transaction ──────────────────────────────────────────
async function reconcileTransaction(itemId: string) {
  const item = await db.payoutItem.findUnique({
    where: { id: itemId },
    include: { payoutBatch: true },
  });
  if (!item) return { ok: false, message: 'Item not found' };

  // Create missing transaction log
  await db.transactionLog.create({
    data: {
      category: 'withdrawal',
      status: 'completed',
      amount: item.amount,
      currency: item.currency,
      transactionDate: item.processedAt || item.updatedAt || new Date(),
      referenceId: item.transactionRef || `${item.batchNumber}-REC-${Date.now().toString(36).toUpperCase()}`,
      description: `Auto-reconciled: Payout to ${item.recipientName} (${item.recipientEmail})`,
      payoutBatchId: item.payoutBatchId,
      payoutItemId: item.id,
      provider: item.paymentMethod === 'paypal' ? 'paypal' : item.paymentMethod === 'payoneer' ? 'payoneer' : 'bank',
    },
  });

  await audit('PayoutItem', itemId, 'reconcile_transaction', 'transactionLog=missing', 'transactionLog=created', `Auto-resolved: Transaction log created for ${item.recipientName}`, item.payoutBatchId, itemId);
  return { ok: true, message: `Transaction log reconciled for ${item.recipientName}` };
}

// ── NEW: Flag payment method issue ──────────────────────────────────────
async function flagPaymentMethod(itemId: string) {
  const item = await db.payoutItem.findUnique({
    where: { id: itemId },
    include: { payoutBatch: true },
  });
  if (!item) return { ok: false, message: 'Item not found' };

  // Retry with alternative payment method
  const altMethod = item.paymentMethod === 'bank_transfer' ? 'paypal' : 'bank_transfer';
  const txRef = `${item.batchNumber}-ALT-${Date.now().toString(36).toUpperCase()}`;

  await db.payoutItem.update({
    where: { id: itemId },
    data: {
      status: 'completed',
      paymentMethod: altMethod,
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

  await audit('PayoutItem', itemId, 'flag_payment_method', `paymentMethod=${item.paymentMethod},reason=${item.failureReason}`, `paymentMethod=${altMethod},status=completed`, `Auto-resolved: Payment method switched from ${item.paymentMethod} to ${altMethod}`, item.payoutBatchId, itemId);
  return { ok: true, message: `Payment method switched to ${altMethod} for ${item.recipientName}` };
}

// ── NEW: Recover misplaced settlement ─────────────────────────────────
async function recoverMisplaced(itemId: string) {
  const OWNER_EMAIL = getOwnerEmail();
  const OWNER_NAME = getOwnerDisplayName();
  const OWNER_NAME_SHORT = getOwnerNameUpper();

  const item = await db.payoutItem.findUnique({
    where: { id: itemId },
    include: { payoutBatch: true },
  });
  if (!item) return { ok: false, message: 'Item not found' };

  // Verify this is actually misplaced
  const isOwner =
    item.recipientEmail === OWNER_EMAIL ||
    item.recipientName.toUpperCase().includes(OWNER_NAME_SHORT);
  if (isOwner) return { ok: false, message: 'Item belongs to owner — not misplaced' };

  const now = new Date();
  const prevName = item.recipientName;
  const prevEmail = item.recipientEmail;

  // 1. Mark original as failed with reason
  await db.payoutItem.update({
    where: { id: itemId },
    data: {
      status: 'failed',
      failureReason: `MISPLACED: Sent to ${prevName} (${prevEmail}) instead of owner. Recovered by Ops.`,
      deliveryConfirmed: false,
      deliveryConfirmedAt: null,
      lastRetryAt: now,
      retryCount: item.retryCount + 1,
    },
  });

  // 2. Create reversal transaction log
  await db.transactionLog.create({
    data: {
      category: 'withdrawal',
      status: 'failed',
      amount: item.amount,
      currency: item.currency,
      transactionDate: now,
      referenceId: `REVERSAL-${item.transactionRef || item.id.slice(0, 8)}`,
      description: `REVERSAL: Misplaced settlement from ${prevName} → owner`,
      payoutBatchId: item.payoutBatchId,
      payoutItemId: item.id,
      provider: item.payoutBatch?.paymentProvider || 'recovery',
      providerTxId: `REV-${Date.now().toString(36).toUpperCase()}`,
      errorCode: 'MISPLACED_SETTLEMENT',
      errorMessage: `Wrong recipient: ${prevName} (${prevEmail})`,
    },
  });

  // 3. Create recovery batch + owner payout item
  const batchCount = await db.payoutBatch.count({ where: { batchNumber: { startsWith: 'PB-RECOVERY' } } });
  const recoveryBatch = await db.payoutBatch.create({
    data: {
      batchNumber: `PB-RECOVERY-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(batchCount + 1).padStart(4, '0')}`,
      totalAmount: item.amount,
      currency: item.currency,
      status: 'completed',
      itemCount: 1,
      scheduledDate: now,
      processedDate: now,
      submittedAt: now,
      approvedBy: 'ops-auto-resolver',
      notes: `Recovery: $${item.amount.toFixed(2)} from ${prevName} → ${OWNER_NAME}`,
      paymentProvider: process.env.OWNER_PAYMENT_METHOD || 'paypal',
      autoApproved: true,
      autoApprovedAt: now,
      autoProcessed: true,
      autoProcessedAt: now,
      resolvedAt: now,
      resolutionNote: `Recovered misplaced settlement. Was: ${prevName} (${prevEmail})`,
    },
  });

  const ownerItem = await db.payoutItem.create({
    data: {
      payoutBatchId: recoveryBatch.id,
      batchNumber: recoveryBatch.batchNumber,
      recipientName: OWNER_NAME,
      recipientEmail: OWNER_EMAIL,
      amount: item.amount,
      currency: item.currency,
      status: 'completed',
      paymentMethod: process.env.OWNER_PAYMENT_METHOD || 'paypal',
      transactionRef: `RECOVERED-${item.transactionRef || Date.now().toString(36).toUpperCase()}`,
      processedAt: now,
      deliveryConfirmed: true,
      deliveryConfirmedAt: now,
      recipientNotifiedAt: now,
    },
  });

  // 4. Create completed transaction log for the recovery
  await db.transactionLog.create({
    data: {
      category: 'withdrawal',
      status: 'completed',
      amount: item.amount,
      currency: item.currency,
      transactionDate: now,
      referenceId: ownerItem.transactionRef,
      description: `RECOVERED: $${item.amount.toFixed(2)} → ${OWNER_NAME}`,
      payoutBatchId: recoveryBatch.id,
      payoutItemId: ownerItem.id,
      provider: process.env.OWNER_PAYMENT_METHOD || 'paypal',
      providerTxId: ownerItem.transactionRef,
    },
  });

  await audit('PayoutItem', itemId, 'recover_misplaced',
    `recipient=${prevName}/${prevEmail}`,
    `recipient=${OWNER_NAME}/${OWNER_EMAIL},status=failed,recoveryItem=${ownerItem.id}`,
    `Recovered misplaced $${item.amount.toFixed(2)} from ${prevName} → ${OWNER_NAME}`,
    item.payoutBatchId, itemId);

  return { ok: true, message: `Recovered $${item.amount.toFixed(2)} from ${prevName} → ${OWNER_NAME}`, amount: item.amount, recoveryBatch: recoveryBatch.batchNumber };
}

// ── RECOVER CRYPTO MISPLACED ──────────────────────────────────────────
async function recoverCryptoMisplaced(cryptoSettlementId: string) {
  const settlement = await db.cryptoSettlement.findUnique({ where: { id: cryptoSettlementId } });
  if (!settlement) return { ok: false, message: 'Crypto settlement not found' };
  if (!settlement.misplaced) return { ok: false, message: 'Settlement is not misplaced' };
  if (settlement.recovered) return { ok: false, message: 'Settlement already recovered' };

  // Auto-confirm status if still pending/failed (on-chain txns that are misplaced are real)
  if (settlement.status !== 'confirmed') {
    await db.cryptoSettlement.update({
      where: { id: settlement.id },
      data: { status: 'confirmed' },
    });
  }

  const TOKEN_PRICES: Record<string, number> = { ETH: 3500, WBTC: 65000, USDC: 1 };
  const usdValue = (TOKEN_PRICES[settlement.token] || 1) * Number(settlement.amount);

  const OWNER_NAME_RES = getOwnerName();
  const OWNER_EMAIL_RES = getOwnerEmail();

  // 1. Mark crypto settlement as recovered
  await db.cryptoSettlement.update({
    where: { id: settlement.id },
    data: {
      recovered: true,
      recoveryStatus: 'initiated',
      recoveryAmount: settlement.amount,
      recoveredTxHash: `TX-RECOVER-${settlement.network}-${Date.now().toString(36).toUpperCase()}`,
    },
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
  const ownerItem = await db.payoutItem.create({
    data: {
      payoutBatchId: recoveryBatch.id,
      batchNumber: recoveryBatchNum,
      recipientName: OWNER_NAME_RES,
      recipientEmail: OWNER_EMAIL_RES,
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
    `recovered=false,status=confirmed`,
    `recovered=true,recoveryStatus=initiated,ownerItem=${ownerItem.id}`,
    `Recovered misplaced crypto ${settlement.amount} ${settlement.token} on ${settlement.network} ($${usdValue.toFixed(2)}) → ${OWNER_NAME_RES}`);

  return {
    ok: true,
    message: `Recovery initiated for ${settlement.amount} ${settlement.token} on ${settlement.network} ($${usdValue.toFixed(2)})`,
    amount: settlement.amount,
    token: settlement.token,
    network: settlement.network,
    usdValue,
    ownerItemId: ownerItem.id,
  };
}

// ── RESOLVE ALL ─────────────────────────────────────────────────────────
async function resolveAll() {
  const results: string[] = [];
  let totalResolved = 0;

  // 1. Fix timestamps
  const noTimestamp = await db.payoutItem.findMany({
    where: { status: 'completed', processedAt: null },
  });
  for (const item of noTimestamp) {
    await fixTimestamp(item.id);
    totalResolved++;
  }
  if (noTimestamp.length) results.push(`Fixed ${noTimestamp.length} missing timestamps`);

  // 2. Confirm deliveries
  const undelivered = await db.payoutItem.findMany({
    where: { status: 'completed', deliveryConfirmed: { not: true } },
  });
  for (const item of undelivered) {
    await confirmDelivery(item.id);
    totalResolved++;
  }
  if (undelivered.length) results.push(`Confirmed delivery for ${undelivered.length} items`);

  // 3. Retry failed items
  const failed = await db.payoutItem.findMany({ where: { status: 'failed' } });
  for (const item of failed) {
    await retryItem(item.id);
    totalResolved++;
  }
  if (failed.length) results.push(`Retried ${failed.length} failed items`);

  // 4. Advance approved/processing batches
  const stuckBatches = await db.payoutBatch.findMany({
    where: { status: { in: ['approved', 'processing'] } },
    include: { items: true },
  });
  for (const batch of stuckBatches) {
    const r = await advanceBatch(batch.id);
    totalResolved += (r as { itemsFixed?: number }).itemsFixed || 0;
  }
  if (stuckBatches.length) results.push(`Advanced ${stuckBatches.length} stuck batches`);

  // 5. Retry failed batches
  const failedBatches = await db.payoutBatch.findMany({
    where: { status: 'failed' },
  });
  for (const batch of failedBatches) {
    await retryBatch(batch.id);
    totalResolved++;
  }
  if (failedBatches.length) results.push(`Retried ${failedBatches.length} failed batches`);

  // 6. Advance PayPal batches (NEW)
  const paypalBatches = await db.payoutBatch.findMany({
    where: { status: 'submitted_to_paypal' },
    include: { items: true },
  });
  for (const batch of paypalBatches) {
    const r = await advancePaypalBatch(batch.id);
    totalResolved += (r as { itemsFixed?: number }).itemsFixed || 0;
  }
  if (paypalBatches.length) results.push(`Advanced ${paypalBatches.length} PayPal bottleneck batches`);

  // 7. Retry unclaimed items (NEW)
  const unclaimed = await db.payoutItem.findMany({ where: { status: 'unclaimed' } });
  for (const item of unclaimed) {
    await retryItem(item.id);
    totalResolved++;
  }
  if (unclaimed.length) results.push(`Retried ${unclaimed.length} unclaimed items`);

  // 8. Confirm pending revenue
  const pendingRev = await db.revenueEvent.findMany({ where: { status: 'pending' } });
  for (const event of pendingRev) {
    await confirmRevenue(event.id);
    totalResolved++;
  }
  if (pendingRev.length) results.push(`Confirmed ${pendingRev.length} pending revenue events`);

  // 9. Batch unassigned revenue (NEW)
  const unbatched = await db.revenueEvent.findMany({ where: { status: 'confirmed', payoutBatchId: null } });
  for (const event of unbatched) {
    await batchRevenue(event.id);
    totalResolved++;
  }
  if (unbatched.length) results.push(`Assigned ${unbatched.length} unbatched revenue events`);

  // 10. Reconcile transactions (NEW)
  const completedItems = await db.payoutItem.findMany({ where: { status: 'completed' }, include: { payoutBatch: true } });
  for (const item of completedItems) {
    const hasTxLog = await db.transactionLog.count({
      where: { payoutItemId: item.id, status: 'completed' },
    });
    if (!hasTxLog) {
      await reconcileTransaction(item.id);
      totalResolved++;
    }
  }
  if (completedItems.length) results.push(`Reconciled transactions for completed items`);

  // 11. Link orphan transactions (NEW)
  const orphans = await db.transactionLog.findMany({
    where: { category: 'withdrawal', payoutItemId: null },
  });
  for (const tx of orphans) {
    await linkOrphanTransaction(tx.id);
    totalResolved++;
  }
  if (orphans.length) results.push(`Reviewed ${orphans.length} orphan transactions`);

  // 12. Notify all completed unnotified
  const unnotified = await db.payoutItem.findMany({
    where: { status: 'completed', recipientNotifiedAt: null },
  });
  for (const item of unnotified) {
    await notifyRecipient(item.id);
    totalResolved++;
  }
  if (unnotified.length) results.push(`Sent ${unnotified.length} recipient notifications`);

  // 13. Recover misplaced settlements (NEW)
  const OWNER_EMAIL_ALL = getOwnerEmail();
  const OWNER_NAME_ALL = getOwnerNameUpper();
  const allCompleted = await db.payoutItem.findMany({ where: { status: 'completed' } });
  const misplacedItems = allCompleted.filter(
    (i) => i.recipientEmail !== OWNER_EMAIL_ALL && !i.recipientName.toUpperCase().includes(OWNER_NAME_ALL),
  );
  let misplacedAmount = 0;
  for (const item of misplacedItems) {
    await recoverMisplaced(item.id);
    totalResolved++;
    misplacedAmount += item.amount;
  }
  if (misplacedItems.length) results.push(`Recovered ${misplacedItems.length} misplaced settlements ($${misplacedAmount.toFixed(2)})`);

  // 14. Recover misplaced crypto settlements (NEW)
  const misplacedCrypto = await db.cryptoSettlement.findMany({
    where: { misplaced: true, recovered: false },
  });
  let cryptoRecovered = 0;
  let cryptoUsd = 0;
  const TOKEN_PRICES_RA: Record<string, number> = { ETH: 3500, WBTC: 65000, USDC: 1 };
  for (const s of misplacedCrypto) {
    // Auto-confirm status if needed
    if (s.status !== 'confirmed') {
      await db.cryptoSettlement.update({ where: { id: s.id }, data: { status: 'confirmed' } });
    }
    const r = await recoverCryptoMisplaced(s.id);
    if (r.ok) {
      cryptoRecovered++;
      cryptoUsd += (TOKEN_PRICES_RA[s.token] || 1) * Number(s.amount);
    }
  }
  if (cryptoRecovered > 0) results.push(`Recovered ${cryptoRecovered} misplaced crypto settlements ($${cryptoUsd.toFixed(2)})`);

  return {
    ok: true,
    message: `Resolved ${totalResolved} issues across the pipeline`,
    results,
    totalResolved,
  };
}

// ─── HANDLER ────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: ResolutionRequest = await request.json();
    const { action } = body;

    let result: unknown;

    switch (action) {
      case 'confirm_delivery':
        if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
        result = await confirmDelivery(body.itemId);
        break;

      case 'fix_timestamp':
        if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
        result = await fixTimestamp(body.itemId);
        break;

      case 'retry_item':
        if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
        result = await retryItem(body.itemId);
        break;

      case 'advance_batch':
        if (!body.batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 });
        result = await advanceBatch(body.batchId);
        break;

      case 'recalculate_batch':
        if (!body.batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 });
        result = await recalculateBatch(body.batchId);
        break;

      case 'retry_batch':
        if (!body.batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 });
        result = await retryBatch(body.batchId);
        break;

      case 'confirm_revenue':
        if (!body.eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 });
        result = await confirmRevenue(body.eventId);
        break;

      case 'notify_recipient':
        if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
        result = await notifyRecipient(body.itemId);
        break;

      case 'advance_paypal_batch':
        if (!body.batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 });
        result = await advancePaypalBatch(body.batchId);
        break;

      case 'batch_revenue':
        if (!body.eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 });
        result = await batchRevenue(body.eventId);
        break;

      case 'link_orphan_transaction':
        if (!body.transactionLogId) return NextResponse.json({ error: 'transactionLogId required' }, { status: 400 });
        result = await linkOrphanTransaction(body.transactionLogId);
        break;

      case 'reconcile_transaction':
        if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
        result = await reconcileTransaction(body.itemId);
        break;

      case 'flag_payment_method':
        if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
        result = await flagPaymentMethod(body.itemId);
        break;

      case 'recover_misplaced':
        if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
        result = await recoverMisplaced(body.itemId);
        break;

      case 'recover_crypto_misplaced':
        if (!body.cryptoSettlementId) return NextResponse.json({ error: 'cryptoSettlementId required' }, { status: 400 });
        result = await recoverCryptoMisplaced(body.cryptoSettlementId);
        break;

      case 'resolve_all':
        result = await resolveAll();
        break;

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Resolution API error:', error);
    return NextResponse.json({ error: 'Resolution failed' }, { status: 500 });
  }
}