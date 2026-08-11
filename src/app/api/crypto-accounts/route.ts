import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// ---------- GET /api/crypto-accounts ----------
export async function GET() {
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Fetch all crypto accounts with related data
    const accounts = await db.cryptoAccount.findMany({
      include: {
        _count: {
          select: {
            transactions: true,
            destinationBatches: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get latest transaction date per account
    const latestTxPerAccount = await db.cryptoTransaction.groupBy({
      by: ['cryptoAccountId'],
      _max: { createdAt: true },
    });

    const latestTxMap = new Map(
      latestTxPerAccount.map((r) => [r.cryptoAccountId, r._max.createdAt]),
    );

    // Enrich accounts with computed fields
    const enrichedAccounts = accounts.map((account) => ({
      ...account,
      _txCount: account._count.transactions,
      _lastTxDate: latestTxMap.get(account.id) ?? null,
      _linkedBatchCount: account._count.destinationBatches,
    }));

    // Derive stale & suspended subsets
    const staleAccounts = enrichedAccounts.filter(
      (a) =>
        a.status === 'active' &&
        a.lastActivityAt &&
        a.lastActivityAt < fourteenDaysAgo,
    );

    const suspendedAccounts = enrichedAccounts.filter(
      (a) => a.status === 'suspended',
    );

    // Linked batches summary
    const linkedBatches = await db.payoutBatch.findMany({
      where: { destinationCryptoAccountId: { not: null } },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        totalAmount: true,
        destinationCryptoAccountId: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Summary aggregations
    const [
      totalBalanceAgg,
      totalReceivedAgg,
      totalSentAgg,
      accountCount,
      activeCount,
      suspendedCount,
      byExchange,
      byRiskLevel,
    ] = await Promise.all([
      db.cryptoAccount.aggregate({ _sum: { balanceUsd: true } }),
      db.cryptoAccount.aggregate({ _sum: { totalReceivedUsd: true } }),
      db.cryptoAccount.aggregate({ _sum: { totalSentUsd: true } }),
      db.cryptoAccount.count(),
      db.cryptoAccount.count({ where: { status: 'active' } }),
      db.cryptoAccount.count({ where: { status: 'suspended' } }),
      db.cryptoAccount.groupBy({
        by: ['exchange'],
        _count: true,
        _sum: { balanceUsd: true },
      }),
      db.cryptoAccount.groupBy({
        by: ['riskLevel'],
        _count: true,
      }),
    ]);

    return NextResponse.json({
      accounts: enrichedAccounts,
      summary: {
        totalBalanceUsd: totalBalanceAgg._sum.balanceUsd ?? 0,
        totalReceivedUsd: totalReceivedAgg._sum.totalReceivedUsd ?? 0,
        totalSentUsd: totalSentAgg._sum.totalSentUsd ?? 0,
        accountCount,
        activeCount,
        suspendedCount,
        staleCount: staleAccounts.length,
        byExchange: byExchange.map((e) => ({
          exchange: e.exchange,
          count: e._count,
          balance: e._sum.balanceUsd ?? 0,
        })),
        byRiskLevel: byRiskLevel.map((r) => ({
          level: r.riskLevel,
          count: r._count,
        })),
      },
      staleAccounts,
      suspendedAccounts,
      linkedBatches: linkedBatches.map((b) => ({
        batchId: b.id,
        batchNumber: b.batchNumber,
        status: b.status,
        amount: b.totalAmount,
        cryptoAccountId: b.destinationCryptoAccountId,
      })),
    });
  } catch (error) {
    console.error('Crypto accounts API error:', error);
    return NextResponse.json(
      { error: 'Failed to load crypto accounts' },
      { status: 500 },
    );
  }
}

// ---------- PATCH /api/crypto-accounts ----------
type PatchAction = 'acknowledge_risk' | 'update_status' | 'set_primary';

interface PatchBody {
  accountId: string;
  action: PatchAction;
  newStatus?: string;
  notes?: string;
}

export async function PATCH(request: NextRequest) {
  try {
    const body: PatchBody = await request.json();
    const { accountId, action, newStatus, notes } = body;

    if (!accountId || !action) {
      return NextResponse.json(
        { error: 'accountId and action are required' },
        { status: 400 },
      );
    }

    const validActions: PatchAction[] = [
      'acknowledge_risk',
      'update_status',
      'set_primary',
    ];

    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 },
      );
    }

    const existing = await db.cryptoAccount.findUnique({
      where: { id: accountId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Crypto account not found' },
        { status: 404 },
      );
    }

    // --- acknowledge_risk ---
    if (action === 'acknowledge_risk') {
      if (existing.riskLevel === 'low') {
        return NextResponse.json(
          { error: 'Cannot acknowledge risk on a low-risk account' },
          { status: 400 },
        );
      }

      const timestamp = new Date().toISOString();
      const prefix = existing.notes ? `${existing.notes}\n` : '';
      const updated = await db.cryptoAccount.update({
        where: { id: accountId },
        data: {
          notes: notes
            ? `${prefix}[Risk acknowledged: ${timestamp}] ${notes}`
            : `${prefix}[Risk acknowledged: ${timestamp}] Risk reviewed and acknowledged by owner.`,
        },
      });

      return NextResponse.json({ account: updated });
    }

    // --- update_status ---
    if (action === 'update_status') {
      const validStatuses = ['active', 'suspended', 'closed', 'frozen'];

      if (!newStatus || !validStatuses.includes(newStatus)) {
        return NextResponse.json(
          {
            error: `newStatus is required and must be one of: ${validStatuses.join(', ')}`,
          },
          { status: 400 },
        );
      }

      if (existing.status === newStatus) {
        return NextResponse.json(
          { error: `Account is already "${newStatus}"` },
          { status: 400 },
        );
      }

      const updated = await db.cryptoAccount.update({
        where: { id: accountId },
        data: {
          status: newStatus,
          ...(notes ? { notes: notes } : {}),
        },
      });

      return NextResponse.json({ account: updated });
    }

    // --- set_primary ---
    if (action === 'set_primary') {
      if (existing.status !== 'active') {
        return NextResponse.json(
          { error: 'Only active accounts can be set as primary' },
          { status: 400 },
        );
      }

      if (existing.isPrimary) {
        return NextResponse.json(
          { error: 'Account is already the primary account' },
          { status: 400 },
        );
      }

      // Unset current primary, then set new one — in a transaction
      await db.$transaction([
        db.cryptoAccount.updateMany({
          where: { isPrimary: true },
          data: { isPrimary: false },
        }),
        db.cryptoAccount.update({
          where: { id: accountId },
          data: { isPrimary: true },
        }),
      ]);

      const updated = await db.cryptoAccount.findUnique({
        where: { id: accountId },
      });

      return NextResponse.json({ account: updated });
    }

    // Should never reach here due to the validActions check above
    return NextResponse.json({ error: 'Unhandled action' }, { status: 500 });
  } catch (error) {
    console.error('Crypto accounts PATCH API error:', error);
    return NextResponse.json(
      { error: 'Failed to update crypto account' },
      { status: 500 },
    );
  }
}