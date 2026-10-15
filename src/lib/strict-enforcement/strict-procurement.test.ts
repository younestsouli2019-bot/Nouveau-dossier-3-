// Guards M-2: receipt confirmation must name a REAL human confirmer.
//
// Before this fix `confirmedBy` defaulted to the string 'system', and the
// downstream human gate (truth-guards / payment-gateway-router) only rejects
// the literal 'system-auto' — so an omitted confirmer slid through and the
// receipt was recorded as if a human had confirmed it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  procurementItem: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  purchaseOrder: { update: vi.fn() },
  auditLedger: { findFirst: vi.fn(), create: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ db: dbMock }))

import { confirmReceipt } from './strict-procurement'

const ITEM = {
  id: 'item_1',
  status: 'shipped',
  quantity: 10,
  deliveredAt: null,
  name: 'Test item',
  purchaseOrderId: null,
  deliveryProofHash: null,
}

const VALID = {
  procurementItemId: 'item_1',
  quantityReceived: 10,
  condition: 'good' as const,
  proofHash: 'pod:REAL-POD-HASH-123456',
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.procurementItem.findUnique.mockResolvedValue({ ...ITEM })
  dbMock.procurementItem.update.mockResolvedValue({ ...ITEM })
  dbMock.auditLedger.findFirst.mockResolvedValue(null)
  dbMock.auditLedger.create.mockResolvedValue({})
})

describe('confirmReceipt — RULE 0: confirmedBy must be a real human', () => {
  it('rejects an OMITTED confirmedBy (the old default was "system")', async () => {
    const res = await confirmReceipt({ ...VALID })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/TRUTH-PROC/)
    expect(res.error).toMatch(/real human recipient/)
    expect(dbMock.procurementItem.update).not.toHaveBeenCalled()
  })

  it('rejects the literal "system"', async () => {
    const res = await confirmReceipt({ ...VALID, confirmedBy: 'system' })

    expect(res.success).toBe(false)
    expect(dbMock.procurementItem.update).not.toHaveBeenCalled()
  })

  it('rejects "system-auto"', async () => {
    const res = await confirmReceipt({ ...VALID, confirmedBy: 'system-auto' })

    expect(res.success).toBe(false)
    expect(dbMock.procurementItem.update).not.toHaveBeenCalled()
  })

  it('rejects a blank / whitespace-only confirmer', async () => {
    const res = await confirmReceipt({ ...VALID, confirmedBy: '   ' })

    expect(res.success).toBe(false)
    expect(dbMock.procurementItem.update).not.toHaveBeenCalled()
  })

  it('accepts a real human confirmer and persists it verbatim', async () => {
    const res = await confirmReceipt({ ...VALID, confirmedBy: 'Younes Tsouli' })

    expect(res.success).toBe(true)
    expect(dbMock.procurementItem.update).toHaveBeenCalledTimes(1)
    const data = dbMock.procurementItem.update.mock.calls[0][0].data
    expect(data.receiptConfirmedBy).toBe('Younes Tsouli')
  })
})
