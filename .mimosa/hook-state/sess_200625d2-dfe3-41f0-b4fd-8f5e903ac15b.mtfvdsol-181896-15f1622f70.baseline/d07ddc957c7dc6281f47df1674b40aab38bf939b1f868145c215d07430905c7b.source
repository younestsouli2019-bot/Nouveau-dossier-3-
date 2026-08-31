// ─── Real Payout Submission API ──────────────────────────────────────
// POST /api/payout-batches/submit-real
//
// Submits payout batches to REAL payment providers (PayPal, Payoneer, Bank Wire)
// via actual API calls. This is different from the previous "submission" which
// only updated database statuses.
//
// Accepts: { batchIds?: string[], provider?: string }
//   - If batchIds provided: submit only those batches
//   - If no batchIds: auto-detect all submitted/pending batches
//   - If provider provided: override the batch's paymentProvider
//
// Steps per batch:
//   1. Read batch + items from DB
//   2. Build PayoutRecipient array from items
//   3. Call submitPayoutToProvider() — makes real API call
//   4. Update PayoutBatch.providerBatchRef with real provider batch ID
//   5. Update TransactionLog with full provider response
//   6. Create PayoutAuditLog entry (action: "real_submission")
//   7. Advance items to 'processing' status
// ────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import {
  submitPayoutToProvider,
  getProviderConfig,
} from '@/lib/payment-providers';
import type { PaymentProvider, PayoutRecipient } from '@/lib/payment-providers';

interface SubmitRealBody {
  batchIds?: string[];
  provider?: string;
}

interface BatchResult {
  batchId: string;
  batchNumber: string;
  provider: string;
  amount: number;
  items: number;
  providerBatchId: string;
  batchStatus: string;
  successfulItems: number;
  failedItems: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SubmitRealBody = await request.json();
    const { batchIds, provider: providerOverride } = body;

    // Step 1: Find batches to submit
    let batches;
    if (batchIds && batchIds.length > 0) {
      batches = await db.payoutBatch.findMany({
        where: { id: { in: batchIds } },
        include: { items: true, transactionLogs: true },
        orderBy: { batchNumber: 'asc' },
      });
    } else {
      // Auto-detect: batches in 'submitted' status (previously marked by fake submission)
      // or 'approved' status that haven't been sent yet
      batches = await db.payoutBatch.findMany({
        where: {
          status: { in: ['submitted', 'approved', 'pending_approval'] },
        },
        include: { items: true, transactionLogs: true },
        orderBy: { batchNumber: 'asc' },
      });
    }

    if (batches.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No batches found to submit for real payment processing',
        results: [],
      });
    }

    console.log(
      `[SubmitReal] Found ${batches.length} batches to process: ${batches.map((b) => b.batchNumber).join(', ')}`,
    );

    const now = new Date();
    const results: BatchResult[] = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    // Step 2: Process each batch
    for (const batch of batches) {
      const provider = (providerOverride || batch.paymentProvider) as PaymentProvider;

      if (!provider || !['paypal', 'payoneer', 'bank_transfer'].includes(provider)) {
        console.error(
          `[SubmitReal] Batch ${batch.batchNumber}: unknown or missing provider "${provider}"`,
        );
        results.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          provider: provider || 'unknown',
          amount: batch.totalAmount,
          items: batch.items.length,
          providerBatchId: '',
          batchStatus: 'FAILED',
          successfulItems: 0,
          failedItems: batch.items.length,
          error: `Unknown or missing payment provider: "${provider}"`,
        });
        totalFailed++;
        continue;
      }

      // Check provider config
      const config = getProviderConfig(provider);
      if (!config) {
        console.error(
          `[SubmitReal] Batch ${batch.batchNumber}: provider ${provider} not configured`,
        );
        results.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          provider,
          amount: batch.totalAmount,
          items: batch.items.length,
          providerBatchId: '',
          batchStatus: 'FAILED',
          successfulItems: 0,
          failedItems: batch.items.length,
          error: `Provider "${provider}" is not configured. Check .env credentials.`,
        });
        totalFailed++;
        continue;
      }

      // Build PayoutRecipient array from batch items
      const recipients: PayoutRecipient[] = batch.items.map((item) => ({
        email: item.recipientEmail || undefined,
        accountId: item.paymentMethod === 'bank_transfer' ? item.transactionRef || undefined : undefined,
        name: item.recipientName,
        amount: item.amount,
        currency: item.currency,
        referenceId: item.id,
      }));

      // Generate a unique batch reference for the provider
      const batchReference = `REAL-${batch.batchNumber}-${now.toISOString().slice(0, 10)}-${Date.now()}`;

      try {
        console.log(
          `[SubmitReal] Batch ${batch.batchNumber}: submitting to ${provider} with ${recipients.length} recipients`,
        );

        // Step 3: Call the real payment provider
        const providerResult = await submitPayoutToProvider(
          provider,
          recipients,
          batchReference,
        );

        console.log(
          `[SubmitReal] Batch ${batch.batchNumber}: ${provider} returned success=${providerResult.success}, status=${providerResult.batchStatus}`,
        );

        // Step 4: Update PayoutBatch with real provider batch ID
        await db.payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: providerResult.success ? 'submitted' : 'failed',
            submittedAt: providerResult.success ? now : batch.submittedAt,
            providerBatchRef: providerResult.providerBatchId,
            notes: [
              batch.notes,
              `[REAL SUBMISSION] Provider: ${provider}, Batch ID: ${providerResult.providerBatchId}, Status: ${providerResult.batchStatus}, Items: ${providerResult.successfulItems}/${providerResult.totalItems}`,
            ]
              .filter(Boolean)
              .join(' | '),
          },
        });

        // Step 5: Create TransactionLog with full provider response
        await db.transactionLog.create({
          data: {
            category: 'payout',
            status: providerResult.success ? 'submitted' : 'failed',
            amount: batch.totalAmount,
            currency: batch.currency,
            transactionDate: now,
            referenceId: providerResult.providerBatchId,
            description: `Real ${provider} payout submission — batch ${batch.batchNumber}`,
            payoutBatchId: batch.id,
            provider,
            providerTxId: providerResult.providerBatchId,
            errorCode: providerResult.error
              ? (providerResult.error as string).slice(0, 255)
              : undefined,
            errorMessage: providerResult.error,
            metadata: JSON.stringify({
              source: 'real_submission',
              batchReference,
              batchStatus: providerResult.batchStatus,
              successfulItems: providerResult.successfulItems,
              failedItems: providerResult.failedItems,
              itemResults: providerResult.items.map((item, idx) => ({
                recipientName: recipients[idx]?.name,
                amount: recipients[idx]?.amount,
                success: item.success,
                status: item.status,
                providerItemId: item.providerItemId,
                error: item.error,
                errorCode: item.errorCode,
              })),
              providerResponse: providerResult.providerResponse,
              sandbox: config.sandbox,
            }),
          },
        });

        // Step 6: Update individual items based on provider response
        for (let i = 0; i < batch.items.length; i++) {
          const item = batch.items[i];
          const itemResult = providerResult.items[i];

          if (itemResult) {
            const updateData: Record<string, unknown> = {
              status: itemResult.success ? 'processing' : 'failed',
              processedAt: itemResult.success ? now : undefined,
              transactionRef: itemResult.providerItemId || providerResult.providerBatchId,
            };

            if (!itemResult.success) {
              updateData.failureReason = itemResult.error || 'Provider rejected item';
            }

            await db.payoutItem.update({
              where: { id: item.id },
              data: updateData as {
                status: string;
                processedAt?: Date;
                transactionRef?: string;
                failureReason?: string;
              },
            });
          }
        }

        // Step 7: Create audit log entry
        await db.payoutAuditLog.create({
          data: {
            entityType: 'batch',
            entityId: batch.id,
            action: 'real_submission',
            newValue: JSON.stringify({
              provider,
              providerBatchId: providerResult.providerBatchId,
              batchStatus: providerResult.batchStatus,
              successfulItems: providerResult.successfulItems,
              failedItems: providerResult.failedItems,
              totalAmount: providerResult.totalAmount,
              sandbox: config.sandbox,
            }),
            reason: `Real API submission to ${provider} (${config.sandbox ? 'sandbox' : 'live'} mode)`,
            performedBy: 'System Admin',
            payoutBatchId: batch.id,
          },
        });

        results.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          provider,
          amount: batch.totalAmount,
          items: batch.items.length,
          providerBatchId: providerResult.providerBatchId,
          batchStatus: providerResult.batchStatus,
          successfulItems: providerResult.successfulItems,
          failedItems: providerResult.failedItems,
          error: providerResult.error,
        });

        if (providerResult.success) {
          totalSuccess++;
        } else {
          totalFailed++;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[SubmitReal] Batch ${batch.batchNumber}: exception during submission:`,
          errorMessage,
        );

        // Still update the batch with failure info
        await db.payoutBatch.update({
          where: { id: batch.id },
          data: {
            notes: [
              batch.notes,
              `[REAL SUBMISSION FAILED] Provider: ${provider}, Error: ${errorMessage}`,
            ]
              .filter(Boolean)
              .join(' | '),
          },
        });

        await db.payoutAuditLog.create({
          data: {
            entityType: 'batch',
            entityId: batch.id,
            action: 'real_submission_failed',
            newValue: JSON.stringify({
              provider,
              error: errorMessage,
            }),
            reason: `Real API submission to ${provider} failed with exception`,
            performedBy: 'System Admin',
            payoutBatchId: batch.id,
          },
        });

        results.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          provider,
          amount: batch.totalAmount,
          items: batch.items.length,
          providerBatchId: batchReference,
          batchStatus: 'FAILED',
          successfulItems: 0,
          failedItems: batch.items.length,
          error: 'Internal server error',
        });

        totalFailed++;
      }
    }

    // Summary
    const totalAmount = results.reduce((s, r) => s + r.amount, 0);
    const totalItems = results.reduce((s, r) => s + r.items, 0);

    return NextResponse.json({
      success: totalFailed === 0,
      message:
        totalFailed === 0
          ? `All ${results.length} batches submitted successfully to real providers`
          : `${totalSuccess} of ${results.length} batches submitted. ${totalFailed} failed.`,
      results,
      summary: {
        totalBatches: results.length,
        successfulBatches: totalSuccess,
        failedBatches: totalFailed,
        totalAmount,
        totalItems,
        submittedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('[SubmitReal] API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}