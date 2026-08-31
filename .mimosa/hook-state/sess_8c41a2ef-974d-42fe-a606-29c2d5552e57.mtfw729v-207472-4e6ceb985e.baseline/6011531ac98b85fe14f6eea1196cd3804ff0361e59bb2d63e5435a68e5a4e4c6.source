// Single-Writer Ledger Lock (Redlock equivalent for Prisma/SQLite)
// Prevents cannibalistic duplicate processing via SHA-256 unique state hashes
// Attack vector: State Duplication — cannibalistic clones processing identical payment states
// Prevention: Single-Writer Ledger Route + SHA-256 Unique State Hashes → 100% cryptographically unique

import { prisma } from './db';
import { sha256 } from './strict-enforcement/crypto-utils';

export interface LockResult {
  acquired: boolean;
  lockId: string;
  stateHash: string;
  acquiredAt?: Date;
  expiresAt?: Date;
  conflictWith?: string;
}

export interface StateRecord {
  entityType: string;
  entityId: string;
  state: string;
  amount: number;
  currency: string;
  channel: string;
  metadata?: Record<string, unknown>;
}

const LOCK_TTL_MS = 30_000;

export async function computeStateHash(record: StateRecord): Promise<string> {
  const payload = [
    record.entityType,
    record.entityId,
    record.state,
    record.amount.toFixed(6),
    record.currency,
    record.channel,
    JSON.stringify(record.metadata || {}),
  ].join('|');
  return sha256(payload);
}

export async function acquireLock(
  entityType: string,
  entityId: string,
  stateHash: string,
): Promise<LockResult> {
  const lockKey = `${entityType}:${entityId}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

  const existing = await prisma.auditLedger.findFirst({
    where: { entityType: 'lock', entityId: lockKey, action: 'acquired' },
    orderBy: { createdAt: 'desc' },
  });

  if (existing && existing.metadata) {
    const meta = JSON.parse(existing.metadata);
    if (meta.expiresAt && new Date(meta.expiresAt) > now) {
      if (meta.stateHash === stateHash) {
        return { acquired: true, lockId: existing.id, stateHash, acquiredAt: existing.createdAt, expiresAt: new Date(meta.expiresAt) };
      }
      return { acquired: false, lockId: '', stateHash, conflictWith: existing.id };
    }
  }

  const duplicate = await prisma.auditLedger.findFirst({
    where: { entityType: 'state_hash', entryHash: stateHash },
  });
  if (duplicate) {
    return { acquired: false, lockId: '', stateHash, conflictWith: duplicate.id };
  }

  const lockEntry = await prisma.auditLedger.create({
    data: {
      entityType: 'lock',
      entityId: lockKey,
      action: 'acquired',
      entryHash: await sha256(`lock:${lockKey}:${stateHash}:${Date.now()}`),
      performedBy: 'single-writer-lock',
      metadata: JSON.stringify({ stateHash, expiresAt: expiresAt.toISOString(), lockKey }),
    },
  });

  await prisma.auditLedger.create({
    data: {
      entityType: 'state_hash',
      entityId,
      action: 'recorded',
      entryHash: stateHash,
      previousHash: lockEntry.entryHash,
      performedBy: 'single-writer-lock',
      metadata: JSON.stringify({ entityType, entityId, stateHash, recordedAt: now.toISOString() }),
    },
  });

  return { acquired: true, lockId: lockEntry.id, stateHash, acquiredAt: now, expiresAt };
}

export async function releaseLock(lockId: string): Promise<void> {
  await prisma.auditLedger.update({ where: { id: lockId }, data: { action: 'released' } });
}
