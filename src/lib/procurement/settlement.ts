// ——— Settlement Routing (Swarm Ledger → Owners) ———
// Procurement.txt mandate: "SWARM LEDGER PAYS FOR PROCUREMENT".
//   - Procurement is funded from the swarm revenue ledger, NEVER from owner
//     accounts. Owner accounts only RECEIVE settlements/reconciliations.
//   - No settlement is ever marked 'completed' here without a verifiable
//     external reference (RWC-STRICT-001). Records are created 'pending' and
//     await a real funded rail (Payoneer/PayPal/bank/Attijari) with an externalRef.
//   - Every write is appended to the chained AuditLedger.
// —————————————————————————————————————————————————————————————————

import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'
import { SOURCING_WEIGHTS } from './pipeline'

// ─── Types ──────────────────────────────────────────────────────────

export interface SwarmLedgerSnapshot {
  totalRevenueVerified: number
  totalProcurementSpend: number
  surplus: number
  pendingOwnerSettlements: number
  currency: string
}

export interface SwarmPaymentResult {
  success: boolean
  itemsPaid: number
  totalAmount: number
  currency: string
  transactionLogId?: string
  auditEntryId?: string
  orderRef?: string
  error?: string
}

// ─── Core helpers ───────────────────────────────────────────────────

async function appendAudit(params: {
  entityType: string
  entityId: string
  action: string
  dataSource?: string
  performedBy: string
  metadata: Record<string, unknown>
}): Promise<string> {
  const lastAudit = await db.auditLedger.findFirst({
    orderBy: { createdAt: 'desc' },
  })
  const entryContent = JSON.stringify({
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    dataSource: params.dataSource,
    ...params.metadata,
  })
  const entry = await db.auditLedger.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      previousHash: lastAudit?.entryHash ?? null,
      entryHash: sha256(entryContent),
      dataSource: params.dataSource,
      performedBy: params.performedBy,
      metadata: JSON.stringify(params.metadata),
    },
  })
  return entry.id
}

// ─── 1. Swarm-ledger payment for procurement ────────────────────────

/**
 * Fund a set of procurement items from the swarm revenue ledger.
 * Creates a 'procurement' TransactionLog (paymentSource=swarm_ledger),
 * updates items to 'ordered', and chains an audit entry. This is a
 * ledger/bookkeeping action: actual money movement to suppliers happens
 * through the payment-provider dispatch layer (Payoneer/PayPal/Attijari)
 * and must carry an externalRef back to this record.
 */
export async function recordSwarmPayment(params: {
  procurementItemIds: string[]
  amount?: number
  currency?: string
  provider?: string
  providerRef?: string
  performedBy?: string
}): Promise<SwarmPaymentResult> {
  const {
    procurementItemIds, amount, currency = 'USD',
    provider, providerRef, performedBy = 'system',
  } = params

  const items = await db.procurementItem.findMany({
    where: { id: { in: procurementItemIds } },
  })
  if (items.length === 0) {
    return { success: false, itemsPaid: 0, totalAmount: 0, currency, error: 'No procurement items found' }
  }

  const computedTotal = Math.round(items.reduce((s, i) => s + (i.totalEst || i.unitPriceEst * i.quantity || 0), 0) * 100) / 100
  const totalAmount = amount ?? computedTotal
  const orderRef = providerRef ?? `SWARM-${Date.now().toString(36).toUpperCase()}`
  const now = new Date()

  const log = await db.transactionLog.create({
    data: {
      category: 'procurement',
      status: 'paid',
      amount: totalAmount,
      currency,
      transactionDate: now,
      referenceId: orderRef,
      provider: provider ?? 'swarm_ledger',
      providerTxId: providerRef ?? null,
      description: `Swarm ledger funded ${items.length} procurement item(s)`,
      metadata: JSON.stringify({
        paymentSource: 'swarm_ledger',
        procurementItemIds,
        route: provider ?? 'swarm_ledger',
        weightingModel: SOURCING_WEIGHTS,
      }),
    },
  })

  for (const item of items) {
    await db.procurementItem.update({
      where: { id: item.id },
      data: {
        status: 'ordered',
        prePaidBySwarm: true,
        orderRef,
        orderedAt: item.orderedAt ?? now,
        notes: [
          item.notes,
          `Swarm payment: ${totalAmount} ${currency} (${orderRef}) @ ${now.toISOString()}`,
        ].filter(Boolean).join('\n'),
      },
    })
  }

  const auditId = await appendAudit({
    entityType: 'procurement_item',
    entityId: items.map((i) => i.id).join(','),
    action: 'swarm_paid',
    dataSource: 'internal_ledger_only',
    performedBy,
    metadata: { orderRef, totalAmount, currency, provider: provider ?? 'swarm_ledger', itemCount: items.length },
  })

  return { success: true, itemsPaid: items.length, totalAmount, currency, transactionLogId: log.id, auditEntryId: auditId, orderRef }
}

// ─── 2. Swarm ledger snapshot ───────────────────────────────────────

/**
 * Surplus = verified revenue − procurement spend. This is what can be
 * routed to owner accounts (and only as inbound settlements).
 */
export async function getSwarmLedgerSnapshot(currency = 'USD'): Promise<SwarmLedgerSnapshot> {
  const [revenueAgg, spendAgg, pendingCount] = await Promise.all([
    db.revenueEvent.aggregate({
      where: { status: { in: ['verified', 'completed', 'paid'] } },
      _sum: { amount: true },
    }),
    db.transactionLog.aggregate({
      where: { category: 'procurement', status: { in: ['paid', 'completed'] } },
      _sum: { amount: true },
    }),
    db.ownerSettlement.count({
      where: { status: 'pending', direction: 'inbound', purpose: 'reconciliation' },
    }),
  ])

  const totalRevenueVerified = revenueAgg._sum.amount ?? 0
  const totalProcurementSpend = spendAgg._sum.amount ?? 0
  return {
    totalRevenueVerified,
    totalProcurementSpend,
    surplus: Math.round((totalRevenueVerified - totalProcurementSpend) * 100) / 100,
    pendingOwnerSettlements: pendingCount,
    currency,
  }
}

// ─── 3. Reconcile swarm surplus to owner accounts ───────────────────

export interface OwnerReconciliationResult {
  success: boolean
  settlementsCreated: number
  surplus: number
  accounts: string[]
  error?: string
}

/**
 * Route the swarm surplus to owner accounts as INBOUND, PENDING settlements.
 * Owners only RECEIVE — this function never debits an owner account and never
 * marks a settlement 'completed' (externalRef required, see strict-settlement).
 */
export async function reconcileSwarmToOwnerAccounts(opts: {
  currency?: string
  performedBy?: string
  amount?: number
} = {}): Promise<OwnerReconciliationResult> {
  const { currency = 'USD', performedBy = 'system', amount } = opts
  const snapshot = await getSwarmLedgerSnapshot(currency)
  const surplus = Math.max(0, amount ?? snapshot.surplus)

  if (surplus <= 0) {
    return { success: true, settlementsCreated: 0, surplus: 0, accounts: [] }
  }

  const accounts = await db.ownerAccount.findMany({
    where: {
      isActive: true,
      OR: [
        { purposes: { contains: 'reconciliation' } },
        { purposes: { contains: 'settlement' } },
        { purposes: { contains: 'salary' } },
        { isPrimary: true },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  if (accounts.length === 0) {
    return { success: false, settlementsCreated: 0, surplus, accounts: [], error: 'No active owner accounts eligible to receive settlements' }
  }

  const primary = accounts.find((a) => a.isPrimary) ?? accounts[0]
  const destinationLabel =
    primary.accountType === 'bank_wire'
      ? `RIB ${primary.accountNumberLast ?? primary.accountNumber ?? 'unknown'}`
      : primary.accountType === 'l2_crypto'
        ? primary.walletAddressShort ?? 'wallet'
        : primary.payoneerId ?? primary.paypalEmail ?? primary.label

  const settlement = await db.ownerSettlement.create({
    data: {
      ownerAccountId: primary.id,
      amount: surplus,
      currency,
      status: 'pending',
      direction: 'inbound',
      purpose: 'reconciliation',
      description: 'Swarm surplus routed to owner (inbound)',
      sourceLabel: 'Swarm ledger reconciliation',
      destinationLabel,
      dataSource: 'internal_ledger_only',
      metadata: JSON.stringify({
        totalRevenueVerified: snapshot.totalRevenueVerified,
        totalProcurementSpend: snapshot.totalProcurementSpend,
        note: 'STRICT: awaiting real funded rail (externalRef) before completed',
      }),
    },
  })

  await appendAudit({
    entityType: 'settlement',
    entityId: settlement.id,
    action: 'reconciled_pending',
    dataSource: 'internal_ledger_only',
    performedBy,
    metadata: { amount: surplus, currency, ownerAccountId: primary.id, direction: 'inbound' },
  })

  return {
    success: true,
    settlementsCreated: 1,
    surplus,
    accounts: accounts.map((a) => a.label),
  }
}
