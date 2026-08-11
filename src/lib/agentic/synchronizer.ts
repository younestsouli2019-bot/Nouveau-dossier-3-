// ——— Synchronizer (SCSS) ———
// Maintains the vector state ledger: computes a cryptographic summary of
// key aggregates, chains LedgerSnapshot records, and diffs successive
// snapshots to expose drift for the Rectifier.

import { db } from '@/lib/db'
import { sha256, hashObject } from '@/lib/strict-enforcement/crypto-utils'

export type StateSummary = {
  totalRevenue: number
  totalSettled: number
  totalPending: number
  totalRejected: number
  settlementCount: number
  revenueCount: number
  discrepancyCount: number
  payoutBatchCount: number
  procurementItemCount: number
}

export async function computeStateSummary(): Promise<StateSummary> {
  const [
    revenue,
    settlements,
    pendingSettlements,
    rejectedSettlements,
    revenueCount,
    discrepancies,
    payoutBatchCount,
    procurementItemCount,
  ] = await Promise.all([
    db.revenueEvent.aggregate({ _sum: { amount: true } }),
    db.ownerSettlement.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
    db.ownerSettlement.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
    db.ownerSettlement.aggregate({ where: { status: 'rejected' }, _sum: { amount: true } }),
    db.revenueEvent.count(),
    db.procurementItem.count({ where: { receiptDiscrepancy: true } }),
    db.payoutBatch.count(),
    db.procurementItem.count(),
  ])

  return {
    totalRevenue: Math.round((revenue._sum.amount ?? 0) * 100) / 100,
    totalSettled: Math.round((settlements._sum.amount ?? 0) * 100) / 100,
    totalPending: Math.round((pendingSettlements._sum.amount ?? 0) * 100) / 100,
    totalRejected: Math.round((rejectedSettlements._sum.amount ?? 0) * 100) / 100,
    settlementCount: settlements._count._all,
    revenueCount,
    discrepancyCount: discrepancies,
    payoutBatchCount,
    procurementItemCount,
  }
}

export async function snapshotState(snapshotType = 'on_demand') {
  const summary = await computeStateSummary()
  const integrityHash = sha256(hashObject(summary))

  const latest = await db.ledgerSnapshot.findFirst({ orderBy: { createdAt: 'desc' } })

  return db.ledgerSnapshot.create({
    data: {
      snapshotType,
      totalRevenue: summary.totalRevenue,
      totalSettled: summary.totalSettled,
      totalPending: summary.totalPending,
      totalRejected: summary.totalRejected,
      settlementCount: summary.settlementCount,
      revenueCount: summary.revenueCount,
      discrepancyCount: summary.discrepancyCount,
      integrityHash,
      previousSnapshotId: latest?.id ?? null,
      metadata: JSON.stringify(summary),
    },
  })
}

export async function compareSnapshots() {
  const snapshots = await db.ledgerSnapshot.findMany({
    orderBy: { createdAt: 'desc' },
    take: 2,
  })
  if (snapshots.length < 2) return null

  const [latest, previous] = snapshots
  const fields: Array<keyof typeof latest> = [
    'totalRevenue', 'totalSettled', 'totalPending', 'totalRejected',
    'settlementCount', 'revenueCount', 'discrepancyCount',
  ]
  const changes: Array<{ field: string; from: number; to: number; delta: number }> = []
  for (const f of fields) {
    const from = previous[f] as number
    const to = latest[f] as number
    if (from !== to) changes.push({ field: f, from, to, delta: to - from })
  }
  return {
    latestSnapshotId: latest.id,
    previousSnapshotId: previous.id,
    drift: changes.length > 0,
    changes,
    latestHash: latest.integrityHash,
  }
}
