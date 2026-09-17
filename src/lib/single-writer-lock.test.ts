import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auditLedger, sha256 } = vi.hoisted(() => ({
  auditLedger: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  sha256: vi.fn((input: string) => `hash:${input}`),
}))

vi.mock('./db', () => ({
  prisma: {
    auditLedger,
  },
}))

vi.mock('./strict-enforcement/crypto-utils', () => ({
  sha256,
}))

import { acquireLock, computeStateHash, releaseLock } from './single-writer-lock'

describe('single-writer lock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'))
    auditLedger.findFirst.mockReset()
    auditLedger.create.mockReset()
    auditLedger.update.mockReset()
    sha256.mockImplementation((input: string) => `hash:${input}`)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('computes a stable state hash payload with normalized amount and empty metadata', async () => {
    const hash = await computeStateHash({
      entityType: 'payout',
      entityId: 'po_123',
      state: 'READY',
      amount: 42,
      currency: 'USD',
      channel: 'paypal',
    })

    expect(hash).toBe('hash:payout|po_123|READY|42.000000|USD|paypal|{}')
  })

  it('reuses an active lock when the state hash matches', async () => {
    const createdAt = new Date('2026-09-17T09:59:55.000Z')
    auditLedger.findFirst.mockResolvedValueOnce({
      id: 'lock-1',
      createdAt,
      metadata: JSON.stringify({
        stateHash: 'state-1',
        expiresAt: '2026-09-17T10:00:20.000Z',
      }),
    })

    const result = await acquireLock('payout', 'po_123', 'state-1')

    expect(result).toEqual({
      acquired: true,
      lockId: 'lock-1',
      stateHash: 'state-1',
      acquiredAt: createdAt,
      expiresAt: new Date('2026-09-17T10:00:20.000Z'),
    })
    expect(auditLedger.create).not.toHaveBeenCalled()
  })

  it('rejects an active conflicting lock before creating anything new', async () => {
    auditLedger.findFirst.mockResolvedValueOnce({
      id: 'lock-1',
      createdAt: new Date('2026-09-17T09:59:55.000Z'),
      metadata: JSON.stringify({
        stateHash: 'other-state',
        expiresAt: '2026-09-17T10:00:20.000Z',
      }),
    })

    const result = await acquireLock('payout', 'po_123', 'state-1')

    expect(result).toEqual({
      acquired: false,
      lockId: '',
      stateHash: 'state-1',
      conflictWith: 'lock-1',
    })
    expect(auditLedger.create).not.toHaveBeenCalled()
  })

  it('creates a fresh lock and state-hash record after an expired lock', async () => {
    auditLedger.findFirst
      .mockResolvedValueOnce({
        id: 'expired-lock',
        createdAt: new Date('2026-09-17T09:59:00.000Z'),
        metadata: JSON.stringify({
          stateHash: 'old-state',
          expiresAt: '2026-09-17T09:59:30.000Z',
        }),
      })
      .mockResolvedValueOnce(null)
    auditLedger.create
      .mockResolvedValueOnce({
        id: 'lock-2',
        entryHash: 'entry-hash-2',
      })
      .mockResolvedValueOnce({
        id: 'state-2',
      })

    const result = await acquireLock('payout', 'po_123', 'state-2')

    expect(result).toEqual({
      acquired: true,
      lockId: 'lock-2',
      stateHash: 'state-2',
      acquiredAt: new Date('2026-09-17T10:00:00.000Z'),
      expiresAt: new Date('2026-09-17T10:00:30.000Z'),
    })
    expect(auditLedger.findFirst).toHaveBeenCalledTimes(2)
    expect(auditLedger.create).toHaveBeenNthCalledWith(1, {
      data: {
        entityType: 'lock',
        entityId: 'payout:po_123',
        action: 'acquired',
        entryHash: 'hash:lock:payout:po_123:state-2:1789639200000',
        performedBy: 'single-writer-lock',
        metadata: JSON.stringify({
          stateHash: 'state-2',
          expiresAt: '2026-09-17T10:00:30.000Z',
          lockKey: 'payout:po_123',
        }),
      },
    })
    expect(auditLedger.create).toHaveBeenNthCalledWith(2, {
      data: {
        entityType: 'state_hash',
        entityId: 'po_123',
        action: 'recorded',
        entryHash: 'state-2',
        previousHash: 'entry-hash-2',
        performedBy: 'single-writer-lock',
        metadata: JSON.stringify({
          entityType: 'payout',
          entityId: 'po_123',
          stateHash: 'state-2',
          recordedAt: '2026-09-17T10:00:00.000Z',
        }),
      },
    })
  })

  it('blocks acquisition when the same state hash was already recorded', async () => {
    auditLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'state-hash-1',
      })

    const result = await acquireLock('payout', 'po_123', 'state-1')

    expect(result).toEqual({
      acquired: false,
      lockId: '',
      stateHash: 'state-1',
      conflictWith: 'state-hash-1',
    })
    expect(auditLedger.create).not.toHaveBeenCalled()
  })

  it('marks a lock entry as released', async () => {
    await releaseLock('lock-1')

    expect(auditLedger.update).toHaveBeenCalledWith({
      where: { id: 'lock-1' },
      data: { action: 'released' },
    })
  })
})
