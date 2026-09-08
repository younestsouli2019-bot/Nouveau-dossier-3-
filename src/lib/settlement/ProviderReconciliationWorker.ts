import { prisma } from '../db';
import { SettlementState, isSyntheticRef, SettlementRail } from './SettlementEngine';

const MS = 1;
const SEC = 1000 * MS;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

export const RAIL_TIMEOUTS: Record<SettlementRail['kind'], { processHours: number; l2Multiplier: number }> = {
  paypal: { processHours: 4, l2Multiplier: 2 },
  stripe: { processHours: 4, l2Multiplier: 2 },
  wise: { processHours: 4, l2Multiplier: 2 },
  google_pay: { processHours: 4, l2Multiplier: 2 },
  tron: { processHours: 4, l2Multiplier: 2 },
  crypto: { processHours: 4, l2Multiplier: 2 },
  bank_wire: { processHours: 24, l2Multiplier: 2 },
  attijari: { processHours: 24, l2Multiplier: 2 },
  payoneer: { processHours: 24, l2Multiplier: 2 },
};

export const STUCK_RESERVATION_MIN = 10;
export const L1_SEVERITY = 'L1';
export const L2_SEVERITY = 'L2';

export interface ReconcileResult {
  payoutItemId: string;
  action:
    | 'PROCESSING_RECHECKED'
    | 'PROCESSING_TIMEOUT_UNKNOWN_L1'
    | 'UNKNOWN_L2_QUARANTINED'
    | 'RECONCILE_SUCCESS'
    | 'RECONCILE_REJECTED'
    | 'RECONCILE_NO_RESPONSE_STILL_UNKNOWN'
    | 'RESERVATION_RELEASED'
    | 'SKIP';
  notes?: string;
  escalationCreatedId?: string;
  finalProviderRef?: string;
}

export class ProviderReconciliationWorker {
  private rails: Map<SettlementRail['kind'], SettlementRail> = new Map();

  setRails(map: Map<SettlementRail['kind'], SettlementRail>): void {
    this.rails = map;
  }

  registerRail(rail: SettlementRail): void {
    this.rails.set(rail.kind, rail);
  }

  private now(): Date {
    return new Date();
  }

  private ageMs(date: Date | null | undefined): number {
    if (!date) return Infinity;
    return Math.max(0, this.now().getTime() - new Date(date).getTime());
  }

  private async escalate(params: {
    payoutItemId: string;
    payoutBatchId?: string | null;
    severity: typeof L1_SEVERITY | typeof L2_SEVERITY;
    reason: string;
    currentState: string;
    ageMs: number;
    amount?: number;
    currency?: string;
    paymentMethod?: string;
    batchNumber?: string;
    actor?: string;
  }): Promise<string | undefined> {
    const {
      payoutItemId,
      payoutBatchId,
      severity,
      reason,
      currentState,
      ageMs: age,
      amount = 0,
      currency = 'USD',
      paymentMethod,
      batchNumber,
      actor = 'ProviderReconciliationWorker',
    } = params;
    try {
      let resolvedBatchNumber = batchNumber;
      let resolvedPayoutBatchId = payoutBatchId ?? undefined;
      let resolvedProvider = paymentMethod ?? 'unknown';
      let itemCount = 1;
      let resolvedAmount = amount;
      let resolvedCurrency = currency;
      if (!resolvedBatchNumber && payoutBatchId) {
        const batch = await prisma.payoutBatch.findUnique({
          where: { id: payoutBatchId },
          select: { id: true, batchNumber: true, totalAmount: true, currency: true, itemCount: true, paymentProvider: true },
        }).catch(() => null);
        if (batch) {
          resolvedBatchNumber = batch.batchNumber;
          resolvedAmount = batch.totalAmount ?? amount;
          resolvedCurrency = batch.currency ?? currency;
          resolvedProvider = batch.paymentProvider ?? resolvedProvider;
          itemCount = batch.itemCount ?? 1;
          if (!resolvedPayoutBatchId) resolvedPayoutBatchId = batch.id;
        }
      }
      const actionEntry = JSON.stringify({
        actor,
        reason,
        currentState,
        ageMs: age,
        payoutItemId,
      });
      const created = await prisma.paymentEscalation.create({
        data: {
          payoutBatchId: resolvedPayoutBatchId ?? 'UNATTACHED',
          batchNumber: resolvedBatchNumber ?? `ESCALATION-${Date.now()}`,
          provider: String(resolvedProvider),
          amount: resolvedAmount,
          currency: String(resolvedCurrency),
          itemCount,
          severity,
          status: 'open',
          submittedAt: this.now(),
          escalatedAt: this.now(),
          actionTaken: actionEntry,
        },
        select: { id: true },
      });
      void payoutItemId;
      return created.id;
    } catch (err) {
      console.error(`[ProviderReconciliationWorker] escalate failed for payoutItem=${params.payoutItemId}`, err);
      return undefined;
    }
  }

  private async writeAudit(
    payoutItemId: string,
    fromState: string,
    toState: SettlementState,
    performedBy: string,
    reason: string,
    extra: Record<string, unknown> = {},
    payoutBatchId: string | null | undefined = undefined,
  ): Promise<void> {
    try {
      await prisma.payoutAuditLog.create({
        data: {
          entityType: 'PayoutItem',
          entityId: payoutItemId,
          action: `STATE_TRANSITION_${toState}`,
          oldValue: fromState,
          newValue: JSON.stringify({ stateTo: toState, ...extra }),
          reason,
          performedBy,
          payoutItemId,
          payoutBatchId: payoutBatchId ?? undefined,
        },
      });
    } catch (err) {
      console.error(`[ProviderReconciliationWorker] writeAudit failed id=${payoutItemId} to=${toState}`, err);
    }
  }

  async releaseStuckReservations(): Promise<ReconcileResult[]> {
    const results: ReconcileResult[] = [];
    const cutoff = new Date(this.now().getTime() - STUCK_RESERVATION_MIN * MIN);
    const stuck = await prisma.payoutItem.findMany({
      where: {
        status: { in: [SettlementState.RESERVATION, SettlementState.INSTRUCTION] },
        updatedAt: { lte: cutoff },
      },
      select: { id: true, status: true, updatedAt: true, payoutBatchId: true },
    });
    for (const row of stuck) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.payoutItem.update({
            where: { id: row.id },
            data: { status: SettlementState.EXPIRED, failureReason: `Reservation/Instruction stuck >${STUCK_RESERVATION_MIN}min` },
          });
          await tx.payoutAuditLog.create({
            data: {
              entityType: 'PayoutItem',
              entityId: row.id,
              action: `STATE_TRANSITION_${SettlementState.EXPIRED}`,
              oldValue: row.status,
              newValue: JSON.stringify({ stateTo: SettlementState.EXPIRED, reconciliationStatus: 'EXPIRED' }),
              reason: `Reservation stuck > ${STUCK_RESERVATION_MIN} minutes; released so a new idempotency key can be used.`,
              performedBy: 'ProviderReconciliationWorker.reservationWatchdog',
              payoutItemId: row.id,
              payoutBatchId: row.payoutBatchId ?? undefined,
            },
          });
        });
        results.push({ payoutItemId: row.id, action: 'RESERVATION_RELEASED', notes: `status was ${row.status}` });
      } catch (err) {
        console.error(`[ProviderReconciliationWorker] release stuck reservation failed for ${row.id}`, err);
      }
    }
    return results;
  }

  private determineRail(payoutItem: {
    paymentMethod: string;
    connectorId?: string | null;
  }): SettlementRail['kind'] | null {
    const kind = String(payoutItem.paymentMethod ?? '').toLowerCase();
    const asKind = kind as SettlementRail['kind'];
    if (this.rails.has(asKind)) return asKind;
    const fromConnector = String(payoutItem.connectorId ?? '').toLowerCase();
    for (const k of Array.from(this.rails.keys())) {
      if (fromConnector.includes(k)) return k;
    }
    return null;
  }

  private async processProcessing(items: Array<{
    id: string;
    status: string;
    externalRef: string | null;
    transactionRef: string | null;
    payoutBatchId: string | null;
    updatedAt: Date;
    paymentMethod: string;
    connectorId: string | null;
    amount: number;
    currency: string;
  }>): Promise<ReconcileResult[]> {
    const results: ReconcileResult[] = [];
    for (const it of items) {
      const railKind = this.determineRail(it);
      const timeout = railKind ? RAIL_TIMEOUTS[railKind] : null;
      const processHours = timeout?.processHours ?? 4;
      const age = this.ageMs(it.updatedAt);
      const providerTxnRef = it.externalRef ?? it.transactionRef ?? it.id;
      if (!railKind || isSyntheticRef(it.externalRef)) {
        if (age > processHours * HOUR) {
          const escId = await this.escalate({
            payoutItemId: it.id,
            payoutBatchId: it.payoutBatchId,
            severity: L1_SEVERITY,
            reason: `PROCESSING → UNKNOWN: age > ${processHours}h; rail or externalRef missing/synthetic.`,
            currentState: it.status,
            ageMs: age,
            amount: it.amount,
            currency: it.currency,
            paymentMethod: it.paymentMethod,
          });
          try {
            await prisma.$transaction(async (tx) => {
              await tx.payoutItem.update({
                where: { id: it.id },
                data: { status: SettlementState.UNKNOWN, connectorStatus: 'watchdog_unknown' },
              });
              await tx.payoutAuditLog.create({
                data: {
                  entityType: 'PayoutItem',
                  entityId: it.id,
                  action: `STATE_TRANSITION_${SettlementState.UNKNOWN}`,
                  oldValue: it.status,
                  newValue: JSON.stringify({ stateTo: SettlementState.UNKNOWN, reconciliationStatus: 'UNKNOWN', evidenceStatus: 'MISSING' }),
                  reason: `PROCESSING older than ${processHours}h; no provider response. L1 escalation.`,
                  performedBy: 'ProviderReconciliationWorker.watchdog',
                  payoutItemId: it.id,
                  payoutBatchId: it.payoutBatchId ?? undefined,
                },
              });
            });
          } catch (err) {
            console.error(`[ProviderReconciliationWorker] PROCESSING->UNKNOWN transition failed id=${it.id}`, err);
          }
          results.push({
            payoutItemId: it.id,
            action: 'PROCESSING_TIMEOUT_UNKNOWN_L1',
            notes: `age ${(age / HOUR).toFixed(2)}h > ${processHours}h; railKind=${String(railKind ?? 'UNKNOWN')}`,
            escalationCreatedId: escId,
          });
        } else {
          results.push({ payoutItemId: it.id, action: 'PROCESSING_RECHECKED', notes: `age ${(age / MIN).toFixed(0)}m still within ${processHours}h window.` });
        }
        continue;
      }

      const rail = this.rails.get(railKind);
      let reconcileSuccess = false;
      let reconcileFinalRef: string | undefined;
      let reconcileRejected = false;
      let noResponse = true;
      try {
        const res = await rail.reconcile(providerTxnRef, it.id);
        noResponse = false;
        if (res.success) {
          reconcileSuccess = true;
          reconcileFinalRef = res.finalRef;
        } else if (res.error && /reject|cancelled|failed|not_found/i.test(res.error)) {
          reconcileRejected = true;
        }
      } catch (err) {
        console.error(`[ProviderReconciliationWorker] rail.reconcile error id=${it.id} rail=${railKind}`, err);
      }

      if (reconcileSuccess) {
        results.push({
          payoutItemId: it.id,
          action: 'RECONCILE_SUCCESS',
          notes: `rail=${railKind} returned success; finalRef=${reconcileFinalRef ?? it.externalRef ?? ''}`,
          finalProviderRef: reconcileFinalRef ?? it.externalRef ?? undefined,
        });
      } else if (reconcileRejected) {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.payoutItem.update({
              where: { id: it.id },
              data: { status: SettlementState.REJECTED, connectorStatus: 'rail_rejected', failureReason: `Rail=REJECTED` },
            });
            await tx.payoutAuditLog.create({
              data: {
                entityType: 'PayoutItem',
                entityId: it.id,
                action: `STATE_TRANSITION_${SettlementState.REJECTED}`,
                oldValue: it.status,
                newValue: JSON.stringify({ stateTo: SettlementState.REJECTED, reconciliationStatus: 'MISSING_PROVIDER', evidenceStatus: 'MISSING' }),
                reason: `Rail=REJECTED. New idempotency key required for any retry.`,
                performedBy: 'ProviderReconciliationWorker',
                payoutItemId: it.id,
                payoutBatchId: it.payoutBatchId ?? undefined,
              },
            });
          });
        } catch (err) {
          console.error(`[ProviderReconciliationWorker] PROCESSING->REJECTED transition failed id=${it.id}`, err);
        }
        results.push({ payoutItemId: it.id, action: 'RECONCILE_REJECTED', notes: `rail=${railKind} rejected payout.` });
      } else if (age > processHours * HOUR) {
        const escId = await this.escalate({
          payoutItemId: it.id,
          payoutBatchId: it.payoutBatchId,
          severity: L1_SEVERITY,
          reason: `PROCESSING older than ${processHours}h; reconcile returned no definite success/reject.`,
          currentState: it.status,
          ageMs: age,
          amount: it.amount,
          currency: it.currency,
          paymentMethod: it.paymentMethod,
        });
        try {
          await prisma.$transaction(async (tx) => {
            await tx.payoutItem.update({
              where: { id: it.id },
              data: { status: SettlementState.UNKNOWN, connectorStatus: noResponse ? 'watchdog_unknown_noresponse' : 'evidence_pending' },
            });
            await tx.payoutAuditLog.create({
              data: {
                entityType: 'PayoutItem',
                entityId: it.id,
                action: `STATE_TRANSITION_${SettlementState.UNKNOWN}`,
                oldValue: it.status,
                newValue: JSON.stringify({ stateTo: SettlementState.UNKNOWN, reconciliationStatus: 'UNKNOWN', evidenceStatus: noResponse ? 'UNKNOWN' : 'PENDING' }),
                reason: noResponse
                  ? `Rail reconcile() threw/empty; older than ${processHours}h. L1 escalation.`
                  : `Rail returned indeterminate status; older than ${processHours}h. L1 escalation.`,
                performedBy: 'ProviderReconciliationWorker.watchdog',
                payoutItemId: it.id,
                payoutBatchId: it.payoutBatchId ?? undefined,
              },
            });
          });
        } catch (err) {
          console.error(`[ProviderReconciliationWorker] PROCESSING->UNKNOWN failed id=${it.id}`, err);
        }
        results.push({
          payoutItemId: it.id,
          action: 'PROCESSING_TIMEOUT_UNKNOWN_L1',
          escalationCreatedId: escId,
        });
      } else {
        results.push({
          payoutItemId: it.id,
          action: 'PROCESSING_RECHECKED',
          notes: `rail=${railKind} age=${(age / MIN).toFixed(0)}m; reconcile did not return success/reject — re-check next tick.`,
        });
      }
    }
    return results;
  }

  private async processUnknown(items: Array<{
    id: string;
    status: string;
    externalRef: string | null;
    transactionRef: string | null;
    payoutBatchId: string | null;
    updatedAt: Date;
    paymentMethod: string;
    connectorId: string | null;
    amount: number;
    currency: string;
  }>): Promise<ReconcileResult[]> {
    const results: ReconcileResult[] = [];
    for (const it of items) {
      const railKind = this.determineRail(it);
      const timeout = railKind ? RAIL_TIMEOUTS[railKind] : null;
      const processHours = timeout?.processHours ?? 4;
      const l2Multiplier = timeout?.l2Multiplier ?? 2;
      const l2Hours = processHours * l2Multiplier;
      const age = this.ageMs(it.updatedAt);
      const providerTxnRef = it.externalRef ?? it.transactionRef ?? it.id;
      if (railKind && !isSyntheticRef(it.externalRef)) {
        const rail = this.rails.get(railKind);
        try {
          const res = await rail.reconcile(providerTxnRef, it.id);
          if (res.success) {
            results.push({
              payoutItemId: it.id,
              action: 'RECONCILE_SUCCESS',
              notes: `rail=${railKind} UNKNOWN -> reconcile SUCCESS; finalRef=${res.finalRef ?? it.externalRef ?? ''}`,
              finalProviderRef: res.finalRef ?? it.externalRef ?? undefined,
            });
            continue;
          }
          if (res.error && /reject|cancelled|failed|not_found/i.test(res.error)) {
            try {
              await prisma.$transaction(async (tx) => {
                await tx.payoutItem.update({
                  where: { id: it.id },
                  data: { status: SettlementState.REJECTED, connectorStatus: 'rail_rejected', failureReason: `Rail UNKNOWN->REJECTED: ${res.error}` },
                });
                await tx.payoutAuditLog.create({
                  data: {
                    entityType: 'PayoutItem',
                    entityId: it.id,
                    action: `STATE_TRANSITION_${SettlementState.REJECTED}`,
                    oldValue: it.status,
                    newValue: JSON.stringify({ stateTo: SettlementState.REJECTED, reconciliationStatus: 'MISSING_PROVIDER', evidenceStatus: 'MISSING' }),
                    reason: `Rail UNKNOWN reconcile=REJECTED.`,
                    performedBy: 'ProviderReconciliationWorker',
                    payoutItemId: it.id,
                    payoutBatchId: it.payoutBatchId ?? undefined,
                  },
                });
              });
            } catch (err) {
              console.error(`[ProviderReconciliationWorker] UNKNOWN->REJECTED transition failed id=${it.id}`, err);
            }
            results.push({ payoutItemId: it.id, action: 'RECONCILE_REJECTED', notes: `rail=${railKind} rejected payout (UNKNOWN path).` });
            continue;
          }
        } catch (err) {
          console.error(`[ProviderReconciliationWorker] UNKNOWN rail.reconcile threw id=${it.id} rail=${railKind}`, err);
        }
      }

      if (age > l2Hours * HOUR) {
        const escId = await this.escalate({
          payoutItemId: it.id,
          payoutBatchId: it.payoutBatchId,
          severity: L2_SEVERITY,
          reason: `UNKNOWN older than ${l2Hours}h (${l2Multiplier}x ${processHours}h). QUARANTINED — no more retries; manual intervention required.`,
          currentState: it.status,
          ageMs: age,
          amount: it.amount,
          currency: it.currency,
          paymentMethod: it.paymentMethod,
        });
        try {
          await prisma.$transaction(async (tx) => {
            await tx.payoutItem.update({
              where: { id: it.id },
              data: { status: SettlementState.QUARANTINED, connectorStatus: 'quarantined' },
            });
            await tx.payoutAuditLog.create({
              data: {
                entityType: 'PayoutItem',
                entityId: it.id,
                action: `STATE_TRANSITION_${SettlementState.QUARANTINED}`,
                oldValue: it.status,
                newValue: JSON.stringify({ stateTo: SettlementState.QUARANTINED, reconciliationStatus: 'UNKNOWN', evidenceStatus: 'UNKNOWN' }),
                reason: `UNKNOWN > ${l2Hours}h. QUARANTINED per L2 escalation policy.`,
                performedBy: 'ProviderReconciliationWorker.watchdogL2',
                payoutItemId: it.id,
                payoutBatchId: it.payoutBatchId ?? undefined,
              },
            });
          });
        } catch (err) {
          console.error(`[ProviderReconciliationWorker] UNKNOWN->QUARANTINED transition failed id=${it.id}`, err);
        }
        results.push({
          payoutItemId: it.id,
          action: 'UNKNOWN_L2_QUARANTINED',
          escalationCreatedId: escId,
          notes: `age ${(age / HOUR).toFixed(2)}h > ${l2Hours}h.`,
        });
      } else {
        results.push({
          payoutItemId: it.id,
          action: 'RECONCILE_NO_RESPONSE_STILL_UNKNOWN',
          notes: `age ${(age / HOUR).toFixed(2)}h; L2 threshold ${l2Hours}h not reached.`,
        });
      }
    }
    return results;
  }

  async runOnce(opts?: { batchLimit?: number; actor?: string }): Promise<{
    reservationReleases: ReconcileResult[];
    processingActions: ReconcileResult[];
    unknownActions: ReconcileResult[];
    startedAt: string;
    finishedAt: string;
  }> {
    void opts?.actor;
    const startedAt = this.now();
    const limit = opts?.batchLimit ?? 500;

    const releases = await this.releaseStuckReservations();

    const processingItems = await prisma.payoutItem.findMany({
      where: {
        status: {
          in: [SettlementState.PROCESSING, SettlementState.PROVIDER_SUBMITTED],
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        status: true,
        externalRef: true,
        transactionRef: true,
        payoutBatchId: true,
        updatedAt: true,
        paymentMethod: true,
        connectorId: true,
        amount: true,
        currency: true,
      },
    });
    const processingResults = await this.processProcessing(processingItems);

    const unknownItems = await prisma.payoutItem.findMany({
      where: { status: SettlementState.UNKNOWN },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        status: true,
        externalRef: true,
        transactionRef: true,
        payoutBatchId: true,
        updatedAt: true,
        paymentMethod: true,
        connectorId: true,
        amount: true,
        currency: true,
      },
    });
    const unknownResults = await this.processUnknown(unknownItems);

    return {
      reservationReleases: releases,
      processingActions: processingResults,
      unknownActions: unknownResults,
      startedAt: startedAt.toISOString(),
      finishedAt: this.now().toISOString(),
    };
  }
}

class PlaceholderReconRail implements SettlementRail {
  id: string;
  kind: SettlementRail['kind'];
  private envVarKeys: string[];

  constructor(kind: SettlementRail['kind'], envVarKeys: string[]) {
    this.kind = kind;
    this.id = `placeholder-recon:${kind}`;
    this.envVarKeys = envVarKeys;
  }

  async ensureReady(): Promise<void> {
    const missing: string[] = [];
    for (const key of this.envVarKeys) {
      const v = process.env[key];
      if (!v || v.trim() === '' || /^(your|placeholder|todo|changeme|setme|xxxxx|replaceme)/i.test(v)) missing.push(key);
    }
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`RAIL_NOT_CONFIGURED (${this.kind}): reconciliation requires real provider credentials. Missing: ${missing.join(', ')}.`),
        { code: 'RAIL_NOT_CONFIGURED', rail: this.kind, missingEnv: missing },
      );
    }
  }

  async submit(
    payoutItemId: string,
    amount: number,
    currency: string,
    destination: string,
    idempotencyKey: string,
  ): Promise<{ providerRef: string; providerStatus: string }> {
    void payoutItemId; void amount; void currency; void destination; void idempotencyKey;
    await this.ensureReady();
    return { providerRef: '', providerStatus: 'placeholder_submit_not_implemented' };
  }

  async reconcile(
    providerRef: string,
    payoutItemId: string,
  ): Promise<{ success: boolean; finalRef?: string; error?: string }> {
    void providerRef; void payoutItemId;
    try { await this.ensureReady(); } catch (e) { return { success: false, error: (e as Error).message }; }
    return { success: false, error: 'Placeholder rail — reconciliation requires real provider implementation to return SUCCESS or REJECTED status from provider API.' };
  }
}

const WORKER_PLACEHOLDER_RAILS: Array<[SettlementRail['kind'], string[]]> = [
  ['paypal', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']],
  ['payoneer', ['PAYONEER_PRQ_TOKEN', 'OWNER_PAYONEER_EMAIL']],
  ['bank_wire', ['OWNER_BANK_NAME', 'OWNER_BANK_ACCOUNT_HOLDER', 'OWNER_BANK_ACCOUNT_NUMBER']],
  ['wise', ['WISE_API_TOKEN', 'WISE_PROFILE_ID']],
  ['stripe', ['STRIPE_SECRET_KEY', 'STRIPE_CONNECT_ACCOUNT_ID']],
  ['attijari', ['ATTIJARI_API_USERNAME', 'ATTIJARI_API_PASSWORD', 'ATTIJARI_WPS_CONTRACT']],
  ['tron', ['OWNER_CRYPTO_TRON_ADDRESS', 'TRONGRID_API_KEY']],
  ['google_pay', ['GOOGLE_PAY_MERCHANT_ID', 'GOOGLE_PAY_PRIVATE_KEY']],
  ['crypto', ['OWNER_CRYPTO_EVM_ADDRESS', 'OWNER_CRYPTO_NETWORK']],
];

export const providerReconciliationWorker = new ProviderReconciliationWorker();
for (const [kind, vars] of WORKER_PLACEHOLDER_RAILS) {
  providerReconciliationWorker.registerRail(new PlaceholderReconRail(kind, vars));
}
export default providerReconciliationWorker;
