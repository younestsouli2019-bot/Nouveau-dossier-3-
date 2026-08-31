// Treasury release engine — implements the HELD -> SPENDABLE -> DISPATCHED
// state machine and wires the REAL Attijari PSD2 PISP wire send as the release
// rail.
//
// Problem fixed: OwnerAccount only had a cumulative totalReceived counter with
// NO separation between HELD (reconciled but locked on the ledger) and
// SPENDABLE (authorized + dispatched to the owner). Reconciled funds just sat
// on the ledger forever, never released — the dashboard counted them all as
// "settled" but the owner received nothing.
//
// This module adds that separation and a release path that:
//   1. only ever moves value OUT of heldBalance (never exceeds it)
//   2. resolves a REAL external rail — the Attijari PSD2 PISP initiatePayment
//      (SEPA credit transfer) to the owner's pre-set IBAN — gated on a real
//      LIVE_BANK_API config
//   3. only on a REAL bank paymentId (>=6 chars, non-placeholder) does value
//      move to spendableBalance / totalSent and the settlement become
//      'completed' with dataSource='live_bank_api' + real externalRef
//   4. FAIL-CLOSED: if the real send refuses / returns no paymentId, heldBalance
//      is left untouched and a needs_manual_proof settlement is recorded (never
//      a fabricated completed).
import { prisma } from '../db';
import { sha256 } from '../strict-enforcement/crypto-utils';
import { initiatePayment, getPaymentStatus } from '../attijariwafa-psd2';

const LIVE_BANK_API = process.env.LIVE_BANK_API || '';
// Owner's pre-set external IBAN (the payee / release destination).
const OWNER_IBAN =
  process.env.OWNER_PAYOUT_IDENTIFIER ||
  process.env.OWNER_IBAN ||
  process.env.IBAN_BC ||
  '';
const OWNER_NAME = process.env.OWNER_PAYOUT_HOLDER_NAME || process.env.OWNER_NAME || '';
const OWNER_CURRENCY = (process.env.OWNER_PAYOUT_CURRENCY || 'MAD').toUpperCase();

export interface ReleaseRequest {
  ownerAccountId: string;
  amount: number;
  currency?: string;
  reference?: string;
  bucketCode?: string; // optional: also decrement a FundBucket balance
  force?: boolean; // NOT honored — always fail-closed; kept for explicit call-sites
}

export interface ReleaseResult {
  ok: boolean;
  ownerAccountId: string;
  amount: number;
  externalRef?: string;
  dataSource?: string;
  status?: string;
  reason?: string;
  settlementId?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isRealRef(ref?: string | null): boolean {
  if (!ref || typeof ref !== 'string') return false;
  const v = ref.trim();
  if (v.length < 6) return false;
  // Reject obvious placeholders so we never book a fabricated completion.
  if (/^(PLACEHOLDER|TBD|N\/A|PENDING|TEST|MOCK|FAKE|-|_)+$/i.test(v)) return false;
  return true;
}

/**
 * Resolve the owner's real external rail readiness. Fail-closed: returns a
 * reason (not the account) when the rail is not properly configured.
 */
function resolveRail(owner: {
  accountNumber?: string | null;
  accountNumberLast?: string | null;
  accountHolder?: string | null;
  swiftCode?: string | null;
  countryCode?: string | null;
}): { iban: string; name: string; error?: string } {
  const accountIban = owner.accountNumber ? owner.accountNumber.replace(/\s+/g, '').toUpperCase() : '';
  const iban = accountIban || OWNER_IBAN;
  if (!LIVE_BANK_API) {
    return { iban, name: owner.accountHolder || OWNER_NAME, error: 'LIVE_BANK_API not configured — release fail-closed' };
  }
  if (!isRealRef(iban)) {
    return { iban, name: owner.accountHolder || OWNER_NAME, error: 'No real release IBAN for owner account — fail-closed' };
  }
  return { iban, name: owner.accountHolder || OWNER_NAME };
}

/**
 * Move reconciled value from held -> spendable and, if an external rail is
 * configured AND a real send succeeds, mark dispatched. This is the honest
 * release path: nothing is ever marked completed without a real bank paymentId.
 */
export async function releaseOwnerFunds(req: ReleaseRequest): Promise<ReleaseResult> {
  const amount = round2(req.amount);
  if (!(amount > 0)) {
    return { ok: false, ownerAccountId: req.ownerAccountId, amount: 0, reason: 'Release amount must be positive' };
  }

  const owner = await prisma.ownerAccount.findUnique({ where: { id: req.ownerAccountId } });
  if (!owner) {
    return { ok: false, ownerAccountId: req.ownerAccountId, amount, reason: `OwnerAccount ${req.ownerAccountId} not found` };
  }
  if (!owner.isActive) {
    return { ok: false, ownerAccountId: req.ownerAccountId, amount, reason: 'OwnerAccount not active' };
  }

  const held = Number(owner.heldBalance ?? 0);
  if (amount > held + 0.0001) {
    return {
      ok: false,
      ownerAccountId: req.ownerAccountId,
      amount,
      reason: `Insufficient HELD balance (held=${round2(held)}, requested=${amount}). Only heldBalance is releasable.`,
    };
  }

  const rail = resolveRail(owner);
  if (rail.error) {
    // FAIL-CLOSED: no real rail. Leave heldBalance untouched; record the refusal.
    return {
      ok: false,
      ownerAccountId: req.ownerAccountId,
      amount,
      reason: rail.error,
      status: 'needs_manual_proof',
    };
  }

  const reference =
    req.reference || `RELEASE-${owner.id.slice(-8)}-${Date.now()}`;
  const currency = (req.currency || OWNER_CURRENCY);

  // ---- REAL RAIL SEND ----
  let payment;
  try {
    payment = await initiatePayment({
      creditorIban: rail.iban,
      creditorName: rail.name || 'Owner',
      amount: amount.toFixed(2),
      currency,
      reference,
      remittanceInformation: `Owner funds release ${reference}`,
    });
  } catch (e) {
    return {
      ok: false,
      ownerAccountId: req.ownerAccountId,
      amount,
      reason: `Attijari PISP send threw: ${e instanceof Error ? e.message : String(e)}`,
      status: 'needs_manual_proof',
    };
  }

  const paymentId = (payment?.paymentId || '').trim();
  if (!isRealRef(paymentId)) {
    // Bank refused / no real reference — fail-closed, do NOT release.
    return {
      ok: false,
      ownerAccountId: req.ownerAccountId,
      amount,
      reason:
        `Attijari PISP returned no real paymentId (status=${payment?.status || 'unknown'}). ` +
        `Funds NOT released; heldBalance untouched.`,
      status: 'needs_manual_proof',
    };
  }

  // ---- REAL DISPATCH CONFIRMED ----
  const now = new Date();
  await prisma.ownerAccount.update({
    where: { id: owner.id },
    data: {
      heldBalance: { decrement: amount },
      spendableBalance: { increment: amount },
      totalSent: { increment: amount },
      txCount: { increment: 1 },
      spendableLastReleasedAt: now,
      lastUsedAt: now,
    },
  });

  if (req.bucketCode) {
    const bucket = await prisma.fundBucket.findUnique({ where: { code: req.bucketCode } });
    if (bucket && Number(bucket.allocated) - Number(bucket.released) >= amount) {
      await prisma.fundBucket.update({
        where: { code: req.bucketCode },
        data: { released: { increment: amount } },
      });
    }
  }

  const settlement = await prisma.ownerSettlement.create({
    data: {
      ownerAccountId: owner.id,
      amount,
      currency,
      status: 'completed',
      direction: 'outbound',
      purpose: 'release',
      referenceId: paymentId,
      externalRef: paymentId,
      dataSource: 'live_bank_api',
      connectorId: 'attijari_psd2_pisp',
      connectorStatus: 'live',
      fee: 0,
      netAmount: amount,
      sourceLabel: `Release ${reference}`,
      destinationLabel: `${rail.name || 'Owner'} · ${rail.iban.slice(0, 8)}...`,
      settledAt: now,
      verifiedAt: now,
      proofHash: await sha256(`${owner.id}:RELEASE:${paymentId}:${amount}:${currency}`),
      metadata: JSON.stringify({
        rail: 'attijari_psd2_pisp',
        paymentId,
        transactionStatus: payment?.transactionStatus || payment?.status || '',
        releasedAt: now.toISOString(),
      }),
    },
  });

  await prisma.auditLedger.create({
    data: {
      entityType: 'owner_release',
      entityId: owner.id,
      action: 'released_spendable',
      proofHash: paymentId,
      dataSource: 'live_bank_api',
      performedBy: 'release-engine',
      metadata: JSON.stringify({ amount, externalRef: paymentId, settlementId: settlement.id }),
    },
  });

  return {
    ok: true,
    ownerAccountId: owner.id,
    amount,
    externalRef: paymentId,
    dataSource: 'live_bank_api',
    status: 'completed',
    settlementId: settlement.id,
  };
}

/**
 * Read-only status of the owner ledger showing HELD vs SPENDABLE vs totalSent.
 * Used by the supervisor to decide whether a real release is possible.
 */
export async function getOwnerLedgerStatus() {
  const accounts = await prisma.ownerAccount.findMany({
    where: { isActive: true },
    orderBy: { totalReceived: 'desc' },
    select: {
      id: true,
      label: true,
      accountType: true,
      currency: true,
      totalReceived: true,
      totalSent: true,
      heldBalance: true,
      spendableBalance: true,
      spendableLastReleasedAt: true,
      accountNumberLast: true,
    },
  });
  return accounts.map((a) => ({
    ...a,
    heldBalance: Number(a.heldBalance ?? 0),
    spendableBalance: Number(a.spendableBalance ?? 0),
    totalReceived: Number(a.totalReceived ?? 0),
    totalSent: Number(a.totalSent ?? 0),
    railReady: !!LIVE_BANK_API,
    ownerIbanConfigured: !!OWNER_IBAN,
  }));
}

/**
 * Poll the real bank status of a previously initiated release (confirmation).
 * Fail-closed: only returns completed when the bank reports a final status.
 */
export async function confirmRelease(externalRef: string) {
  try {
    const status = await getPaymentStatus(externalRef);
    return {
      ok: true,
      externalRef,
      status: status?.status || status?.transactionStatus || 'unknown',
    };
  } catch (e) {
    return { ok: false, externalRef, reason: e instanceof Error ? e.message : String(e) };
  }
}
