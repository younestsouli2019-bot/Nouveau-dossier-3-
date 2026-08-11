import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

// ─── Submit Bank Wire Batches ─────────────────────────────────────────────
// Submits approved (or completed-but-unreceived) bank_transfer batches to the
// owner's bank account(s) configured in .env. Creates transaction logs and
// advances item statuses.
// ────────────────────────────────────────────────────────────────────────────

interface WireAccount {
  bankName: string;
  swift: string;
  account: string;
  iban: string;
  accountName: string;
  currency: string;
  address: string;
}

function getWireAccounts(): { primary: WireAccount; secondary: WireAccount } {
  return {
    primary: {
      bankName: process.env.OWNER_BANK_NAME || 'Not Configured',
      swift: process.env.OWNER_BANK_SWIFT || '',
      account: process.env.OWNER_BANK_ACCOUNT || '',
      iban: process.env.OWNER_BANK_IBAN || '',
      accountName: process.env.OWNER_BANK_ACCOUNT_NAME || 'Owner',
      currency: process.env.OWNER_BANK_CURRENCY || 'MAD',
      address: process.env.OWNER_BANK_ADDRESS || '',
    },
    secondary: {
      bankName: process.env.OWNER_BANK2_NAME || 'Not Configured',
      swift: process.env.OWNER_BANK2_SWIFT || '',
      account: process.env.OWNER_BANK2_ACCOUNT || '',
      iban: process.env.OWNER_BANK2_IBAN || '',
      accountName: process.env.OWNER_BANK2_ACCOUNT_NAME || 'Owner',
      currency: process.env.OWNER_BANK2_CURRENCY || 'USD',
      address: process.env.OWNER_BANK2_ADDRESS || '',
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { batchIds, account: accountChoice = 'secondary' } = body;

    // Find wire batches to submit
    let batches;
    if (batchIds && batchIds.length > 0) {
      batches = await db.payoutBatch.findMany({
        where: {
          id: { in: batchIds },
          paymentProvider: 'bank_transfer',
        },
        include: { items: true },
      });
    } else {
      // Auto-detect: all bank_transfer batches that are approved or completed but unreceived
      batches = await db.payoutBatch.findMany({
        where: {
          paymentProvider: 'bank_transfer',
          status: { in: ['approved', 'completed'] },
        },
        include: { items: true },
      });
    }

    if (batches.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No bank wire batches found to submit',
        submitted: [],
      });
    }

    const wireAccounts = getWireAccounts();
    const targetAccount = accountChoice === 'primary' ? wireAccounts.primary : wireAccounts.secondary;
    const now = new Date();
    const results: Array<{
      batchNumber: string;
      amount: number;
      items: number;
      status: string;
      txRef: string;
    }> = [];

    for (const batch of batches) {
      const txRef = `WIRE-${batch.batchNumber}-${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

      // 1. Update batch status to submitted
      await db.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: 'submitted',
          submittedAt: now,
          notes: batch.notes
            ? `${batch.notes} | Wire submitted to ${targetAccount.bankName} (${targetAccount.swift})`
            : `Wire submitted to ${targetAccount.bankName} (${targetAccount.swift})`,
        },
      });

      // 2. Create submission transaction log
      await db.transactionLog.create({
        data: {
          category: 'payout',
          status: 'submitted',
          amount: batch.totalAmount,
          currency: batch.currency,
          transactionDate: now,
          referenceId: txRef,
          description: `Bank wire submitted to ${targetAccount.bankName} — ${targetAccount.accountName} (${targetAccount.iban}) SWIFT: ${targetAccount.swift}`,
          payoutBatchId: batch.id,
          provider: `bank_transfer::${targetAccount.bankName}`,
          providerTxId: txRef,
          metadata: JSON.stringify({
            bankName: targetAccount.bankName,
            swift: targetAccount.swift,
            iban: targetAccount.iban,
            accountName: targetAccount.accountName,
            currency: targetAccount.currency,
            bankAddress: targetAccount.address,
            batchNumber: batch.batchNumber,
            itemCount: batch.itemCount,
          }),
        },
      });

      // 3. Advance all items to processing
      const itemIds = batch.items.map((item) => item.id);
      await db.payoutItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          status: 'processing',
          processedAt: now,
          transactionRef: txRef,
        },
      });

      results.push({
        batchNumber: batch.batchNumber,
        amount: batch.totalAmount,
        items: batch.items.length,
        status: 'submitted',
        txRef,
      });
    }

    // 4. Create audit log entry
    await db.payoutAuditLog.create({
      data: {
        entityType: 'batch',
        entityId: 'batch_wire_submit',
        action: 'wire_submitted',
        newValue: JSON.stringify({
          batches: results.map((r) => r.batchNumber),
          account: `${targetAccount.bankName} (${targetAccount.swift})`,
          totalAmount: results.reduce((s, r) => s + r.amount, 0),
          totalItems: results.reduce((s, r) => s + r.items, 0),
        }),
        reason: 'Owner-initiated wire transfer submission via .env bank config',
        performedBy: 'System Admin',
      },
    });

    const totalAmount = results.reduce((s, r) => s + r.amount, 0);
    const totalItems = results.reduce((s, r) => s + r.items, 0);

    return NextResponse.json({
      success: true,
      message: `${results.length} wire batch(es) submitted to ${targetAccount.bankName}`,
      account: {
        bankName: targetAccount.bankName,
        swift: targetAccount.swift,
        iban: targetAccount.iban,
        accountName: targetAccount.accountName,
        currency: targetAccount.currency,
      },
      submitted: results,
      summary: {
        batches: results.length,
        totalAmount,
        totalItems,
        submittedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('Wire submit API error:', error);
    return NextResponse.json(
      { error: 'Failed to submit wire transfers', details: String(error) },
      { status: 500 },
    );
  }
}