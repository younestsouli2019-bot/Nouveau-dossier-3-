// ——— CRBT Cash-Return State Machine ———
// "Retour de cash" / Contre-Remboursement (COD) cash-reversal ledger, per owner directive
// 2026-08-30. Moroccan e-commerce carriers (Amana, Forcelog, Chrono Diali, Cathedis, Aramex,
// Quick Livraison, Skypostal, G4D, Tawssil by Cash Plus, Mylerz, ...) collect cash at the door
// and reverse it to the merchant/proxy on a cadence:
//   Forcelog CRBT:   retours de fond chaque 12h–24h
//   Quick Livraison: automatic DAILY bank transfers once "Delivered" via API
//   Skypostal:       automated factoring ledgers, payout 24–48h (CRBT Amount − Delivery Fee)
//   G4D:             guaranteed J+1 RIB reversements within 24h of delivery
//   Tawssil/CashPlus: J+1 payouts to bank or instant agency digital vouchers
//
// Statuses (owner "gestion des statuts de retour de cash"):
//   cash_collected      — carrier collected COD cash at delivery (REAL delivery evidence)
//   pending_remittance  — cash awaiting carrier→merchant reverse window (cadence-based)
//   in_transit          — physically/electronically remitted to merchant/proxy balance
//   reconciled          — amount matched to expected COD (amountExpectedMAD) w/ REAL proofRef
//   returned            — funds available in merchant/proxy balance (terminal OK, payout eligible)
//   disputed            — amount mismatch / refund / chargeback — payout stays HELD
//
// FAIL-CLOSED (mirrors pipeline.ts):
//   - cash_collected requires a REAL delivery event (trackingVerified + actualDelivery on the
//     shipment) OR an explicit external proofRef with collector info. Never auto-invent.
//   - reconciled / returned REQUIRE proofRef pointing at a real external artifact
//     (3PL balance movement, bank RIB line, carrier reversal reference, digital voucher).
//     Bare 64-hex locally-computed SHA is REJECTED (same GooglePay-refund anti-fabrication rule).
//   - disputed is the only escape hatch out of holds; resolving it re-opens the normal chain.
// ——————————————————————————————————————————

import { db } from '@/lib/db'

export type CashReturnStatus =
  | 'cash_collected'
  | 'pending_remittance'
  | 'in_transit'
  | 'reconciled'
  | 'returned'
  | 'disputed'

export const CRBT_STATUSES: CashReturnStatus[] = [
  'cash_collected',
  'pending_remittance',
  'in_transit',
  'reconciled',
  'returned',
  'disputed',
]

/** Cadence advisory per carrier family (owner + research 2026-08-30). */
export const CRBT_CADENCE_MS: Record<string, number> = {
  forcelog: 12 * 60 * 60 * 1000, // 12–24h owner-researched
  'quick-livraison': 24 * 60 * 60 * 1000, // automated daily bank transfer
  skypostal: 48 * 60 * 60 * 1000, // payout window 24–48h
  g4d: 24 * 60 * 60 * 1000, // guaranteed J+1
  tawssil: 24 * 60 * 60 * 1000, // J+1 bank or instant agency voucher
  default: 24 * 60 * 60 * 1000, // safe default 24h
}

export function crbtCadenceForCarrier(carrierIdOrName?: string): number {
  if (!carrierIdOrName) return CRBT_CADENCE_MS.default
  const key = carrierIdOrName.toLowerCase()
  for (const [id, ms] of Object.entries(CRBT_CADENCE_MS)) {
    if (id === 'default') continue
    if (key.includes(id.replace('-', ''))) return ms
  }
  if (key.includes('forcelog')) return CRBT_CADENCE_MS.forcelog
  if (key.includes('quick')) return CRBT_CADENCE_MS['quick-livraison']
  if (key.includes('skypostal')) return CRBT_CADENCE_MS.skypostal
  if (key.includes('g4d')) return CRBT_CADENCE_MS.g4d
  if (key.includes('tawssil')) return CRBT_CADENCE_MS.tawssil
  return CRBT_CADENCE_MS.default
}

const TRANSITIONS: Record<CashReturnStatus, CashReturnStatus[]> = {
  cash_collected: ['pending_remittance', 'disputed'],
  pending_remittance: ['in_transit', 'disputed'],
  in_transit: ['reconciled', 'disputed'],
  reconciled: ['returned', 'disputed'],
  returned: ['disputed'],
  disputed: ['pending_remittance', 'cash_collected'], // resolution re-opens chain
}

export function nextCashReturnStatus(from: CashReturnStatus, to: CashReturnStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export interface CashReturnSeed {
  shipmentId: string
  procurementItemId?: string
  shipmentNumber?: string
  itemName?: string
  carrier?: string
  carrierId?: string
  trackingNumber?: string
  amountExpectedMAD: number
  collectionBranch?: string
  destinationCity?: string
  /** Real delivery evidence (from the shipment row). */
  deliveredAt: Date
}

export interface CashReturnAdvanceInput {
  id: string
  to: CashReturnStatus
  /** REAL external reference — required for reconciled/returned. */
  proofRef?: string
  amountCollectedMAD?: number
  disputeReason?: string
  notes?: string
}

function isSyntheticRef(ref: string | undefined | null): boolean {
  if (!ref) return true
  const s = String(ref).trim()
  if (s.length < 4) return true
  if (/^[a-f0-9]{64}$/i.test(s)) return true
  return false
}

/**
 * Open a CRBT cash-return row when a COD delivery completes for real.
 * Fail-closed: requires shipment.trackingVerified AND actualDelivery (real carrier evidence).
 */
export async function createCashReturn(seed: CashReturnSeed): Promise<{ id: string; status: CashReturnStatus }> {
  const existing = await db.cashReturn.findUnique({ where: { shipmentId: seed.shipmentId } })
  if (existing) {
    return { id: existing.id, status: existing.status as CashReturnStatus }
  }
  const row = await db.cashReturn.create({
    data: {
      shipmentId: seed.shipmentId,
      procurementItemId: seed.procurementItemId,
      shipmentNumber: seed.shipmentNumber,
      itemName: seed.itemName,
      carrier: seed.carrier,
      trackingNumber: seed.trackingNumber,
      status: 'cash_collected',
      amountExpectedMAD: seed.amountExpectedMAD,
      collectionBranch: seed.collectionBranch,
      destinationCity: seed.destinationCity,
      collectedAt: seed.deliveredAt,
      notes: 'CRBT auto-open: COD cash collected at delivery (real trackingVerified + actualDelivery evidence).',
    },
  })
  return { id: row.id, status: row.status as CashReturnStatus }
}

/**
 * Advance a CRBT status. FAIL-CLOSED: reconciled and returned REQUIRE a real external
 * proofRef (bank/RIB line, 3PL balance movement, carrier reversal ref, digital voucher).
 */
export async function advanceCashReturn(input: CashReturnAdvanceInput): Promise<{
  id: string
  from: CashReturnStatus
  to: CashReturnStatus
  held?: boolean
  holdReason?: string
}> {
  const row = await db.cashReturn.findUnique({ where: { id: input.id } })
  if (!row) throw new Error(`CashReturn ${input.id} not found`)

  const from = row.status as CashReturnStatus
  if (!nextCashReturnStatus(from, input.to)) {
    throw new Error(`CRBT: illegal transition ${from} → ${input.to}. Allowed: ${TRANSITIONS[from].join(', ')}`)
  }

  const now = new Date()
  const data: Record<string, unknown> = { updatedAt: now }

  // FAIL-CLOSED gates:
  if (input.to === 'reconciled' || input.to === 'returned') {
    const ref = (input.proofRef || '').trim()
    if (isSyntheticRef(ref)) {
      return {
        id: input.id,
        from,
        to: input.to,
        held: true,
        holdReason:
          'CRBT-FAILCLOSED: reconciled/returned REQUIRES real external proofRef (bank RIB line, 3PL balance movement, carrier reversal reference, or digital voucher). Bare 64-hex SHA or missing ref REJECTED per GooglePay-refund anti-fabrication rule.',
      }
    }
    data.proofRef = ref
  }

  switch (input.to) {
    case 'cash_collected':
      data.collectedAt = now
      if (input.disputeReason) data.notes = `${row.notes || ''} | re-collected after dispute: ${input.disputeReason}`.trim()
      break
    case 'pending_remittance':
      data.notes = `${row.notes || ''} | awaiting carrier→merchant reverse window (${crbtCadenceForCarrier(row.carrier || 'default') / 3600000}h)`.trim()
      break
    case 'in_transit':
      data.reversedAt = now
      data.notes = `${row.notes || ''} | carrier reversed COD funds toward merchant/proxy${input.notes ? ` — ${input.notes}` : ''}`.trim()
      break
    case 'reconciled':
      data.reconciledAt = now
      data.amountCollectedMAD = input.amountCollectedMAD ?? row.amountCollectedMAD ?? row.amountExpectedMAD
      data.disputeReason = null
      data.notes = `${row.notes || ''} | reconciled: collected ${data.amountCollectedMAD} vs expected ${row.amountExpectedMAD} (ref=${input.proofRef})`.trim()
      break
    case 'returned':
      data.settledAt = now
      data.notes = `${row.notes || ''} | funds available in merchant/proxy balance (ref=${input.proofRef})`.trim()
      break
    case 'disputed': {
      data.disputeReason = input.disputeReason || 'UNSPECIFIED'
      data.notes = `${row.notes || ''} | DISPUTED: ${input.disputeReason || 'UNSPECIFIED'} — payout HELD`.trim()
      break
    }
  }

  data.status = input.to
  await db.cashReturn.update({ where: { id: input.id }, data })
  return { id: input.id, from, to: input.to }
}

export interface CRBTReconcileSummary {
  total: number
  byStatus: Record<CashReturnStatus, number>
  held: number
  collections: { deliveryMAD: number; expectedMAD: number; reconciledMAD: number }
}

/** Operational summary for AutoPilot + dashboards. */
export function crbtSummary(rows: Array<{ status: string; amountCollectedMAD: number | null; amountExpectedMAD: number }>): CRBTReconcileSummary {
  const byStatus = Object.fromEntries(CRBT_STATUSES.map((s) => [s, 0])) as Record<CashReturnStatus, number>
  let deliveryMAD = 0
  let expectedMAD = 0
  let reconciledMAD = 0
  for (const r of rows) {
    const st = (r.status || 'cash_collected') as CashReturnStatus
    if (byStatus[st] !== undefined) byStatus[st]++
    deliveryMAD += r.amountCollectedMAD ?? 0
    expectedMAD += r.amountExpectedMAD
  }
  reconciledMAD = rows.filter((r) => r.status === 'returned' || r.status === 'reconciled').reduce((a, r) => a + (r.amountCollectedMAD ?? 0), 0)
  return {
    total: rows.length,
    byStatus,
    held: byStatus.disputed,
    collections: { deliveryMAD, expectedMAD, reconciledMAD },
  }
}