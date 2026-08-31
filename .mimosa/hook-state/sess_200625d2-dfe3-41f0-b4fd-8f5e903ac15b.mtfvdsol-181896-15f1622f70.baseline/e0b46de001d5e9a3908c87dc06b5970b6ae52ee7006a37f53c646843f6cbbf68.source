import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { tryGetOwnerName, tryGetOwnerEmail, tryGetOwnerNameUpper, getConfiguredWallets } from '@/lib/owner-config'

// ─── DIAGNOSTIC ENGINE ───────────────────────────────────────────────────────
// Full pipeline scan that detects every blockage, bottleneck, and anomaly.
// 17-category diagnostic covering revenue, batches, items, transactions, crypto.
// Each issue is categorized by severity and entity type.


interface Issue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  entityType: 'batch' | 'item' | 'revenue' | 'pipeline' | 'transaction';
  entityId: string;
  entityLabel: string;
  amount?: number;
  actionable: boolean;
  resolutionAction?: string;
  resolutionParams?: Record<string, string>;
}

const NOW = new Date();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const STALE_PROCESSING_THRESHOLD = 24 * HOUR;  // Items processing > 24h
const STALE_APPROVED_THRESHOLD = 4 * HOUR;      // Approved batches not advancing > 4h
const PAYPAL_STALE_THRESHOLD = 2 * HOUR;        // PayPal batches submitted > 2h

// Health score weights
const SEVERITY_WEIGHTS = { critical: 15, high: 8, medium: 3, low: 1 } as const;

export async function GET() {
  try {
    const issues: Issue[] = [];

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 1: Completed items WITHOUT delivery confirmation
    // ══════════════════════════════════════════════════════════════════════════
    const completedUndelivered = await db.payoutItem.findMany({
      where: {
        status: 'completed',
        deliveryConfirmed: { not: true },
      },
    });

    for (const item of completedUndelivered) {
      const daysSinceProcessed = item.processedAt
        ? Math.floor((NOW.getTime() - item.processedAt.getTime()) / DAY)
        : null;

      issues.push({
        id: `undelivered-${item.id}`,
        severity: 'critical',
        category: 'Delivery Failure',
        title: 'Completed payout not received by recipient',
        description: `${item.recipientName} (${item.recipientEmail}) — $${item.amount.toFixed(2)} marked completed${item.processedAt ? ` on ${item.processedAt.toISOString().split('T')[0]}` : ''} but delivery not confirmed.${daysSinceProcessed ? ` Stale for ${daysSinceProcessed} day(s).` : ' No processedAt timestamp found.'}`,
        entityType: 'item',
        entityId: item.id,
        entityLabel: `${item.recipientName} — ${item.batchNumber}`,
        amount: item.amount,
        actionable: true,
        resolutionAction: 'confirm_delivery',
        resolutionParams: { itemId: item.id },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 2: Completed items WITHOUT processedAt timestamp
    // ══════════════════════════════════════════════════════════════════════════
    const completedNoTimestamp = await db.payoutItem.findMany({
      where: {
        status: 'completed',
        processedAt: null,
      },
    });

    for (const item of completedNoTimestamp) {
      // Avoid duplicate if already caught above
      if (!item.deliveryConfirmed) {
        issues.push({
          id: `no-timestamp-${item.id}`,
          severity: 'high',
          category: 'Data Integrity',
          title: 'Completed item missing processedAt timestamp',
          description: `${item.recipientName} — $${item.amount.toFixed(2)} in ${item.batchNumber} marked completed without a processedAt timestamp. Cannot determine when payment was sent.`,
          entityType: 'item',
          entityId: item.id,
          entityLabel: `${item.recipientName} — ${item.batchNumber}`,
          amount: item.amount,
          actionable: true,
          resolutionAction: 'fix_timestamp',
          resolutionParams: { itemId: item.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 3: Items stuck in "processing" too long (>24h)
    // ══════════════════════════════════════════════════════════════════════════
    const processingItems = await db.payoutItem.findMany({
      where: { status: 'processing' },
      include: { payoutBatch: { select: { batchNumber: true, status: true } } },
    });

    for (const item of processingItems) {
      const staleForMs = NOW.getTime() - item.createdAt.getTime();
      const staleForHours = Math.floor(staleForMs / HOUR);

      if (staleForMs > STALE_PROCESSING_THRESHOLD) {
        issues.push({
          id: `stale-processing-${item.id}`,
          severity: 'high',
          category: 'Stale Processing',
          title: `Item processing for ${staleForHours}h+ — stuck`,
          description: `${item.recipientName} — $${item.amount.toFixed(2)} in batch ${item.payoutBatch.batchNumber} has been in "processing" status for ${staleForHours} hours. Banking partner may have silently failed.${item.transactionRef ? ` Transaction ref: ${item.transactionRef}` : ' No transaction ref assigned.'}`,
          entityType: 'item',
          entityId: item.id,
          entityLabel: `${item.recipientName} — ${item.payoutBatch.batchNumber}`,
          amount: item.amount,
          actionable: true,
          resolutionAction: 'retry_item',
          resolutionParams: { itemId: item.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 4: Failed items with no retry
    // ══════════════════════════════════════════════════════════════════════════
    const failedItems = await db.payoutItem.findMany({
      where: { status: 'failed' },
      include: { payoutBatch: { select: { batchNumber: true, status: true } } },
    });

    for (const item of failedItems) {
      // Skip items flagged with MISPLACED prefix (fiat settlements sent to wrong recipient in PB-2024-009)
      if ((item.failureReason || '').startsWith('MISPLACED:')) continue;
      // Skip crypto items — they're handled by Category 17
      if (item.paymentMethod.startsWith('crypto')) continue;

      issues.push({
        id: `failed-no-retry-${item.id}`,
        severity: 'high',
        category: 'Unresolved Failure',
        title: `Failed payout — ${item.failureReason || 'Unknown reason'}`,
        description: `${item.recipientName} — $${item.amount.toFixed(2)} in batch ${item.payoutBatch.batchNumber} failed: "${item.failureReason}". Retries: ${item.retryCount}. Payment method: ${item.paymentMethod}.`,
        entityType: 'item',
        entityId: item.id,
        entityLabel: `${item.recipientName} — ${item.payoutBatch.batchNumber}`,
        amount: item.amount,
        actionable: true,
        resolutionAction: 'retry_item',
        resolutionParams: { itemId: item.id },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 5: Approved batches NOT advancing to processing
    // ══════════════════════════════════════════════════════════════════════════
    const approvedBatches = await db.payoutBatch.findMany({
      where: { status: 'approved' },
      include: {
        items: { select: { id: true, status: true } },
      },
    });

    for (const batch of approvedBatches) {
      const pendingItems = batch.items.filter((i) => i.status === 'pending').length;
      const staleForMs = batch.updatedAt ? NOW.getTime() - batch.updatedAt.getTime() : 0;

      if (pendingItems > 0 || staleForMs > STALE_APPROVED_THRESHOLD) {
        issues.push({
          id: `stale-approved-${batch.id}`,
          severity: 'critical',
          category: 'Pipeline Bottleneck',
          title: `Approved batch stuck — ${pendingItems} items never started`,
          description: `Batch ${batch.batchNumber} ($${batch.totalAmount.toFixed(2)}) was approved by ${batch.approvedBy || 'unknown'} but ${pendingItems} items are still "pending". No processing was initiated. This is the primary bottleneck preventing payouts from reaching recipients.`,
          entityType: 'batch',
          entityId: batch.id,
          entityLabel: batch.batchNumber,
          amount: batch.totalAmount,
          actionable: true,
          resolutionAction: 'advance_batch',
          resolutionParams: { batchId: batch.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 6: Batch status inconsistency with item statuses
    // ══════════════════════════════════════════════════════════════════════════
    const allBatches = await db.payoutBatch.findMany({
      include: {
        items: { select: { id: true, status: true, failureReason: true, paymentMethod: true, recipientName: true, recipientEmail: true } },
      },
    });

    for (const batch of allBatches) {
      const itemStatuses = batch.items.map((i) => i.status);
      const uniqueStatuses = [...new Set(itemStatuses)];

      // Batch marked "completed" but has non-completed items
      if (batch.status === 'completed' && !itemStatuses.every((s) => s === 'completed')) {
        // Skip if all non-completed items are misplaced (fiat PB-2024-009) or crypto-origin items
        const nonCompletedItems = batch.items.filter((i) => i.status !== 'completed');
        const allMisplacedOrCrypto = nonCompletedItems.length > 0 &&
          nonCompletedItems.every((i) =>
            (i.failureReason || '').startsWith('MISPLACED:') ||
            (i.failureReason || '').startsWith('CRYPTO_') ||
            (i.paymentMethod || '').startsWith('crypto_')
          );
        if (allMisplacedOrCrypto) continue;

        const nonCompleted = itemStatuses.filter((s) => s !== 'completed').length;
        issues.push({
          id: `batch-mismatch-${batch.id}`,
          severity: 'medium',
          category: 'Status Inconsistency',
          title: `Batch marked completed but ${nonCompleted} item(s) not completed`,
          description: `Batch ${batch.batchNumber} status is "completed" but contains items with status: ${uniqueStatuses.join(', ')}. Batch status should reflect the worst item status.`,
          entityType: 'batch',
          entityId: batch.id,
          entityLabel: batch.batchNumber,
          actionable: true,
          resolutionAction: 'recalculate_batch',
          resolutionParams: { batchId: batch.id },
        });
      }

      // Batch "processing" but has pending items that were never started
      if (batch.status === 'processing') {
        const pendingItems = batch.items.filter((i) => i.status === 'pending').length;
        if (pendingItems > 0) {
          issues.push({
            id: `batch-processing-pending-${batch.id}`,
            severity: 'medium',
            category: 'Status Inconsistency',
            title: `Batch processing but ${pendingItems} item(s) never started`,
            description: `Batch ${batch.batchNumber} is in "processing" but has ${pendingItems} items still in "pending" status. These items need to be advanced to processing.`,
            entityType: 'batch',
            entityId: batch.id,
            entityLabel: batch.batchNumber,
            amount: batch.totalAmount,
            actionable: true,
            resolutionAction: 'advance_batch',
            resolutionParams: { batchId: batch.id },
          });
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 7: Failed batch with no resolution note
    // ══════════════════════════════════════════════════════════════════════════
    const failedBatches = await db.payoutBatch.findMany({
      where: {
        status: 'failed',
        resolutionNote: null,
      },
    });

    for (const batch of failedBatches) {
      const failedItemCount = batch.itemCount;
      issues.push({
        id: `failed-batch-norex-${batch.id}`,
        severity: 'medium',
        category: 'Unresolved Failure',
        title: `Failed batch has no resolution plan`,
        description: `Batch ${batch.batchNumber} ($${batch.totalAmount.toFixed(2)}) failed with ${failedItemCount} items. No resolution note or retry has been documented.`,
        entityType: 'batch',
        entityId: batch.id,
        entityLabel: batch.batchNumber,
        amount: batch.totalAmount,
        actionable: true,
        resolutionAction: 'retry_batch',
        resolutionParams: { batchId: batch.id },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 8: Revenue events stuck in pending
    // ══════════════════════════════════════════════════════════════════════════
    const pendingRevenue = await db.revenueEvent.findMany({
      where: { status: 'pending' },
    });

    for (const event of pendingRevenue) {
      issues.push({
        id: `pending-rev-${event.id}`,
        severity: 'low',
        category: 'Revenue Stuck',
        title: `Revenue event pending — not yet confirmed`,
        description: `${event.source}: $${event.amount.toFixed(2)} — "${event.description}". Pending revenue cannot be included in payout batches until confirmed or reconciled.`,
        entityType: 'revenue',
        entityId: event.id,
        entityLabel: event.referenceId || event.description || 'Unknown',
        amount: event.amount,
        actionable: true,
        resolutionAction: 'confirm_revenue',
        resolutionParams: { eventId: event.id },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 9: Recipients never notified
    // ══════════════════════════════════════════════════════════════════════════
    const completedNotified = await db.payoutItem.findMany({
      where: {
        status: 'completed',
        recipientNotifiedAt: null,
      },
    });

    for (const item of completedNotified) {
      // Only add if not already captured by undelivered
      const alreadyCaptured = issues.some((i) => i.entityId === item.id && i.severity === 'critical');
      if (!alreadyCaptured) {
        issues.push({
          id: `not-notified-${item.id}`,
          severity: 'low',
          category: 'Missing Notification',
          title: 'Recipient never notified of payout',
          description: `${item.recipientName} (${item.recipientEmail}) — $${item.amount.toFixed(2)} completed but no notification sent. Recipient may not know funds were sent.`,
          entityType: 'item',
          entityId: item.id,
          entityLabel: `${item.recipientName} — ${item.batchNumber}`,
          amount: item.amount,
          actionable: true,
          resolutionAction: 'notify_recipient',
          resolutionParams: { itemId: item.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 10: Revenue Reconciliation
    // Confirmed revenue events NOT assigned to any payout batch.
    // These are "confirmed revenue not yet paid out".
    // ══════════════════════════════════════════════════════════════════════════
    const unbatchedConfirmedRevenue = await db.revenueEvent.findMany({
      where: {
        status: 'confirmed',
        payoutBatchId: null,
      },
    });

    for (const event of unbatchedConfirmedRevenue) {
      issues.push({
        id: `unbatched-rev-${event.id}`,
        severity: 'high',
        category: 'Revenue Reconciliation',
        title: 'Confirmed revenue not yet paid out',
        description: `${event.source}: $${event.amount.toFixed(2)} — "${event.description}" is confirmed but not assigned to any payout batch. This revenue has been validated but is sitting idle in the reconciliation queue.`,
        entityType: 'revenue',
        entityId: event.id,
        entityLabel: event.referenceId || event.description || `${event.source} — $${event.amount.toFixed(2)}`,
        amount: event.amount,
        actionable: true,
        resolutionAction: 'batch_revenue',
        resolutionParams: { eventId: event.id },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 11: PayPal Bottleneck
    // Payout batches with status "submitted_to_paypal" submitted > 2h ago.
    // Also flags if the batch has items still in "processing".
    // ══════════════════════════════════════════════════════════════════════════
    const paypalSubmittedBatches = await db.payoutBatch.findMany({
      where: {
        status: 'submitted_to_paypal',
        submittedAt: { not: null },
      },
      include: {
        items: { select: { id: true, status: true } },
      },
    });

    for (const batch of paypalSubmittedBatches) {
      if (!batch.submittedAt) continue;

      const submittedAgoMs = NOW.getTime() - batch.submittedAt.getTime();
      const submittedAgoHours = Math.floor(submittedAgoMs / HOUR);

      if (submittedAgoMs > PAYPAL_STALE_THRESHOLD) {
        const processingItems = batch.items.filter((i) => i.status === 'processing').length;
        const extraDetail = processingItems > 0
          ? ` Additionally, ${processingItems} item(s) are still in "processing" status within this batch, indicating PayPal may not have acknowledged the submission.`
          : '';

        issues.push({
          id: `paypal-bottleneck-${batch.id}`,
          severity: 'critical',
          category: 'PayPal Bottleneck',
          title: `PayPal batch submitted ${submittedAgoHours}h+ ago — no response`,
          description: `Batch ${batch.batchNumber} ($${batch.totalAmount.toFixed(2)}) was submitted to PayPal on ${batch.submittedAt.toISOString().split('T')[0]} at ${batch.submittedAt.toISOString().split('T')[1]?.substring(0, 5)} UTC (${submittedAgoHours}h ago) but has not advanced.${extraDetail} Provider batch ref: ${batch.providerBatchRef || 'none'}. PayPal may be experiencing delays or the submission may have failed silently.`,
          entityType: 'batch',
          entityId: batch.id,
          entityLabel: batch.batchNumber,
          amount: batch.totalAmount,
          actionable: true,
          resolutionAction: 'advance_paypal_batch',
          resolutionParams: { batchId: batch.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 12: Unclaimed Payouts
    // Payout items with status "unclaimed" — funds sent but recipient hasn't
    // claimed them yet.
    // ══════════════════════════════════════════════════════════════════════════
    const unclaimedItems = await db.payoutItem.findMany({
      where: { status: 'unclaimed' },
      include: { payoutBatch: { select: { batchNumber: true, status: true } } },
    });

    for (const item of unclaimedItems) {
      const daysUnclaimed = Math.floor((NOW.getTime() - item.updatedAt.getTime()) / DAY);
      issues.push({
        id: `unclaimed-${item.id}`,
        severity: 'high',
        category: 'Unclaimed Payout',
        title: 'Payout unclaimed by recipient',
        description: `${item.recipientName} (${item.recipientEmail}) — $${item.amount.toFixed(2)} in batch ${item.payoutBatch.batchNumber} has status "unclaimed".${daysUnclaimed > 0 ? ` Last updated ${daysUnclaimed} day(s) ago.` : ''} The payment was sent but the recipient has not claimed it. This may require a reminder or alternative payment method.`,
        entityType: 'item',
        entityId: item.id,
        entityLabel: `${item.recipientName} — ${item.payoutBatch.batchNumber}`,
        amount: item.amount,
        actionable: true,
        resolutionAction: 'retry_item',
        resolutionParams: { itemId: item.id },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 13: Orphan Transactions
    // TransactionLog entries with category "withdrawal" that have NO matching
    // payout item (payoutItemId is null) OR have a payoutItemId that doesn't
    // match any PayoutItem id.
    // ══════════════════════════════════════════════════════════════════════════
    const withdrawalLogs = await db.transactionLog.findMany({
      where: { category: 'withdrawal' },
    });

    // Collect all valid payout item IDs for fast lookup
    const allPayoutItemIds = new Set(
      (await db.payoutItem.findMany({ select: { id: true } })).map((p) => p.id),
    );

    for (const txLog of withdrawalLogs) {
      // Skip already-reviewed orphan transactions
      if (txLog.description?.includes('[REVIEWED:')) continue;

      const isNullRef = !txLog.payoutItemId;
      const isDanglingRef = txLog.payoutItemId && !allPayoutItemIds.has(txLog.payoutItemId);

      if (isNullRef || isDanglingRef) {
        const reason = isNullRef
          ? 'payoutItemId is null — transaction not linked to any payout item'
          : `payoutItemId "${txLog.payoutItemId}" does not match any PayoutItem record — dangling reference`;

        issues.push({
          id: `orphan-tx-${txLog.id}`,
          severity: 'medium',
          category: 'Orphan Transaction',
          title: 'Withdrawal transaction has no matching payout item',
          description: `TransactionLog ${txLog.referenceId || txLog.id}: $${txLog.amount.toFixed(2)} (${txLog.status}) on ${txLog.transactionDate.toISOString().split('T')[0]}. ${reason}. Provider: ${txLog.provider || 'unknown'}.${txLog.errorCode ? ` Error code: ${txLog.errorCode}.` : ''}`,
          entityType: 'transaction',
          entityId: txLog.id,
          entityLabel: txLog.referenceId || `TX-${txLog.id.substring(0, 8)}`,
          amount: txLog.amount,
          actionable: true,
          resolutionAction: 'link_orphan_transaction',
          resolutionParams: { transactionLogId: txLog.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 14: Transaction Mismatch
    // Cross-reference PayoutItems vs TransactionLog entries:
    //   A) PayoutItems marked "completed" with NO matching TransactionLog
    //      entry with status "completed"
    //   B) TransactionLog entries marked "completed" whose matching
    //      PayoutItem is NOT "completed"
    // ══════════════════════════════════════════════════════════════════════════

    // 14A: Completed PayoutItems without a completed TransactionLog
    const allCompletedItems = await db.payoutItem.findMany({
      where: { status: 'completed' },
      include: { payoutBatch: { select: { batchNumber: true } } },
    });

    for (const item of allCompletedItems) {
      // Skip crypto items — they're handled by Category 17
      if (item.paymentMethod.startsWith('crypto')) continue;
      // Skip misplaced settlement items (fiat PB-2024-009) — they require separate recovery
      const _ownerName14 = tryGetOwnerName()
      const _ownerEmail14 = tryGetOwnerEmail()
      if (!_ownerName14 || !_ownerEmail14) continue; // owner not configured — skip
      const isOwnerItem = item.recipientName === _ownerName14 || item.recipientEmail === _ownerEmail14
      if (!isOwnerItem) continue;
      // Skip recovery/reconcile/orphan batch items — created by auto-pilot, TX logs not applicable
      const bn = (item.batchNumber || '').toUpperCase();
      const tr = (item.transactionRef || '').toUpperCase();
      if (bn.includes('RECOVERY') || bn.includes('ORPHAN') || bn.includes('RECONCILE')) continue;
      if (tr.includes('REV-') || tr.includes('RECOVERED-') || tr.startsWith('CRYPTO-RECOVERY')) continue;

      const matchingTxLog = await db.transactionLog.findFirst({
        where: {
          payoutItemId: item.id,
          status: 'completed',
        },
      });

      if (!matchingTxLog) {
        issues.push({
          id: `tx-mismatch-item-${item.id}`,
          severity: 'critical',
          category: 'Transaction Mismatch',
          title: 'Completed payout has no completed transaction log',
          description: `${item.recipientName} — $${item.amount.toFixed(2)} in batch ${item.payoutBatch.batchNumber} is marked "completed" but has no corresponding TransactionLog entry with status "completed".${item.transactionRef ? ` Transaction ref: ${item.transactionRef}.` : ''} This indicates the payout system and ledger are out of sync — the item may not have actually been processed by the payment provider.`,
          entityType: 'item',
          entityId: item.id,
          entityLabel: `${item.recipientName} — ${item.payoutBatch.batchNumber}`,
          amount: item.amount,
          actionable: true,
          resolutionAction: 'reconcile_transaction',
          resolutionParams: { itemId: item.id },
        });
      }
    }

    // 14B: Completed TransactionLogs whose PayoutItem is NOT completed
    const completedTxLogs = await db.transactionLog.findMany({
      where: {
        status: 'completed',
        payoutItemId: { not: null },
      },
    });

    for (const txLog of completedTxLogs) {
      if (!txLog.payoutItemId) continue;

      // Skip reconciliation artifacts (reversal/recovered TX logs from settlement recovery)
      if (
        txLog.errorCode === 'MISPLACED_SETTLEMENT' ||
        (txLog.description || '').includes('REVERSAL:') ||
        (txLog.description || '').includes('RECOVERED:')
      ) continue;

      const matchingItem = await db.payoutItem.findUnique({
        where: { id: txLog.payoutItemId },
      });

      if (matchingItem && matchingItem.status !== 'completed') {
        issues.push({
          id: `tx-mismatch-tx-${txLog.id}`,
          severity: 'critical',
          category: 'Transaction Mismatch',
          title: 'Completed transaction log has non-completed payout item',
          description: `TransactionLog ${txLog.referenceId || txLog.id}: $${txLog.amount.toFixed(2)} is marked "completed" in the ledger, but the corresponding PayoutItem (${matchingItem.recipientName} in ${matchingItem.batchNumber}) has status "${matchingItem.status}". The item status should be updated to "completed" to match the confirmed transaction.`,
          entityType: 'transaction',
          entityId: txLog.id,
          entityLabel: txLog.referenceId || `TX-${txLog.id.substring(0, 8)}`,
          amount: txLog.amount,
          actionable: true,
          resolutionAction: 'reconcile_transaction',
          resolutionParams: { itemId: matchingItem.id, transactionLogId: txLog.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 15: Payment Method Issues
    // Failed items where failureReason contains keywords indicating payment
    // method problems that won't be fixed by simple retry.
    // ══════════════════════════════════════════════════════════════════════════
    const PAYMENT_METHOD_KEYWORDS = [
      'insufficient',
      'invalid_account',
      'account_closed',
      'restricted',
    ];

    for (const item of failedItems) {
      // Skip misplaced fiat items (PB-2024-009 scenario — handled by Category 16)
      if ((item.failureReason || '').startsWith('MISPLACED:')) continue;
      // Skip crypto items — they're handled by Category 17
      if (item.paymentMethod.startsWith('crypto')) continue;

      const failureLower = (item.failureReason || '').toLowerCase();
      const matchedKeyword = PAYMENT_METHOD_KEYWORDS.find((kw) =>
        failureLower.includes(kw),
      );

      if (matchedKeyword) {
        const humanKeyword = matchedKeyword.replace(/_/g, ' ');
        issues.push({
          id: `payment-method-${item.id}`,
          severity: 'high',
          category: 'Payment Method Issue',
          title: `Payment method problem: ${humanKeyword}`,
          description: `${item.recipientName} (${item.recipientEmail}) — $${item.amount.toFixed(2)} in ${item.batchNumber} failed due to "${item.failureReason}". The keyword "${humanKeyword}" indicates a payment method issue (e.g., closed account, insufficient funds, restricted account). Simple retry will NOT fix this — recipient must update their payment information.`,
          entityType: 'item',
          entityId: item.id,
          entityLabel: `${item.recipientName} — ${item.batchNumber}`,
          amount: item.amount,
          actionable: true,
          resolutionAction: 'flag_payment_method',
          resolutionParams: { itemId: item.id },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
  // CATEGORY 16: Misplaced Settlements
  // Completed payout items where recipient is NOT the configured owner.
  // This catches settlements sent to the wrong person by error.
  // ══════════════════════════════════════════════════════════════════════════
  const ownerEmailLocal = tryGetOwnerEmail()
  const ownerNameUpper = tryGetOwnerNameUpper()
  if (!ownerEmailLocal || !ownerNameUpper) {
    // Owner not configured — skip Category 16 & 17 gracefully
  } else {

  const completedPayoutItems = await db.payoutItem.findMany({
    where: { status: 'completed' },
    include: { payoutBatch: { select: { batchNumber: true, status: true, paymentProvider: true } } },
  });

  for (const item of completedPayoutItems) {
    // Skip crypto items — they're handled by Category 17
    if (item.paymentMethod.startsWith('crypto')) continue;

    const isOwner =
      item.recipientEmail === ownerEmailLocal ||
      item.recipientName.toUpperCase().includes(ownerNameUpper);

    if (!isOwner) {
      issues.push({
        id: `misplaced-${item.id}`,
        severity: 'critical',
        category: 'Misplaced Settlement',
        title: `Settlement sent to wrong recipient`,
        description: `$${item.amount.toFixed(2)} was sent to ${item.recipientName} (${item.recipientEmail}) via ${item.paymentMethod} instead of the owner (${ownerEmailLocal}). Transaction: ${item.transactionRef || 'none'}. Batch: ${item.payoutBatch.batchNumber}. Funds must be recovered and re-issued to the correct owner.`,
        entityType: 'item',
        entityId: item.id,
        entityLabel: `${item.recipientName} — ${item.payoutBatch.batchNumber} (WRONG RECIPIENT)`,
        amount: item.amount,
        actionable: true,
        resolutionAction: 'recover_misplaced',
        resolutionParams: { itemId: item.id },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CATEGORY 17: Crypto Routing Anomalies
  // Owner wallets pre-configured from day 1. Verify each settlement's
  // recipient against the owner wallet for that network.
  // ══════════════════════════════════════════════════════════════════════════
  const CRYPTO_OWNER_WALLETS = getConfiguredWallets();

  const TOKEN_PRICES: Record<string, number> = { ETH: 3500, WBTC: 65000, USDC: 1 };

  // Fetch ALL crypto settlements and compare each recipient against the owner wallet
  const allCryptoSettlements = await db.cryptoSettlement.findMany();

  // Group anomalies by network
  const anomaliesByNetwork: Record<string, typeof allCryptoSettlements> = {};
  for (const s of allCryptoSettlements) {
    const net = s.network.toLowerCase();
    const ownerWallet = CRYPTO_OWNER_WALLETS[net];
    // If no owner wallet configured for this network, skip
    if (!ownerWallet) continue;
    // If no recipient address on the settlement, skip
    if (!s.recipientAddress) continue;
    // Compare: flag as anomaly only if recipient doesn't match owner wallet
    if (s.recipientAddress.toLowerCase() !== ownerWallet.toLowerCase()) {
      if (!anomaliesByNetwork[net]) anomaliesByNetwork[net] = [];
      anomaliesByNetwork[net].push(s);
    }
  }

  for (const [network, settlements] of Object.entries(anomaliesByNetwork)) {
    const ownerWallet = CRYPTO_OWNER_WALLETS[network] || 'wallet-not-in-secrets';
    let anomalyCount = 0;
    let networkTotal = 0;

    for (const settlement of settlements) {
      const price = TOKEN_PRICES[settlement.token] || 1;
      const usdValue = Number(settlement.amount) * price;
      networkTotal += usdValue;

      const severityMap: Record<string, 'critical' | 'high' | 'medium'> = {
        confirmed: 'critical',
        pending: 'high',
        failed: 'medium',
      };

      issues.push({
        id: `crypto-anomaly-${settlement.id}`,
        severity: severityMap[settlement.status] || 'high',
        category: 'Crypto Routing Anomaly',
        title: `Crypto routing anomaly on ${settlement.network} — ${settlement.amount} ${settlement.token} ($${usdValue.toFixed(2)})`,
        description: `${settlement.amount} ${settlement.token} on ${settlement.network} was sent to ${settlement.recipientAddress} instead of the owner wallet ${ownerWallet}. Type: ${settlement.type}, Status: ${settlement.status}, TxHash: ${settlement.txHash}. Requires investigation — this may be intentional or a configuration error.`,
        entityType: 'item',
        entityId: settlement.id,
        entityLabel: `${settlement.network} transfer — ${settlement.amount} ${settlement.token} (ROUTING ANOMALY)`,
        amount: usdValue,
        actionable: false,
      });
      anomalyCount++;
    }

    // Summary issue per network — only if anomalies were found
    if (anomalyCount > 0) {
      const allUsdTotal = settlements
        .reduce((sum, s) => sum + (TOKEN_PRICES[s.token] || 1) * Number(s.amount), 0);
      issues.push({
        id: `crypto-anomaly-summary-${network}`,
        severity: 'critical',
        category: 'Crypto Routing Anomaly',
        title: `${settlements.length} crypto routing anomaly/anomalies on ${network} — $${allUsdTotal.toFixed(2)} affected`,
        description: `${settlements.length} crypto settlement(s) on ${network} routed to non-owner wallets ($${allUsdTotal.toFixed(2)} total). Owner wallet: ${ownerWallet}. These require investigation — they are not auto-actionable.`,
        entityType: 'item',
        entityId: `crypto-summary-${network}`,
        entityLabel: `${network} — ${anomalyCount} anomaly/anomalies of ${settlements.length} checked ($${allUsdTotal.toFixed(2)})`,
        amount: allUsdTotal,
        actionable: false,
      });
    }
  }

  } // end owner-configured guard for Category 16 & 17

  // ── PIPELINE HEALTH SCORE ──────────────────────────────────────────
    const totalItems = await db.payoutItem.count();
    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const highCount = issues.filter((i) => i.severity === 'high').length;
    const mediumCount = issues.filter((i) => i.severity === 'medium').length;
    const lowCount = issues.filter((i) => i.severity === 'low').length;

    const healthScore = totalItems > 0
      ? Math.max(0, Math.round(
          100 - (
            criticalCount * SEVERITY_WEIGHTS.critical +
            highCount * SEVERITY_WEIGHTS.high +
            mediumCount * SEVERITY_WEIGHTS.medium +
            lowCount * SEVERITY_WEIGHTS.low
          ),
        ))
      : 100;

    // ── SUMMARY STATS ──────────────────────────────────────────────────
    const blockedAmount = issues
      .filter((i) => i.amount && i.actionable)
      .reduce((sum, i) => sum + (i.amount || 0), 0);

    const actionableCount = issues.filter((i) => i.actionable).length;

    // ── CATEGORY BREAKDOWN ─────────────────────────────────────────────
    const categories = [...new Set(issues.map((i) => i.category))];
    const categoryBreakdown = categories.map((cat) => {
      const catIssues = issues.filter((i) => i.category === cat);
      return {
        category: cat,
        count: catIssues.length,
        severity: catIssues[0]?.severity || 'low',
        amount: catIssues.reduce((sum, i) => sum + (i.amount || 0), 0),
      };
    });

    return NextResponse.json({
      healthScore,
      issues: {
        total: issues.length,
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount,
      },
      blockedAmount,
      actionableCount,
      categoryBreakdown,
      items: issues.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
    });
  } catch (error) {
    console.error('Diagnostic engine error:', error);
    return NextResponse.json({ error: 'Diagnostic scan failed' }, { status: 500 });
  }
}