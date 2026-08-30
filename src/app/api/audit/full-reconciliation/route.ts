// ——— Full Reconciliation with Loss Recovery ———
// POST /api/audit/full-reconciliation
//
// Runs the complete reconciliation pipeline:
//   1. Ledger reconciliation (revenue vs settlements)
//   2. Procurement reconciliation (POs, items, shipments, payments)
//   3. Three-way matching (PO ↔ Receipt ↔ Invoice)
//   4. Loss recovery detection (duplicates, misrouted, stuck, overcharges)
//   5. Settlement advancement (create settlements for matched items)
//   6. Write comprehensive audit report
//
// This is the "run everything" endpoint.
// ——————————————————————————————————————————

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'
import { runThreeWayMatch } from '@/lib/procurement'
import { runLossRecovery } from '@/lib/procurement'

export const dynamic = 'force-dynamic'

interface FullReconciliationReport {
  timestamp: string
  integrityStatus: 'clean' | 'discrepancies_found' | 'critical_violations'
  ledgerReconciliation: {
    totalRevenue: number
    totalSettled: number
    totalPending: number
    balanceDelta: number
    transactionsBlocked: boolean
  }
  procurementReconciliation: {
    totalItems: number
    itemsByStatus: Record<string, number>
    totalPOs: number
    posByStatus: Record<string, number>
    totalSuppliers: number
    totalShipments: number
    totalPayoutBatches: number
  }
  threeWayMatch: {
    matched: number
    priceVariances: number
    qtyVariances: number
    overcharges: number
    totalVarianceAmount: number
    totalOverchargeAmount: number
  }
  lossRecovery: {
    totalActions: number
    totalRecoverableAmount: number
    autoRecovered: number
    duplicatePaymentsFound: number
    misroutedFound: number
    stuckPaymentsFound: number
    lostRevenueDetected: number
  }
  settlementsCreated: number
  totalSettlementAmount: number
  auditEntryId: string
  reportId: string
}

export async function POST() {
  try {
    const now = new Date()

    // ═══════════════════════════════════════════
    // 1. LEDGER RECONCILIATION
    // ═══════════════════════════════════════════
    const allRevenue = await db.revenueEvent.findMany({ where: { status: { not: 'rejected' } } })
    const allSettlements = await db.ownerSettlement.findMany()
    const totalRevenue = allRevenue.reduce((s, r) => s + r.amount, 0)
    const totalSettled = allSettlements.filter(s => s.status === 'completed').reduce((s, x) => s + x.amount, 0)
    const totalPending = allSettlements.filter(s => s.status === 'pending' || s.status === 'processing').reduce((s, x) => s + x.amount, 0)
    const totalFailedReversed = allSettlements.filter(s => s.status === 'failed' || s.status === 'reversed').reduce((s, x) => s + x.amount, 0)
    const balanceDelta = Math.round((totalRevenue - totalSettled - totalPending - totalFailedReversed) * 100) / 100

    // ═══════════════════════════════════════════
    // 2. PROCUREMENT RECONCILIATION
    // ═══════════════════════════════════════════
    const [allItems, allPOs, allSuppliers, allShipments, allBatches] = await Promise.all([
      db.procurementItem.findMany(),
      db.purchaseOrder.findMany({ include: { items: true } }),
      db.supplier.findMany(),
      db.shipment.findMany(),
      db.payoutBatch.findMany(),
    ])

    const itemsByStatus: Record<string, number> = {}
    for (const item of allItems) {
      itemsByStatus[item.status] = (itemsByStatus[item.status] || 0) + 1
    }
    const posByStatus: Record<string, number> = {}
    for (const po of allPOs) {
      posByStatus[po.status] = (posByStatus[po.status] || 0) + 1
    }

    // ═══════════════════════════════════════════
    // 3. THREE-WAY MATCHING
    // ═══════════════════════════════════════════
    const threeWayReport = await runThreeWayMatch()

    // ═══════════════════════════════════════════
    // 4. LOSS RECOVERY
    // ═══════════════════════════════════════════
    const recoveryReport = await runLossRecovery()

    // ═══════════════════════════════════════════
    // 5. SETTLEMENT ADVANCEMENT
    // Create settlements for confirmed-receipt items that don't have one yet
    // ═══════════════════════════════════════════
    let settlementsCreated = 0
    let totalSettlementAmount = 0

    const confirmedItems = allItems.filter(i =>
      i.status === 'receipt_confirmed' || i.status === 'settled'
    )

    // Find the settlement account
    const settlementAccount = await db.ownerAccount.findFirst({
      where: { purposes: { contains: 'settlements' } },
    })

    if (settlementAccount) {
      for (const item of confirmedItems) {
        const amount = item.totalEst || item.quantity * item.unitPriceEst
        if (amount <= 0) continue

        // Check if settlement already exists
        const existingSettlement = await db.ownerSettlement.findFirst({
          where: {
            ownerAccountId: settlementAccount.id,
            description: { contains: item.id },
            status: { not: 'failed' },
          },
        })

        if (existingSettlement) continue

        // Create settlement
        const extRef = `PROC-${item.id.slice(-8)}-${now.toISOString().slice(0, 10)}`
        const proofHash = sha256(`${item.id}:${extRef}:${amount}:USD`)

        await db.ownerSettlement.create({
          data: {
            ownerAccountId: settlementAccount.id,
            referenceId: extRef,
            amount: Math.round(amount * 100) / 100,
            currency: 'USD',
            status: 'completed',
            direction: 'outbound',
            purpose: 'vendor_payment',
            description: `Procurement settlement for "${item.name}" (${item.recipientName}) - ${item.id}`,
            sourceLabel: `Procurement Pipeline`,
            destinationLabel: `${item.supplierName || 'Supplier'} via Swarm pre-payment`,
            dataSource: 'iso20022_generated',
            externalRef: extRef,
            verifiedAt: now,
            proofHash,
            settledAt: now,
          },
        })

        settlementsCreated++
        totalSettlementAmount += amount
      }
    }

    // ═══════════════════════════════════════════
    // 6. COMPREHENSIVE AUDIT ENTRY
    // ═══════════════════════════════════════════
    const reportId = `FR-${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 19).replace(/:/g, '')}`
    const lastAudit = await db.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })

    const criticalCount = (balanceDelta !== 0 ? 1 : 0) + recoveryReport.duplicatePaymentsFound + recoveryReport.misroutedFound
    const integrityStatus = criticalCount === 0
      ? (recoveryReport.totalActions === 0 && balanceDelta === 0 ? 'clean' : 'discrepancies_found')
      : 'critical_violations'

    const auditContent = JSON.stringify({
      entityType: 'full_reconciliation',
      entityId: reportId,
      action: 'full_reconciliation_executed',
      integrityStatus,
      balanceDelta,
      threeWayMatched: threeWayReport.matched,
      threeWayOvercharges: threeWayReport.overcharges,
      lossRecoveryActions: recoveryReport.totalActions,
      settlementsCreated,
      totalSettlementAmount,
    })

    const auditEntry = await db.auditLedger.create({
      data: {
        entityType: 'full_reconciliation',
        entityId: reportId,
        action: 'full_reconciliation_executed',
        previousHash: lastAudit?.entryHash ?? null,
        entryHash: sha256(auditContent),
        performedBy: 'full-reconciliation-engine',
        metadata: auditContent,
      },
    })

    // Save snapshot
    await db.ledgerSnapshot.create({
      data: {
        snapshotType: 'on_demand',
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalSettled: Math.round(totalSettled * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        totalRejected: allRevenue.filter(r => r.status === 'rejected').reduce((s, r) => s + r.amount, 0),
        settlementCount: allSettlements.length,
        revenueCount: allRevenue.length,
        discrepancyCount: recoveryReport.totalActions + threeWayReport.overcharges + threeWayReport.priceVariances,
        integrityHash: sha256(`revenue:${totalRevenue}:settled:${totalSettled}:delta:${balanceDelta}:recovery:${recoveryReport.totalActions}`),
        metadata: JSON.stringify({
          reportId,
          threeWayMatch: { matched: threeWayReport.matched, overcharges: threeWayReport.overcharges },
          lossRecovery: { actions: recoveryReport.totalActions, autoRecovered: recoveryReport.autoRecovered },
          settlementsCreated,
        }),
      },
    })

    return NextResponse.json({
      success: true,
      integrityStatus,
      reportId,
      ledgerReconciliation: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalSettled: Math.round(totalSettled * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        balanceDelta,
        transactionsBlocked: balanceDelta !== 0,
      },
      procurementReconciliation: {
        totalItems: allItems.length,
        itemsByStatus,
        totalPOs: allPOs.length,
        posByStatus,
        totalSuppliers: allSuppliers.length,
        totalShipments: allShipments.length,
        totalPayoutBatches: allBatches.length,
      },
      threeWayMatch: {
        matched: threeWayReport.matched,
        priceVariances: threeWayReport.priceVariances,
        qtyVariances: threeWayReport.qtyVariances,
        overcharges: threeWayReport.overcharges,
        totalVarianceAmount: threeWayReport.totalVarianceAmount,
        totalOverchargeAmount: threeWayReport.totalOverchargeAmount,
      },
      lossRecovery: {
        totalActions: recoveryReport.totalActions,
        totalRecoverableAmount: recoveryReport.totalRecoverableAmount,
        autoRecovered: recoveryReport.autoRecovered,
        duplicatePaymentsFound: recoveryReport.duplicatePaymentsFound,
        misroutedFound: recoveryReport.misroutedFound,
        stuckPaymentsFound: recoveryReport.stuckPaymentsFound,
        lostRevenueDetected: recoveryReport.lostRevenueDetected,
      },
      recoveryActions: recoveryReport.actions,
      settlementsCreated,
      totalSettlementAmount: Math.round(totalSettlementAmount * 100) / 100,
      auditEntryId: auditEntry.id,
    })
  } catch (error) {
    console.error('[Full Reconciliation]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Full reconciliation failed' },
      { status: 500 }
    )
  }
}
