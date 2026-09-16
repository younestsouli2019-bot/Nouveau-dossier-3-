import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from './strict-enforcement/crypto-utils'

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    ownerSettlement: {
      findMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('./db', () => ({
  db: dbMock,
}))

const ownerSettlementMock = dbMock.ownerSettlement

import {
  approveAmountDiscrepancy,
  parseCamt053,
  runBankReconciliation,
} from './bank-reconciliation'

describe('parseCamt053', () => {
  it('parses XML entries including reconciliation metadata fields', () => {
    const xml = `
      <Document>
        <Ntry>
          <Amt Ccy="EUR">95.00</Amt>
          <AcctSvcrRef>bank-tx-1</AcctSvcrRef>
          <BookgDt><Dt>2026-09-15</Dt></BookgDt>
          <CdtDbtInd>DBIT</CdtDbtInd>
          <Ref>ext-123</Ref>
          <EndToEndId>e2e-123</EndToEndId>
          <Nm>Vendor A</Nm>
          <IBAN>MA6400112233445566778899</IBAN>
          <Chrgs><Chrg><Amt Ccy="EUR">5.00</Amt></Chrg></Chrgs>
          <XchgRate>1.10</XchgRate>
        </Ntry>
      </Document>
    `

    expect(parseCamt053(xml)).toEqual([
      {
        transactionId: 'bank-tx-1',
        date: '2026-09-15',
        amount: 95,
        currency: 'EUR',
        counterpartyName: 'Vendor A',
        counterpartyIban: 'MA6400112233445566778899',
        reference: 'ext-123',
        endToEndId: 'e2e-123',
        bookingStatus: 'DBIT',
        bankFee: 5,
        exchangeRate: 1.1,
      },
    ])
  })
})

describe('runBankReconciliation', () => {
  const fixedNow = new Date('2026-09-16T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-settles exact matches but leaves fee-explained discrepancies for human signoff', async () => {
    ownerSettlementMock.findMany.mockResolvedValue([
      {
        id: 'settlement-exact',
        amount: 110,
        currency: 'USD',
        externalRef: null,
        referenceId: null,
        status: 'pending',
      },
      {
        id: 'settlement-fee-gap',
        amount: 100,
        currency: 'USD',
        externalRef: null,
        referenceId: 'e2e-fee-gap',
        status: 'processing',
      },
    ])
    ownerSettlementMock.update.mockResolvedValue({})

    const xmlStatement = `
      <Document>
        <Ntry>
          <Amt Ccy="USD">110.00</Amt>
          <AcctSvcrRef>bank-exact</AcctSvcrRef>
          <BookgDt><Dt>2026-09-15</Dt></BookgDt>
          <CdtDbtInd>CRDT</CdtDbtInd>
        </Ntry>
        <Ntry>
          <Amt Ccy="USD">95.00</Amt>
          <AcctSvcrRef>bank-fee-gap</AcctSvcrRef>
          <BookgDt><Dt>2026-09-15</Dt></BookgDt>
          <CdtDbtInd>CRDT</CdtDbtInd>
          <EndToEndId>e2e-fee-gap</EndToEndId>
          <Chrgs><Chrg><Amt Ccy="USD">5.00</Amt></Chrg></Chrgs>
        </Ntry>
      </Document>
    `

    const report = await runBankReconciliation(xmlStatement)

    expect(report.matched).toBe(2)
    expect(report.exactMatches).toBe(1)
    expect(report.amountDiscrepancies).toBe(1)
    expect(report.humanSignoffRequired).toEqual(['settlement-fee-gap'])
    expect(report.unmatchedInternal).toBe(0)
    expect(report.unmatchedBank).toBe(0)

    expect(ownerSettlementMock.update).toHaveBeenCalledTimes(1)
    expect(ownerSettlementMock.update).toHaveBeenCalledWith({
      where: { id: 'settlement-exact' },
      data: {
        status: 'completed',
        externalRef: 'bank-exact',
        verifiedAt: fixedNow,
        proofHash: sha256('settlement-exact:bank-exact:110:USD:reconciled'),
        settledAt: fixedNow,
        dataSource: 'live_bank_api',
        connectorStatus: 'live',
      },
    })
  })

  it('blocks duplicate bank transaction ids from matching even when amounts line up', async () => {
    ownerSettlementMock.findMany.mockResolvedValue([
      {
        id: 'settlement-dup',
        amount: 50,
        currency: 'USD',
        externalRef: null,
        referenceId: null,
        status: 'pending',
      },
    ])
    ownerSettlementMock.update.mockResolvedValue({})

    const xml = `
      <Document>
        <Ntry>
          <Amt Ccy="USD">50.00</Amt>
          <AcctSvcrRef>dup-bank-tx</AcctSvcrRef>
          <BookgDt><Dt>2026-09-15</Dt></BookgDt>
          <CdtDbtInd>CRDT</CdtDbtInd>
        </Ntry>
        <Ntry>
          <Amt Ccy="USD">50.00</Amt>
          <AcctSvcrRef>dup-bank-tx</AcctSvcrRef>
          <BookgDt><Dt>2026-09-15</Dt></BookgDt>
          <CdtDbtInd>CRDT</CdtDbtInd>
        </Ntry>
      </Document>
    `

    const report = await runBankReconciliation(xml)

    expect(report.matched).toBe(0)
    expect(report.duplicatesBlocked).toBe(1)
    expect(report.duplicateBankTxIds).toEqual(['dup-bank-tx'])
    expect(report.unmatchedSettlementIds).toEqual(['settlement-dup'])
    expect(report.unmatchedBankIds).toEqual([])
    expect(ownerSettlementMock.update).not.toHaveBeenCalled()
  })
})

describe('approveAmountDiscrepancy', () => {
  const fixedNow = new Date('2026-09-16T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects approval when the settlement is already terminal', async () => {
    ownerSettlementMock.findUnique.mockResolvedValue({
      id: 'settlement-terminal',
      amount: 75,
      status: 'completed',
    })

    await expect(
      approveAmountDiscrepancy('settlement-terminal', 'bank-1', 'qa-user'),
    ).resolves.toEqual({
      success: false,
      error: 'Settlement status is completed, expected pending/processing/needs_manual_proof',
    })

    expect(ownerSettlementMock.update).not.toHaveBeenCalled()
  })

  it('records human approval metadata and closes the settlement', async () => {
    ownerSettlementMock.findUnique.mockResolvedValue({
      id: 'settlement-manual',
      amount: 83.5,
      status: 'needs_manual_proof',
    })
    ownerSettlementMock.update.mockResolvedValue({})

    await expect(
      approveAmountDiscrepancy('settlement-manual', 'bank-manual', 'risk-ops'),
    ).resolves.toEqual({ success: true })

    expect(ownerSettlementMock.update).toHaveBeenCalledWith({
      where: { id: 'settlement-manual' },
      data: {
        status: 'completed',
        externalRef: 'bank-manual',
        verifiedAt: fixedNow,
        proofHash: sha256('settlement-manual:bank-manual:83.5:human_approved:risk-ops'),
        settledAt: fixedNow,
        dataSource: 'live_bank_api',
        connectorStatus: 'live',
        metadata: JSON.stringify({
          humanApprovedBy: 'risk-ops',
          humanApprovedAt: fixedNow.toISOString(),
          matchType: 'amount_discrepancy_approved',
        }),
      },
    })
  })
})
