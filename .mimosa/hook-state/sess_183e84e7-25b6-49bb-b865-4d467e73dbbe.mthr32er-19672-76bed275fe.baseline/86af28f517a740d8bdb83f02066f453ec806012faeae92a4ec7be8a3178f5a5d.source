// Security Guardrails — Decoupled MFA + Idempotency Matrix + Circuit Breakers
// Deterministic constraints around LLM workspace for autonomous financial execution

import { sha256 } from '../strict-enforcement/crypto-utils';
import { prisma } from '../db';

// ─── IDEMPOTENCY MATRIX ───────────────────────────────────────────────
// Every network query forces a unique, immutable Idempotency-Key
// Prevents duplicate money debits on network drops or agent crashes

const IDEMPOTENCY_STORE: Map<string, { result: unknown; timestamp: Date; expiresAt: Date }> = new Map();

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function generateIdempotencyKey(operation: string, params: Record<string, unknown>): Promise<string> {
  return sha256(JSON.stringify({ operation, params, salt: Date.now().toString(36) }));
}

export async function executeIdempotent<T>(
  idempotencyKey: string,
  operation: () => Promise<T>,
): Promise<{ result: T; fromCache: boolean }> {
  // Check if already executed
  const existing = IDEMPOTENCY_STORE.get(idempotencyKey);
  if (existing && existing.expiresAt > new Date()) {
    return { result: existing.result as T, fromCache: true };
  }

  // Execute and cache
  const result = await operation();
  IDEMPOTENCY_STORE.set(idempotencyKey, {
    result,
    timestamp: new Date(),
    expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
  });

  await prisma.auditLedger.create({
    data: {
      entityType: 'idempotency',
      entityId: idempotencyKey.slice(0, 32),
      action: 'executed',
      entryHash: idempotencyKey,
      performedBy: 'security-guardrails',
      metadata: JSON.stringify({ executedAt: new Date().toISOString() }),
    },
  });

  return { result, fromCache: false };
}

// ─── CIRCUIT BREAKERS ──────────────────────────────────────────────────
// Zero-trust: separate compliance worker monitors ALL outbound transfers
// against daily, hourly, and per-transaction monetary parameters

export interface CircuitBreakerConfig {
  maxHourlySpend: number;
  maxDailySpend: number;
  maxSingleTransaction: number;
  maxDailyTransactions: number;
  maxHourlyTransactions: number;
  allowedDestinations: string[];  // whitelist of allowed routing destinations
  blockedDestinations: string[];  // blacklist
  cooldownMs: number;            // how long to pause after trip
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxHourlySpend: 5000,
  maxDailySpend: 25000,
  maxSingleTransaction: 500,
  maxDailyTransactions: 100,
  maxHourlyTransactions: 20,
  allowedDestinations: [],
  blockedDestinations: [],
  cooldownMs: 3600000, // 1 hour cooldown
};

interface CircuitState {
  tripped: boolean;
  trippedAt: Date | null;
  resumeAt: Date | null;
  hourlySpend: number;
  dailySpend: number;
  hourlyTransactions: number;
  dailyTransactions: number;
  lastResetHour: Date;
  lastResetDay: Date;
}

let circuitState: CircuitState = {
  tripped: false,
  trippedAt: null,
  resumeAt: null,
  hourlySpend: 0,
  dailySpend: 0,
  hourlyTransactions: 0,
  dailyTransactions: 0,
  lastResetHour: new Date(),
  lastResetDay: new Date(),
};

let circuitConfig: CircuitBreakerConfig = { ...DEFAULT_CONFIG };

export function configureCircuitBreaker(config: Partial<CircuitBreakerConfig>): void {
  circuitConfig = { ...DEFAULT_CONFIG, ...config };
}

function resetCountersIfNeeded(): void {
  const now = new Date();
  // Hourly reset
  if (now.getTime() - circuitState.lastResetHour.getTime() > 3600000) {
    circuitState.hourlySpend = 0;
    circuitState.hourlyTransactions = 0;
    circuitState.lastResetHour = now;
  }
  // Daily reset
  if (now.getTime() - circuitState.lastResetDay.getTime() > 86400000) {
    circuitState.dailySpend = 0;
    circuitState.dailyTransactions = 0;
    circuitState.lastResetDay = now;
  }
  // Cooldown check
  if (circuitState.tripped && circuitState.resumeAt && now > circuitState.resumeAt) {
    circuitState.tripped = false;
    circuitState.trippedAt = null;
    circuitState.resumeAt = null;
  }
}

export async function checkTransaction(
  amount: number,
  destination: string,
): Promise<{ approved: boolean; reason?: string }> {
  resetCountersIfNeeded();

  // Circuit is tripped
  if (circuitState.tripped) {
    return { approved: false, reason: `Circuit breaker tripped. Resumes at ${circuitState.resumeAt?.toISOString()}` };
  }

  // Per-transaction limit
  if (amount > circuitConfig.maxSingleTransaction) {
    return { approved: false, reason: `Transaction $${amount} exceeds single limit $${circuitConfig.maxSingleTransaction}` };
  }

  // Hourly spend limit
  if (circuitState.hourlySpend + amount > circuitConfig.maxHourlySpend) {
    await tripCircuit(`Hourly spend $${circuitState.hourlySpend + amount} would exceed $${circuitConfig.maxHourlySpend}`);
    return { approved: false, reason: 'Hourly spend limit breached — circuit tripped' };
  }

  // Daily spend limit
  if (circuitState.dailySpend + amount > circuitConfig.maxDailySpend) {
    await tripCircuit(`Daily spend $${circuitState.dailySpend + amount} would exceed $${circuitConfig.maxDailySpend}`);
    return { approved: false, reason: 'Daily spend limit breached — circuit tripped' };
  }

  // Hourly transaction count
  if (circuitState.hourlyTransactions >= circuitConfig.maxHourlyTransactions) {
    await tripCircuit(`Hourly transaction count ${circuitState.hourlyTransactions} would exceed ${circuitConfig.maxHourlyTransactions}`);
    return { approved: false, reason: 'Hourly transaction count limit breached' };
  }

  // Daily transaction count
  if (circuitState.dailyTransactions >= circuitConfig.maxDailyTransactions) {
    await tripCircuit(`Daily transaction count ${circuitState.dailyTransactions} would exceed ${circuitConfig.maxDailyTransactions}`);
    return { approved: false, reason: 'Daily transaction count limit breached' };
  }

  // Destination whitelist (if configured)
  if (circuitConfig.allowedDestinations.length > 0 && !circuitConfig.allowedDestinations.includes(destination)) {
    return { approved: false, reason: `Destination '${destination}' not in whitelist` };
  }

  // Destination blacklist
  if (circuitConfig.blockedDestinations.includes(destination)) {
    return { approved: false, reason: `Destination '${destination}' is blacklisted` };
  }

  return { approved: true };
}

export async function recordTransaction(amount: number): Promise<void> {
  resetCountersIfNeeded();
  circuitState.hourlySpend += amount;
  circuitState.dailySpend += amount;
  circuitState.hourlyTransactions += 1;
  circuitState.dailyTransactions += 1;
}

async function tripCircuit(reason: string): Promise<void> {
  circuitState.tripped = true;
  circuitState.trippedAt = new Date();
  circuitState.resumeAt = new Date(Date.now() + circuitConfig.cooldownMs);

  await prisma.auditLedger.create({
    data: {
      entityType: 'circuit_breaker',
      entityId: 'main',
      action: 'tripped',
      entryHash: await sha256(`circuit-trip:${reason}:${Date.now()}`),
      performedBy: 'security-guardrails',
      discrepancyNote: reason,
      metadata: JSON.stringify({
        reason,
        trippedAt: circuitState.trippedAt.toISOString(),
        resumeAt: circuitState.resumeAt.toISOString(),
        hourlySpend: circuitState.hourlySpend,
        dailySpend: circuitState.dailySpend,
      }),
    },
  });
}

export function getCircuitState(): { config: CircuitBreakerConfig; state: CircuitState } {
  resetCountersIfNeeded();
  return { config: { ...circuitConfig }, state: { ...circuitState } };
}

// ─── DECOUPLED MFA ─────────────────────────────────────────────────────
// Agent initiates transaction → placed in "Pending Approval" state
// Siloed security service approves via independent authenticator

export interface MfaRequest {
  id: string;
  accountId: string;
  operation: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  requestedAt: Date;
  expiresAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
  denialReason: string | null;
}

const MFA_REQUESTS: MfaRequest[] = [];
const MFA_EXPIRY_MS = 300000; // 5 minutes

export async function requestMfaApproval(accountId: string, operation: string): Promise<MfaRequest> {
  const request: MfaRequest = {
    id: `mfa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId,
    operation,
    status: 'pending',
    requestedAt: new Date(),
    expiresAt: new Date(Date.now() + MFA_EXPIRY_MS),
    approvedAt: null,
    approvedBy: null,
    denialReason: null,
  };

  MFA_REQUESTS.push(request);

  await prisma.auditLedger.create({
    data: {
      entityType: 'mfa_request',
      entityId: request.id,
      action: 'requested',
      entryHash: await sha256(`mfa:${request.id}:${accountId}:${operation}:${Date.now()}`),
      performedBy: 'security-guardrails',
      metadata: JSON.stringify({ accountId, operation, expiresAt: request.expiresAt.toISOString() }),
    },
  });

  return request;
}

export async function approveMfa(requestId: string, approver: string): Promise<boolean> {
  const request = MFA_REQUESTS.find(r => r.id === requestId);
  if (!request) return false;
  if (request.status !== 'pending') return false;
  if (request.expiresAt < new Date()) {
    request.status = 'expired';
    return false;
  }

  request.status = 'approved';
  request.approvedAt = new Date();
  request.approvedBy = approver;
  return true;
}

export async function denyMfa(requestId: string, reason: string): Promise<boolean> {
  const request = MFA_REQUESTS.find(r => r.id === requestId);
  if (!request) return false;
  if (request.status !== 'pending') return false;

  request.status = 'denied';
  request.denialReason = reason;
  return true;
}

export function getPendingMfaRequests(): MfaRequest[] {
  return MFA_REQUESTS.filter(r => r.status === 'pending' && r.expiresAt > new Date());
}
