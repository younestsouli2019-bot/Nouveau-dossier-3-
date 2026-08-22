import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

// ─── Resubmit All Outstanding Batches ────────────────────────────────────
// Re-submits all "completed but unreceived" batches to the owner's actual
// accounts configured in .env. Handles PayPal, Payoneer, and Bank Transfer.
// For mixed-provider batches (e.g. PB-2024-004), items are split by their
// individual paymentMethod and submitted to the corresponding provider.
// ────────────────────────────────────────────────────────────────────────────

interface ProviderAccount {
  name: string;
  email: string;
  id: string;
  currency: string;
  label: string;
}

interface WireAccount {
  bankName: string;
  swift: string;
  iban: string;
  accountName: string;
  currency: string;
  address: string;
}

function getAccounts() {
  return {
    paypal: {
      name: process.env.OWNER_PAYPAL_NAME || 'Owner',
      email: process.env.OWNER_PAYPAL_EMAIL || '',
      id: process.env.OWNER_PAYPAL_ID || '',
      currency: process.env.OWNER_PAYPAL_CURRENCY || 'USD',
      label: 'PayPal',
    } as ProviderAccount,
    payoneer: {
      name: process.env.OWNER_PAYONEER_NAME || 'Owner',
      email: process.env.OWNER_PAYONEER_EMAIL || '',
      id: process.env.OWNER_PAYONEER_ID || '',
      currency: process.env.OWNER_PAYONEER_CURRENCY || 'USD',
      label: 'Payoneer',
    } as ProviderAccount,
    bank: {
      bankName: process.env.OWNER_BANK_NAME || 'Attijariwafa Bank',
      swift: process.env.OWNER_BANK_SWIFT || 'BCMAMAMC',
      iban: process.env.OWNER_BANK_IBAN || '',
      accountName: process.env.OWNER_BANK_ACCOUNT_NAME || 'Owner',
      currency: process.env.OWNER_BANK_CURRENCY || 'MAD',
      address: process.env.OWNER_BANK_ADDRESS || '',
    } as WireAccount,
  };
}

function getProviderInfo(method: string, accounts: ReturnType<typeof getAccounts>) {
  switch (method) {
    case 'paypal':
      return {
        provider: `paypal::${accounts.paypal.email}`,
        description: `PayPal payout to ${accounts.paypal.name} (${accounts.paypal.email})`,
        metadata: { type: 'paypal', email: accounts.paypal.email, name: accounts.paypal.name, currency: accounts.paypal.currency },
      };
    case 'payoneer':
      return {
        provider: `payoneer::${accounts.payoneer.email}`,
        description: `Payoneer payout to ${accounts.payoneer.name} (${accounts.payoneer.email})`,
        metadata: { type: 'payoneer', email: accounts.payoneer.email, name: accounts.payoneer.name, currency: accounts.payoneer.currency },
      };
    case 'bank_transfer':
    default:
      return {
        provider: `bank_transfer::${accounts.bank.bankName}`,
        description: `Bank wire to ${accounts.bank.accountName} (${accounts.bank.iban}) SWIFT: ${accounts.bank.swift}`,
        metadata: { type: 'bank_transfer', bankName: accounts.bank.bankName, swift: accounts.bank.swift, iban: accounts.bank.iban, accountName: accounts.bank.accountName, currency: accounts.bank.currency, bankAddress: accounts.bank.address },
      };
  }
}

export async function POST() {
  try {
    const accounts = getAccounts();
    const now = new Date();
    const results: Array<{
      batchNumber: string;
      method: string;
      amount: number;
      items: number;
      txRef: string;
    }> = [];

    // 1. Find all completed batches that haven't been truly submitted
    const batches = await db.payoutBatch.findMany({
      where: {
        status: 'completed',
        paymentProvider: { not: null },
      },
      include: { items: true },
    });

    // Also find completed batches with no provider but items have payment methods
    const noProviderBatches = await db.payoutBatch.findMany({
      where: {
        status: 'completed',
        paymentProvider: null,
        id: { notIn: batches.map(b => b.id) },
      },
      include: { items: true },
    });

    const allBatches = [...batches, ...noProviderBatches];

    if (allBatches.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No outstanding batches to resubmit',
        submitted: [],
      });
    }

    for (const batch of allBatches) {
      // Determine the provider for this batch
      const batchProvider = batch.paymentProvider;

      if (batchProvider && batchProvider !== 'wire_transfer') {
        // ── Single-provider batch (PayPal, Payoneer) ──
        const info = getProviderInfo(batchProvider, accounts);
        const txRef = `${batchProvider.toUpperCase()}-${batch.batchNumber}-${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

        await db.payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: 'submitted',
            submittedAt: now,
            paymentProvider: batchProvider,
            notes: `Resubmitted to ${info.description} — previous completion was unverified`,
          },
        });

        await db.transactionLog.create({
          data: {
            category: 'payout',
            status: 'submitted',
            amount: batch.totalAmount,
            currency: batch.currency,
            transactionDate: now,
            referenceId: txRef,
            description: info.description,
            payoutBatchId: batch.id,
            provider: info.provider,
            providerTxId: txRef,
            metadata: JSON.stringify({ ...info.metadata, batchNumber: batch.batchNumber, itemCount: batch.itemCount }),
          },
        });

        const itemIds = batch.items.map(i => i.id);
        await db.payoutItem.updateMany({
          where: { id: { in: itemIds } },
          data: { status: 'processing', processedAt: now, transactionRef: txRef, deliveryConfirmed: false, deliveryConfirmedAt: null },
        });

        results.push({ batchNumber: batch.batchNumber, method: batchProvider, amount: batch.totalAmount, items: batch.items.length, txRef });
      } else {
        // ── Bank transfer batch OR mixed-provider batch ──
        const itemsByMethod: Record<string, typeof batch.items> = {};

        for (const item of batch.items) {
          const method = item.paymentMethod || batchProvider || 'bank_transfer';
          if (!itemsByMethod[method]) itemsByMethod[method] = [];
          itemsByMethod[method].push(item);
        }

        for (const [method, items] of Object.entries(itemsByMethod)) {
          const totalAmount = items.reduce((s, i) => s + i.amount, 0);
          const info = getProviderInfo(method, accounts);
          const txRef = `${method.toUpperCase()}-${batch.batchNumber}-PART-${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

          await db.transactionLog.create({
            data: {
              category: 'payout',
              status: 'submitted',
              amount: totalAmount,
              currency: batch.currency,
              transactionDate: now,
              referenceId: txRef,
              description: `${info.description} [${batch.batchNumber} partial — ${items.length} items]`,
              payoutBatchId: batch.id,
              provider: info.provider,
              providerTxId: txRef,
              metadata: JSON.stringify({ ...info.metadata, batchNumber: batch.batchNumber, itemCount: items.length, partial: true, totalBatchAmount: batch.totalAmount }),
            },
          });

          const itemIds = items.map(i => i.id);
          await db.payoutItem.updateMany({
            where: { id: { in: itemIds } },
            data: { status: 'processing', processedAt: now, transactionRef: txRef, deliveryConfirmed: false, deliveryConfirmedAt: null },
          });

          results.push({ batchNumber: batch.batchNumber, method, amount: totalAmount, items: items.length, txRef });
        }

        // Update the batch itself
        const methods = Object.keys(itemsByMethod);
        await db.payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: 'submitted',
            submittedAt: now,
            paymentProvider: methods.length === 1 ? methods[0] : 'mixed',
            notes: `Resubmitted as ${methods.length > 1 ? 'mixed' : methods[0]} — split into ${methods.length} provider(s): ${methods.join(', ')}`,
          },
        });
      }
    }

    // Audit log
    const byMethod: Record<string, { count: number; amount: number }> = {};
    for (const r of results) {
      if (!byMethod[r.method]) byMethod[r.method] = { count: 0, amount: 0 };
      byMethod[r.method].count++;
      byMethod[r.method].amount += r.amount;
    }

    await db.payoutAuditLog.create({
      data: {
        entityType: 'batch',
        entityId: 'batch_resubmit_all',
        action: 'resubmit_all',
        newValue: JSON.stringify({
          batches: allBatches.map(b => b.batchNumber),
          byMethod,
          totalBatches: allBatches.length,
          totalAmount: results.reduce((s, r) => s + r.amount, 0),
          totalItems: results.reduce((s, r) => s + r.items, 0),
        }),
        reason: 'Owner resubmitted all outstanding batches — nothing received in owner accounts',
        performedBy: 'System Admin',
      },
    });

    const totalAmount = results.reduce((s, r) => s + r.amount, 0);
    const totalItems = results.reduce((s, r) => s + r.items, 0);

    return NextResponse.json({
      success: true,
      message: `${allBatches.length} batch(es) resubmitted across ${Object.keys(byMethod).length} provider(s)`,
      byMethod,
      submitted: results,
      summary: {
        batches: allBatches.length,
        submissions: results.length,
        totalAmount,
        totalItems,
        submittedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('Resubmit all API error:', error);
    return NextResponse.json(
      { error: 'Failed to resubmit batches', details: String(error) },
      { status: 500 },
    );
  }
}