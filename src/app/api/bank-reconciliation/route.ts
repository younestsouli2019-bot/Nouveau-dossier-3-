import { NextRequest, NextResponse } from 'next/server';
import { runBankReconciliation, approveAmountDiscrepancy } from '@/lib/bank-reconciliation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { camt053, action, settlementId, bankEntryId, approvedBy } = body as {
      camt053?: string;
      action?: string;
      settlementId?: string;
      bankEntryId?: string;
      approvedBy?: string;
    };

    if (action === 'approve_discrepancy') {
      if (!settlementId || !bankEntryId || !approvedBy) {
        return NextResponse.json(
          { success: false, error: 'settlementId, bankEntryId, and approvedBy required for approve_discrepancy' },
          { status: 400 },
        );
      }

      const result = await approveAmountDiscrepancy(settlementId, bankEntryId, approvedBy);
      return NextResponse.json(result);
    }

    if (action === 'unmatched') {
      const pendingSettlements = await db.ownerSettlement.findMany({
        where: { status: { in: ['pending', 'processing'] }, direction: 'inbound' },
        select: { id: true, amount: true, currency: true, externalRef: true, referenceId: true, description: true, createdAt: true },
      });
      return NextResponse.json({ success: true, settlements: pendingSettlements });
    }

    if (!camt053) {
      return NextResponse.json(
        { success: false, error: 'camt053 field required for reconciliation' },
        { status: 400 },
      );
    }

    const report = await runBankReconciliation(camt053);
    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    console.error('[BankReconciliation]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Reconciliation failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  const pendingSettlements = await db.ownerSettlement.findMany({
    where: { status: { in: ['pending', 'processing'] }, direction: 'inbound' },
    select: { id: true, amount: true, currency: true, status: true, externalRef: true, createdAt: true },
  });

  const recentReconciled = await db.ownerSettlement.findMany({
    where: { dataSource: 'live_bank_api' },
    orderBy: { verifiedAt: 'desc' },
    take: 20,
    select: { id: true, amount: true, currency: true, status: true, externalRef: true, verifiedAt: true, proofHash: true },
  });

  return NextResponse.json({
    success: true,
    pendingCount: pendingSettlements.length,
    pending: pendingSettlements,
    recentReconciled,
  });
}
