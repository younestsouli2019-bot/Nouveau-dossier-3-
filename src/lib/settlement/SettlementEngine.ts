import { prisma } from '../db';
import { sha256 } from '../strict-enforcement/crypto-utils';
import { acquireLock, releaseLock, computeStateHash } from '../single-writer-lock';
import { resolveBestPayoutRoute } from '../payout-routing';
import {
  isOwnerKycPassed,
  getDisbursementPolicy,
  isPayoutConfigComplete,
} from '../owner-config';
import { simulatePipeline, type PipelineAction } from '../atomic-simulation';
import { allocateToVault, getTotalExposure } from '../escrow-vaults';
import { detectDuplicates } from '../audit-agent';

export enum SettlementState {
  REVENUE = 'REVENUE',
  RECONCILED = 'RECONCILED',
  OWNER_ENTITLEMENT = 'OWNER_ENTITLEMENT',
  PAYOUT_PROPOSAL = 'PAYOUT_PROPOSAL',
  POLICY = 'POLICY',
  RESERVATION = 'RESERVATION',
  INSTRUCTION = 'INSTRUCTION',
  IDEMPOTENCY = 'IDEMPOTENCY',
  PROVIDER_SUBMITTED = 'PROVIDER_SUBMITTED',
  PROCESSING = 'PROCESSING',
  UNKNOWN = 'UNKNOWN',
  PROVIDER_RECONCILED = 'PROVIDER_RECONCILED',
  CONFIRMED = 'CONFIRMED',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  QUARANTINED = 'QUARANTINED',
  EXPIRED = 'EXPIRED',
}

const TERMINAL_STATES = new Set([
  SettlementState.SETTLED,
  SettlementState.REJECTED,
  SettlementState.CANCELLED,
  SettlementState.EXPIRED,
]);

export const VALID_TRANSITIONS: Record<SettlementState, Set<SettlementState>> = {
  [SettlementState.REVENUE]: new Set([SettlementState.RECONCILED, SettlementState.REJECTED]),
  [SettlementState.RECONCILED]: new Set([SettlementState.OWNER_ENTITLEMENT, SettlementState.REJECTED]),
  [SettlementState.OWNER_ENTITLEMENT]: new Set([SettlementState.PAYOUT_PROPOSAL, SettlementState.REJECTED]),
  [SettlementState.PAYOUT_PROPOSAL]: new Set([SettlementState.POLICY, SettlementState.CANCELLED]),
  [SettlementState.POLICY]: new Set([SettlementState.RESERVATION, SettlementState.REJECTED]),
  [SettlementState.RESERVATION]: new Set([SettlementState.INSTRUCTION, SettlementState.EXPIRED, SettlementState.CANCELLED]),
  [SettlementState.INSTRUCTION]: new Set([SettlementState.IDEMPOTENCY, SettlementState.CANCELLED]),
  [SettlementState.IDEMPOTENCY]: new Set([SettlementState.PROVIDER_SUBMITTED, SettlementState.SETTLED, SettlementState.CANCELLED]),
  [SettlementState.PROVIDER_SUBMITTED]: new Set([SettlementState.PROCESSING, SettlementState.REJECTED, SettlementState.UNKNOWN]),
  [SettlementState.PROCESSING]: new Set([SettlementState.PROVIDER_RECONCILED, SettlementState.UNKNOWN, SettlementState.REJECTED, SettlementState.QUARANTINED]),
  [SettlementState.UNKNOWN]: new Set([SettlementState.PROVIDER_RECONCILED, SettlementState.REJECTED, SettlementState.QUARANTINED, SettlementState.PROCESSING]),
  [SettlementState.PROVIDER_RECONCILED]: new Set([SettlementState.CONFIRMED, SettlementState.REJECTED, SettlementState.QUARANTINED]),
  [SettlementState.CONFIRMED]: new Set([SettlementState.SETTLED, SettlementState.REJECTED]),
  [SettlementState.SETTLED]: new Set(),
  [SettlementState.REJECTED]: new Set(),
  [SettlementState.CANCELLED]: new Set(),
  [SettlementState.QUARANTINED]: new Set([SettlementState.PROVIDER_RECONCILED, SettlementState.REJECTED]),
  [SettlementState.EXPIRED]: new Set(),
};

export const SYNTHETIC_REF_REGEX =
  /^(PB-|REV-|PP-\d+|ALT-|REC-|PROC-|SHP-|RECONCILE-|TXRECON-|NOTXHASH|CSV-BATCH-)|(INSTRUCTIONS_READY|WAITING_MANUAL|REVIEWED)/i;

export function isSyntheticRef(ref: unknown): boolean {
  if (ref == null) return true;
  const s = String(ref).trim();
  if (!s) return true;
  return SYNTHETIC_REF_REGEX.test(s);
}

export interface SettlementRail {
  id: string;
  kind: 'paypal' | 'bank_wire' | 'crypto' | 'payoneer' | 'wise' | 'stripe' | 'tron' | 'google_pay' | 'attijari';
  ensureReady(): Promise<void>;
  submit(
    payoutItemId: string,
    amount: number,
    currency: string,
    destination: string,
    idempotencyKey: string,
  ): Promise<{ providerRef: string; providerStatus: string }>;
  reconcile(
    providerRef: string,
    payoutItemId: string,
  ): Promise<{ success: boolean; finalRef?: string; error?: string }>;
}

export interface SubmitForSettlementInput {
  revenueEventId: string;
  ownerAccountId?: string;
  entitlementSourceRef: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
  railKind?: SettlementRail['kind'];
  actor?: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitForSettlementResult {
  payoutItemId: string;
  payoutBatchId?: string;
  ownerSettlementId?: string;
  state: SettlementState;
  idempotencyHit: boolean;
  externalRef?: string | null;
  connectorId?: string | null;
  proofHash?: string | null;
}

function assertValidTransition(from: SettlementState, to: SettlementState): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) {
    throw new Error(`SETTLEMENT_STATE_INVALID_FROM: Unknown source state ${from}`);
  }
  if (!allowed.has(to)) {
    throw new Error(
      `SETTLEMENT_TRANSITION_FORBIDDEN: ${from} -> ${to} is not a valid lifecycle transition.`,
    );
  }
}

export class SettlementEngine {
  private rails: Map<SettlementRail['kind'], SettlementRail> = new Map();

  registerRail(rail: SettlementRail): void {
    this.rails.set(rail.kind, rail);
  }

  getRail(kind: SettlementRail['kind']): SettlementRail | undefined {
    return this.rails.get(kind);
  }

  private _lockIdsPerItem: Map<string, string> = new Map();

  private async appendAudit(params: {
    entityType: 'PayoutItem' | 'PayoutBatch';
    entityId: string;
    stateFrom?: SettlementState | null;
    stateTo: SettlementState;
    performedBy: string;
    reason?: string;
    reconciliationStatus?: string;
    providerTransactionId?: string;
    evidenceStatus?: string;
    payoutItemId?: string;
    payoutBatchId?: string;
  }): Promise<void> {
    const {
      entityType,
      entityId,
      stateFrom,
      stateTo,
      performedBy,
      reason,
      reconciliationStatus,
      providerTransactionId,
      evidenceStatus,
      payoutItemId,
      payoutBatchId,
    } = params;
    const newValue = JSON.stringify({
      stateTo,
      reconciliationStatus: reconciliationStatus ?? null,
      providerTransactionId: providerTransactionId ?? null,
      evidenceStatus: evidenceStatus ?? null,
    });
    await prisma.payoutAuditLog.create({
      data: {
        entityType,
        entityId,
        action: `STATE_TRANSITION_${stateTo}`,
        oldValue: stateFrom ? String(stateFrom) : null,
        newValue,
        reason: reason ?? null,
        performedBy,
        payoutItemId: payoutItemId ?? (entityType === 'PayoutItem' ? entityId : undefined),
        payoutBatchId: payoutBatchId ?? (entityType === 'PayoutBatch' ? entityId : undefined),
      },
    });
  }

  private async transitionPayoutItem(
    payoutItemId: string,
    to: SettlementState,
    performedBy: string,
    opts?: {
      reason?: string;
      externalRef?: string | null;
      connectorId?: string | null;
      connectorStatus?: string | null;
      proofHash?: string | null;
      reconciliationStatus?: string;
      providerTransactionId?: string;
      processedAt?: Date;
      deliveryConfirmed?: boolean;
      payoutBatchId?: string;
      batchData?: Partial<{
        batchNumber: string;
        status: string;
        totalAmount: number;
        currency: string;
        itemCount: number;
      }>;
    },
  ): Promise<void> {
    const existing = await prisma.payoutItem.findUnique({
      where: { id: payoutItemId },
      select: { id: true, status: true, payoutBatchId: true },
    });
    if (!existing) {
      throw new Error(`PAYOUT_ITEM_NOT_FOUND: ${payoutItemId}`);
    }
    const fromRaw = existing.status as string;
    const from = (Object.values(SettlementState) as string[]).includes(fromRaw)
      ? (fromRaw as SettlementState)
      : SettlementState.REVENUE;

    if (from !== to) {
      assertValidTransition(from, to);
    }

    if (TERMINAL_STATES.has(to)) {
      if (to === SettlementState.SETTLED || to === SettlementState.CONFIRMED || to === SettlementState.PROVIDER_RECONCILED) {
        const ref = opts?.externalRef;
        if (isSyntheticRef(ref)) {
          throw new Error(
            `TRUTH_GUARD_SYNTHETIC_REF: Cannot write terminal=${to} with externalRef=${String(ref)} — it matches a synthetic pattern or is null.`,
          );
        }
        if (to === SettlementState.SETTLED) {
          if (!opts?.proofHash || String(opts.proofHash).trim().length < 64) {
            throw new Error(
              `TRUTH_GUARD_PROOFHASH: status=SETTLED requires proofHash=sha256(settledAt|amount|currency|externalRef). Got: ${String(opts?.proofHash ?? 'NULL')}`,
            );
          }
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      const patch: Record<string, unknown> = { status: to };
      if (opts?.externalRef !== undefined) patch.externalRef = opts.externalRef;
      if (opts?.connectorId !== undefined) patch.connectorId = opts.connectorId;
      if (opts?.connectorStatus !== undefined) patch.connectorStatus = opts.connectorStatus;
      if (opts?.proofHash !== undefined) patch.proofHash = opts.proofHash;
      if (opts?.processedAt !== undefined) patch.processedAt = opts.processedAt;
      if (opts?.deliveryConfirmed !== undefined) patch.deliveryConfirmed = opts.deliveryConfirmed;
      if (opts?.providerTransactionId !== undefined) patch.transactionRef = opts.providerTransactionId;
      await tx.payoutItem.update({ where: { id: payoutItemId }, data: patch });

      const newValue = JSON.stringify({
        stateTo: to,
        reconciliationStatus: opts?.reconciliationStatus ?? null,
        providerTransactionId: opts?.providerTransactionId ?? null,
        evidenceStatus: opts?.proofHash ? 'COMPLETE' : null,
      });
      await tx.payoutAuditLog.create({
        data: {
          entityType: 'PayoutItem',
          entityId: payoutItemId,
          action: `STATE_TRANSITION_${to}`,
          oldValue: String(from),
          newValue,
          reason: opts?.reason ?? null,
          performedBy,
          payoutItemId,
          payoutBatchId: existing.payoutBatchId ?? opts?.payoutBatchId ?? null,
        },
      });
    });
  }

  async submitForSettlement(input: SubmitForSettlementInput): Promise<SubmitForSettlementResult> {
    const {
      revenueEventId,
      ownerAccountId: maybeOwnerAccountId,
      entitlementSourceRef,
      idempotencyKey,
      amount,
      currency,
      railKind,
      actor = 'SettlementEngine',
      metadata = {},
    } = input;

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('AMOUNT_INVALID: amount must be a positive finite number');
    }
    if (!currency || !/^[A-Z]{3}$/.test(String(currency).toUpperCase())) {
      throw new Error('CURRENCY_INVALID: currency must be a 3-letter ISO code');
    }
    if (!entitlementSourceRef || !revenueEventId || !idempotencyKey) {
      throw new Error('REFERENCE_REQUIRED: revenueEventId, entitlementSourceRef, idempotencyKey are all required');
    }

    return prisma.$transaction(async (tx) => {
      const revenue = await tx.revenueEvent.findUnique({
        where: { id: revenueEventId },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          proofHash: true,
          proofType: true,
        },
      });
      if (!revenue) {
        throw new Error(`REVENUE_EVENT_NOT_FOUND: ${revenueEventId}`);
      }
      void revenue;

      const ownerAccounts = await tx.ownerAccount.findMany({
        where: maybeOwnerAccountId
          ? { id: maybeOwnerAccountId, isActive: true, verifiedAt: { not: null } }
          : { isActive: true, verifiedAt: { not: null } },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      });
      if (!ownerAccounts.length) {
        throw new Error(
          'OWNER_ACCOUNT_NOT_FOUND: No verified OwnerAccount rows. Payouts require verified OwnerAccount.isActive=true AND verifiedAt IS NOT NULL.',
        );
      }

      const accountForKyc = maybeOwnerAccountId
        ? ownerAccounts.find((a) => a.id === maybeOwnerAccountId)
        : ownerAccounts.find((a) => a.isPrimary) ?? ownerAccounts[0];
      if (!accountForKyc) {
        throw new Error('OWNER_ACCOUNT_MISMATCH: specified ownerAccountId not in verified set');
      }
      const kycPassed = isOwnerKycPassed();
      if (!kycPassed) {
        throw new Error('OWNER_KYC_FAILED: OwnerAccount is not verified/KYC-passed for payout');
      }
      const policy = getDisbursementPolicy();
      const configOk = isPayoutConfigComplete();
      if (!configOk) {
        throw new Error(
          `OWNER_PAYOUT_CONFIG_INCOMPLETE: OwnerAccount ${accountForKyc.id} fails isPayoutConfigComplete check.`,
        );
      }
      void policy;

      const idempotencyUnique = `${accountForKyc.id}|${entitlementSourceRef}|${idempotencyKey}`;
      const idempotencyRecord = await tx.settlementExecution.findFirst({
        where: {
          metadata: {
            contains: idempotencyUnique,
          },
          status: { notIn: ['FAILED', 'EXPIRED'] },
        },
        select: { id: true, settlementId: true, metadata: true, routingToken: true, status: true },
      });

      if (idempotencyRecord?.metadata) {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(idempotencyRecord.metadata) as Record<string, unknown>; } catch { /* empty */ }
        const existingPayoutItemId = meta.payoutItemId as string | undefined;
        if (existingPayoutItemId) {
          const existingItem = await tx.payoutItem.findUnique({
            where: { id: existingPayoutItemId },
            select: {
              id: true,
              status: true,
              payoutBatchId: true,
              externalRef: true,
              connectorId: true,
              proofHash: true,
            },
          });
          if (existingItem) {
            return {
              payoutItemId: existingItem.id,
              payoutBatchId: existingItem.payoutBatchId ?? undefined,
              state: (Object.values(SettlementState) as string[]).includes(existingItem.status)
                ? (existingItem.status as SettlementState)
                : SettlementState.REVENUE,
              idempotencyHit: true,
              externalRef: existingItem.externalRef,
              connectorId: existingItem.connectorId,
              proofHash: existingItem.proofHash,
            };
          }
        }
      }

      const route = resolveBestPayoutRoute({
        amount,
        currency,
        ownerAccounts: ownerAccounts.map((a) => ({
          id: a.id,
          accountType: a.accountType,
          isActive: a.isActive,
          verifiedAt: a.verifiedAt,
          isPrimary: a.isPrimary,
          countryCode: a.countryCode,
          purposes: a.purposes,
        })),
        preferredRail: railKind,
      });
      if (!route || !route.ownerAccountId) {
        throw new Error('ROUTE_NOT_FOUND: resolveBestPayoutRoute returned no viable owner destination');
      }
      const ownerAccount = ownerAccounts.find((a) => a.id === route.ownerAccountId) ?? accountForKyc;
      const rail = this.rails.get(route.rail as SettlementRail['kind']);
      if (!rail) {
        throw new Error(
          `RAIL_NOT_REGISTERED: rail=${route.rail} is not registered in SettlementEngine.rails.`,
        );
      }
      await rail.ensureReady();

      try {
        await tx.revenueEvent.update({
          where: { id: revenueEventId },
          data: { status: 'reserved' },
        });
      } catch { /* column may not exist — swallow */ }

      const batchNumber = `PB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const batch = await tx.payoutBatch.upsert({
        where: { batchNumber },
        create: {
          batchNumber,
          totalAmount: amount,
          currency: currency.toUpperCase(),
          status: 'pending_approval',
          itemCount: 1,
          paymentProvider: route.rail,
          notes: JSON.stringify({ policy: {}, metadata }),
        },
        update: { itemCount: { increment: 0 } },
      });

      await tx.payoutAuditLog.create({
        data: {
          entityType: 'PayoutBatch',
          entityId: batch.id,
          action: `STATE_TRANSITION_${SettlementState.PAYOUT_PROPOSAL}`,
          oldValue: null,
          newValue: JSON.stringify({ stateTo: SettlementState.PAYOUT_PROPOSAL }),
          reason: 'SettlementEngine.submitForSettlement: new payout batch (P0 hardened)',
          performedBy: actor,
          payoutBatchId: batch.id,
        },
      });

      const destAddress = (() => {
        switch (ownerAccount.accountType) {
          case 'paypal':
            return ownerAccount.paypalEmail ?? '';
          case 'bank_wire':
          case 'attijari':
            return ownerAccount.accountNumber ?? '';
          case 'l2_crypto':
            return ownerAccount.walletAddress ?? '';
          case 'payoneer':
            return ownerAccount.payoneerId ?? '';
          case 'wise':
            return ownerAccount.wiseEmail ?? '';
          default:
            return '';
        }
      })();
      if (!destAddress) {
        throw new Error(
          `OWNER_DESTINATION_EMPTY: OwnerAccount ${ownerAccount.id} has no payout address for accountType=${ownerAccount.accountType}`,
        );
      }

      const fallbackEmail = ownerAccount.paypalEmail ?? ownerAccount.wiseEmail ?? `owner-${ownerAccount.id.slice(-6)}@local.invalid`;
      const item = await tx.payoutItem.create({
        data: {
          payoutBatchId: batch.id,
          batchNumber: batch.batchNumber,
          recipientName: ownerAccount.accountHolder ?? 'Owner',
          recipientEmail: fallbackEmail,
          amount,
          currency: currency.toUpperCase(),
          status: SettlementState.REVENUE,
          paymentMethod: (route.rail as string) === 'l2_crypto' ? 'crypto' : (route.rail as string),
          connectorId: `settlement-engine-v1:${route.rail}`,
          connectorStatus: 'pending',
        },
      });

      await tx.payoutAuditLog.create({
        data: {
          entityType: 'PayoutItem',
          entityId: item.id,
          action: `STATE_TRANSITION_${SettlementState.REVENUE}`,
          oldValue: null,
          newValue: JSON.stringify({ stateTo: SettlementState.REVENUE }),
          reason: 'submitForSettlement: REVENUE stage created (append-only sequence)',
          performedBy: actor,
          payoutItemId: item.id,
          payoutBatchId: batch.id,
        },
      });

      await this.transitionPayoutItemInTx(tx, item.id, SettlementState.RECONCILED, actor, {
        reason: `RevenueEvent id=${revenueEventId} attached, proofHash=${String(revenue.proofHash ?? 'NULL')}`,
        reconciliationStatus: revenue.proofHash ? 'MATCHED' : 'EVIDENCE_PENDING',
        payoutBatchId: batch.id,
      });

      const ownerSettlement = await tx.ownerSettlement.create({
        data: {
          ownerAccountId: ownerAccount.id,
          referenceId: null,
          amount,
          currency: currency.toUpperCase(),
          status: SettlementState.OWNER_ENTITLEMENT,
          direction: 'outbound',
          purpose: route.purpose ?? 'settlement',
          sourceLabel: `RevenueEvent:${revenueEventId}`,
          destinationLabel: `OwnerAccount:${ownerAccount.id}`,
          description: `SettlementEngine hardening payout for entitlement=${entitlementSourceRef}`,
        },
      });

      await this.transitionPayoutItemInTx(tx, item.id, SettlementState.OWNER_ENTITLEMENT, actor, {
        reason: `OwnerSettlement id=${ownerSettlement.id} assigned to OwnerAccount id=${ownerAccount.id} (type=${ownerAccount.accountType})`,
        payoutBatchId: batch.id,
      });

      await this.transitionPayoutItemInTx(tx, item.id, SettlementState.PAYOUT_PROPOSAL, actor, {
        reason: `resolveBestPayoutRoute rail=${route.rail}, purpose=${route.purpose}, maxAmount=${String(route.maxAmount ?? 'N/A')}`,
        payoutBatchId: batch.id,
      });

      await this.transitionPayoutItemInTx(tx, item.id, SettlementState.POLICY, actor, {
        reason: `isOwnerKycPassed=ok, isPayoutConfigComplete=ok, disbursementPolicy=bucketPct.sum=100`,
        payoutBatchId: batch.id,
      });

      const stateHash = await computeStateHash({
        entityType: 'PayoutItem',
        entityId: item.id,
        state: SettlementState.RESERVATION,
        amount,
        currency: currency.toUpperCase(),
        channel: 'settlement_payout',
      });
      const lock = await acquireLock('PayoutItem', item.id, stateHash);
      if (!lock.acquired) {
        throw new Error(
          `SINGLE_WRITER_CONFLICT: Could not acquire single-writer lock for PayoutItem ${item.id}. ConflictWith=${lock.conflictWith ?? 'UNKNOWN'}`,
        );
      }
      this._lockIdsPerItem.set(item.id, lock.lockId);
      try {
        const escrow = await allocateToVault('vault-settlement', amount, 'settlement_payout', 1);
        if (!escrow.approved) {
          throw new Error(
            `ESCROW_VAULT_DENIED: allocateToVault rejected amount=${amount} reason=${escrow.rejectionReason ?? 'N/A'}`,
          );
        }
        void escrow;

        await this.transitionPayoutItemInTx(tx, item.id, SettlementState.RESERVATION, actor, {
          reason: `FOR UPDATE lock held; vault allocated; lockId=${lock.lockId}`,
          payoutBatchId: batch.id,
        });

        const instructionHash = await sha256(
          [
            item.id,
            String(amount),
            currency.toUpperCase(),
            route.rail,
            destAddress,
            idempotencyUnique,
          ].join('|'),
        );
        await this.transitionPayoutItemInTx(tx, item.id, SettlementState.INSTRUCTION, actor, {
          reason: `Instruction compiled. destination=${ownerAccount.accountType}, instructionHash=${String(instructionHash).slice(0, 16)}…`,
          payoutBatchId: batch.id,
        });

        const seMetaCreate = JSON.stringify({
          idempotencyKey: idempotencyUnique,
          ownerAccountId: ownerAccount.id,
          revenueEventId,
          entitlementSourceRef,
          state: SettlementState.IDEMPOTENCY,
          rail: route.rail,
          payoutItemId: item.id,
          payoutBatchId: batch.id,
          ownerSettlementId: ownerSettlement.id,
          performedBy: actor,
          instructionHash,
          reservationLockId: lock.lockId,
        });
        const persistedIdem = await tx.settlementExecution.create({
          data: {
            settlementId: `SE-${Date.now()}-${item.id.slice(-8)}`,
            executionMode: 'live',
            dataSource: 'live_bank_api',
            ownerConfirmedBy: actor,
            status: SettlementState.IDEMPOTENCY,
            amount,
            currency: currency.toUpperCase(),
            destination: destAddress,
            nominalAmount: amount,
            routingToken: idempotencyUnique,
            metadata: seMetaCreate,
          },
        });
        void persistedIdem;

        await this.transitionPayoutItemInTx(tx, item.id, SettlementState.IDEMPOTENCY, actor, {
          reason: `Durable idempotency key=${idempotencyUnique} persisted to SettlementExecution. Duplicate calls now return same payoutItem.`,
          payoutBatchId: batch.id,
        });

        const dupes = await detectDuplicates([
          {
            id: item.id,
            entityType: 'PayoutItem',
            amount,
            currency,
            externalRef: idempotencyUnique,
          },
        ]);
        if (dupes.length > 0) {
          throw new Error(
            `AUDIT_AGENT_DUPLICATE: audit-agent detectDuplicates flagged ${dupes.length} duplicates for idempotency key=${idempotencyUnique}`,
          );
        }

        const simAction: PipelineAction = 'settlement';
        const sim = await simulatePipeline({
          action: simAction,
          amount,
          currency,
          sourceChannel: 'platform_settlement',
          destinationChannel: route.rail,
          provider: route.rail,
        });
        if (!sim.approved) {
          throw new Error(
            `HARDENING_SIMULATION_FAILED: atomic-simulation simulatePipeline rejected. rejectionReason=${sim.rejectionReason ?? 'N/A'}`,
          );
        }

        const exposureReport = await getTotalExposure();
        if (exposureReport.percentage > exposureReport.limit) {
          throw new Error(
            `ESCROW_VAULT_EXCEEDED: global totalExposure=${exposureReport.percentage}% > limit=${exposureReport.limit}%`,
          );
        }

        const providerResult = await rail.submit(
          item.id,
          amount,
          currency.toUpperCase(),
          destAddress,
          idempotencyUnique,
        );
        const providerRef = providerResult.providerRef;
        if (!providerRef || isSyntheticRef(providerRef)) {
          await this.transitionPayoutItemInTx(tx, item.id, SettlementState.UNKNOWN, actor, {
            reason: `rail.submit returned providerRef=${String(providerRef ?? 'NULL')}. Treating as UNKNOWN pending reconciliation (no fabricated terminal transition).`,
            reconciliationStatus: 'UNKNOWN',
            payoutBatchId: batch.id,
          });
        } else {
          await this.transitionPayoutItemInTx(tx, item.id, SettlementState.PROVIDER_SUBMITTED, actor, {
            externalRef: providerRef,
            connectorId: rail.id,
            connectorStatus: providerResult.providerStatus ?? 'submitted',
            reason: `rail.submit() returned providerRef=${providerRef}`,
            providerTransactionId: providerRef,
            reconciliationStatus: 'MISSING_PROVIDER',
            payoutBatchId: batch.id,
          });
          await this.transitionPayoutItemInTx(tx, item.id, SettlementState.PROCESSING, actor, {
            reason: `Rail=PROCESSING; awaiting reconciliation worker before any terminal write.`,
            externalRef: providerRef,
            reconciliationStatus: 'EVIDENCE_PENDING',
            providerTransactionId: providerRef,
            payoutBatchId: batch.id,
          });
        }

        const finalItemNow = await tx.payoutItem.findUnique({ where: { id: item.id }, select: { status: true } });
        const nextStatus = (finalItemNow?.status as SettlementState) ?? SettlementState.PROCESSING;
        const seMetaUpdate = JSON.stringify({
          idempotencyKey: idempotencyUnique,
          state: nextStatus,
          externalRef: providerRef,
          payoutItemId: item.id,
        });
        await tx.settlementExecution.updateMany({
          where: { routingToken: idempotencyUnique },
          data: {
            status: nextStatus,
            metadata: seMetaUpdate,
            processedAt: new Date(),
          },
        });
      } finally {
        const lockId = this._lockIdsPerItem.get(item.id) ?? lock.lockId;
        await releaseLock(lockId).catch(() => {});
        this._lockIdsPerItem.delete(item.id);
      }

      const finalItem = await prisma.payoutItem.findUnique({
        where: { id: item.id },
        select: {
          id: true,
          payoutBatchId: true,
          status: true,
          externalRef: true,
          connectorId: true,
          proofHash: true,
        },
      });
      const finalStateRaw = finalItem?.status ?? SettlementState.PROCESSING;
      const finalState = (Object.values(SettlementState) as string[]).includes(finalStateRaw as string)
        ? (finalStateRaw as SettlementState)
        : SettlementState.PROCESSING;
      return {
        payoutItemId: finalItem?.id ?? item.id,
        payoutBatchId: finalItem?.payoutBatchId ?? batch.id,
        ownerSettlementId: ownerSettlement.id,
        state: finalState,
        idempotencyHit: false,
        externalRef: finalItem?.externalRef ?? null,
        connectorId: finalItem?.connectorId ?? null,
        proofHash: finalItem?.proofHash ?? null,
      };
    });
  }

  private async transitionPayoutItemInTx(
    tx: {
      payoutItem: {
        update: (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => Promise<unknown>;
      };
      payoutAuditLog: {
        create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      };
    },
    payoutItemId: string,
    to: SettlementState,
    performedBy: string,
    opts?: {
      reason?: string;
      externalRef?: string | null;
      connectorId?: string | null;
      connectorStatus?: string | null;
      proofHash?: string | null;
      reconciliationStatus?: string;
      providerTransactionId?: string;
      payoutBatchId?: string;
    },
  ): Promise<void> {
    const existing = await prisma.payoutItem.findUnique({
      where: { id: payoutItemId },
      select: { id: true, status: true, payoutBatchId: true, amount: true, currency: true },
    });
    if (!existing) {
      throw new Error(`PAYOUT_ITEM_NOT_FOUND: ${payoutItemId}`);
    }
    const fromRaw = existing.status as string;
    const from = (Object.values(SettlementState) as string[]).includes(fromRaw)
      ? (fromRaw as SettlementState)
      : SettlementState.REVENUE;

    if (from !== to) {
      assertValidTransition(from, to);
    }

    if (to === SettlementState.SETTLED) {
      const ref = opts?.externalRef;
      if (isSyntheticRef(ref)) {
        throw new Error(
          `TRUTH_GUARD_SYNTHETIC_REF: finalizeSettlement SETTLED requires non-synthetic externalRef. Got: ${String(ref ?? 'NULL')}`,
        );
      }
      if (!opts?.proofHash) {
        throw new Error(
          `TRUTH_GUARD_PROOFHASH: finalizeSettlement SETTLED requires proofHash=sha256(settledAt|amount|currency|externalRef). Got NULL.`,
        );
      }
    }

    const patch: Record<string, unknown> = { status: to };
    if (opts?.externalRef !== undefined) patch.externalRef = opts.externalRef;
    if (opts?.connectorId !== undefined) patch.connectorId = opts.connectorId;
    if (opts?.connectorStatus !== undefined) patch.connectorStatus = opts.connectorStatus;
    if (opts?.proofHash !== undefined) patch.proofHash = opts.proofHash;
    if (opts?.providerTransactionId !== undefined) patch.transactionRef = opts.providerTransactionId;
    await tx.payoutItem.update({ where: { id: payoutItemId }, data: patch });

    const newValue = JSON.stringify({
      stateTo: to,
      reconciliationStatus: opts?.reconciliationStatus ?? null,
      providerTransactionId: opts?.providerTransactionId ?? null,
      evidenceStatus: opts?.proofHash ? 'COMPLETE' : null,
    });
    await tx.payoutAuditLog.create({
      data: {
        entityType: 'PayoutItem',
        entityId: payoutItemId,
        action: `STATE_TRANSITION_${to}`,
        oldValue: String(from),
        newValue,
        reason: opts?.reason ?? null,
        performedBy,
        payoutItemId,
        payoutBatchId: opts?.payoutBatchId ?? existing.payoutBatchId ?? null,
      },
    });
  }

  async finalizeSettlement(params: {
    payoutItemId: string;
    reconciledRef: string;
    reconciledAmount: number;
    reconciledCurrency: string;
    settledAt?: Date;
    actor?: string;
    providerStatus?: string;
    connectorId?: string;
  }): Promise<void> {
    const {
      payoutItemId,
      reconciledRef,
      reconciledAmount,
      reconciledCurrency,
      settledAt = new Date(),
      actor = 'SettlementEngine.finalizeSettlement',
      providerStatus = 'verified',
      connectorId = 'provider-reconcile-v1',
    } = params;

    if (isSyntheticRef(reconciledRef)) {
      throw new Error(
        `FINALIZE_SYNTHETIC_REF: Cannot finalize payoutItem=${payoutItemId} with reconciledRef=${String(reconciledRef)}. Must be provider-verifiable.`,
      );
    }

    const existing = await prisma.payoutItem.findUnique({
      where: { id: payoutItemId },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        externalRef: true,
        proofHash: true,
        payoutBatchId: true,
      },
    });
    if (!existing) {
      throw new Error(`PAYOUT_ITEM_NOT_FOUND: ${payoutItemId}`);
    }

    if (Math.abs(Number(existing.amount) - Number(reconciledAmount)) > 0.009) {
      throw new Error(
        `AMOUNT_MISMATCH: payoutItem.amount=${existing.amount} vs reconciledAmount=${reconciledAmount} (> 1 cent). Manual review required.`,
      );
    }
    if (String(existing.currency).toUpperCase() !== String(reconciledCurrency).toUpperCase()) {
      throw new Error(
        `CURRENCY_MISMATCH: payoutItem.currency=${existing.currency} vs reconciledCurrency=${reconciledCurrency}`,
      );
    }

    const proofHash = await sha256(
      [
        settledAt.toISOString(),
        Number(reconciledAmount).toFixed(2),
        String(reconciledCurrency).toUpperCase(),
        String(reconciledRef),
      ].join('|'),
    );

    const fromRaw = existing.status as string;
    const from = (Object.values(SettlementState) as string[]).includes(fromRaw)
      ? (fromRaw as SettlementState)
      : SettlementState.REVENUE;
    const requireFrom = [
      SettlementState.PROVIDER_RECONCILED,
      SettlementState.CONFIRMED,
      SettlementState.PROCESSING,
      SettlementState.UNKNOWN,
    ];
    if (!requireFrom.includes(from)) {
      if (from === SettlementState.SETTLED && existing.proofHash === proofHash) {
        return;
      }
      throw new Error(
        `FINALIZE_BAD_PRESTATE: payoutItem=${payoutItemId} is in state=${from}, must be one of ${requireFrom.join(',')} to finalize.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      if (from === SettlementState.PROCESSING || from === SettlementState.UNKNOWN) {
        const patchPR: Record<string, unknown> = {
          status: SettlementState.PROVIDER_RECONCILED,
          externalRef: reconciledRef,
          connectorId,
          connectorStatus: providerStatus,
          transactionRef: reconciledRef,
        };
        await tx.payoutItem.update({ where: { id: payoutItemId }, data: patchPR });
        await tx.payoutAuditLog.create({
          data: {
            entityType: 'PayoutItem',
            entityId: payoutItemId,
            action: `STATE_TRANSITION_${SettlementState.PROVIDER_RECONCILED}`,
            oldValue: String(from),
            newValue: JSON.stringify({ stateTo: SettlementState.PROVIDER_RECONCILED, reconciliationStatus: 'MATCHED', providerTransactionId: reconciledRef, evidenceStatus: 'COMPLETE' }),
            reason: `Provider reconcile succeeded. reconciledRef=${reconciledRef}`,
            performedBy: actor,
            payoutItemId,
            payoutBatchId: existing.payoutBatchId ?? null,
          },
        });
        await tx.payoutAuditLog.create({
          data: {
            entityType: 'PayoutItem',
            entityId: payoutItemId,
            action: `STATE_TRANSITION_${SettlementState.CONFIRMED}`,
            oldValue: SettlementState.PROVIDER_RECONCILED,
            newValue: JSON.stringify({ stateTo: SettlementState.CONFIRMED, reconciliationStatus: 'MATCHED' }),
            reason: `Amount+currency match confirmed.`,
            performedBy: actor,
            payoutItemId,
            payoutBatchId: existing.payoutBatchId ?? null,
          },
        });
        await tx.payoutItem.update({
          where: { id: payoutItemId },
          data: { status: SettlementState.CONFIRMED },
        });
      } else if (from === SettlementState.PROVIDER_RECONCILED) {
        await tx.payoutAuditLog.create({
          data: {
            entityType: 'PayoutItem',
            entityId: payoutItemId,
            action: `STATE_TRANSITION_${SettlementState.CONFIRMED}`,
            oldValue: SettlementState.PROVIDER_RECONCILED,
            newValue: JSON.stringify({ stateTo: SettlementState.CONFIRMED, reconciliationStatus: 'MATCHED' }),
            reason: `Amount+currency match confirmed.`,
            performedBy: actor,
            payoutItemId,
            payoutBatchId: existing.payoutBatchId ?? null,
          },
        });
        await tx.payoutItem.update({
          where: { id: payoutItemId },
          data: { status: SettlementState.CONFIRMED },
        });
      }

      await tx.payoutAuditLog.create({
        data: {
          entityType: 'PayoutItem',
          entityId: payoutItemId,
          action: `STATE_TRANSITION_${SettlementState.SETTLED}`,
          oldValue: SettlementState.CONFIRMED,
          newValue: JSON.stringify({ stateTo: SettlementState.SETTLED, reconciliationStatus: 'MATCHED', providerTransactionId: reconciledRef, evidenceStatus: 'COMPLETE' }),
          reason: `proofHash gate passed. settledAt=${settledAt.toISOString()}. sha256(settledAt|amount|currency|externalRef)=${String(proofHash).slice(0, 16)}…`,
          performedBy: actor,
          payoutItemId,
          payoutBatchId: existing.payoutBatchId ?? null,
        },
      });

      await tx.payoutItem.update({
        where: { id: payoutItemId },
        data: {
          status: SettlementState.SETTLED,
          externalRef: reconciledRef,
          connectorId,
          connectorStatus: providerStatus,
          proofHash,
          processedAt: settledAt,
          transactionRef: reconciledRef,
          deliveryConfirmed: true,
        },
      });

      const ownerSettlements = await tx.ownerSettlement.findMany({
        where: {
          sourceLabel: { contains: payoutItemId },
        },
        take: 1,
      });
      if (ownerSettlements.length > 0) {
        await tx.ownerSettlement.update({
          where: { id: ownerSettlements[0].id },
          data: {
            status: SettlementState.SETTLED,
            referenceId: reconciledRef,
            proofHash,
          },
        });
      }

      await tx.auditLedger.create({
        data: {
          entityType: 'PayoutItem',
          entityId: payoutItemId,
          action: 'SETTLED',
          performedBy: actor,
          proofHash,
          metadata: JSON.stringify({
            settledAt: settledAt.toISOString(),
            reconciledRef,
            reconciledAmount,
            reconciledCurrency,
          }),
        },
      });
    });
  }
}

class PlaceholderSettlementRail implements SettlementRail {
  id: string;
  kind: SettlementRail['kind'];
  private envVarKeys: string[];

  constructor(kind: SettlementRail['kind'], envVarKeys: string[]) {
    this.kind = kind;
    this.id = `placeholder:${kind}`;
    this.envVarKeys = envVarKeys;
  }

  async ensureReady(): Promise<void> {
    const missing: string[] = [];
    for (const key of this.envVarKeys) {
      const v = process.env[key];
      if (!v || v.trim() === '' || /^(your|placeholder|todo|changeme|setme|xxxxx|replaceme)/i.test(v)) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`RAIL_NOT_CONFIGURED (${this.kind}): fail-closed — real credentials required before any rail.submit. Missing env: ${missing.join(', ')}.`),
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
    return { providerRef: '', providerStatus: 'not_configured_placeholder_rail' };
  }

  async reconcile(
    providerRef: string,
    payoutItemId: string,
  ): Promise<{ success: boolean; finalRef?: string; error?: string }> {
    void providerRef; void payoutItemId;
    try { await this.ensureReady(); } catch (e) {
      return { success: false, error: (e as Error).message };
    }
    return { success: false, error: 'Placeholder rail — reconcile requires real provider implementation.' };
  }
}

const PLACEHOLDER_RAILS: Array<[SettlementRail['kind'], string[]]> = [
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

export const settlementEngine = new SettlementEngine();
for (const [kind, vars] of PLACEHOLDER_RAILS) {
  settlementEngine.registerRail(new PlaceholderSettlementRail(kind as SettlementRail['kind'], vars));
}
export default settlementEngine;
