/**
 * AutoDisbursementEngine.mjs
 * ============================
 * Handles the final leg of the settlement flow:
 *
 *   Platform Settlement Account → Auto-payout to Pre-Set Owner Account
 *
 * This is the "disbursement" layer — funds have already settled to the platform
 * (verified, split, fees deducted), and now need to reach the owner's
 * pre-registered, KYC-verified account.
 *
 * Flow:
 *   1. Settlement completes (platform holds funds)
 *   2. Engine looks up active pre-set account for the rail
 *   3. Ownership enforcement check (resolveDestination)
 *   4. Disburse via the appropriate gateway
 *   5. Record immutable audit trail
 *
 * This gives the owner a "direct" feel while maintaining:
 *   - Regulatory compliance (platform touched funds)
 *   - KYC on receiving side
 *   - Fraud detection window
 *   - Fee collection at settlement
 */

import crypto from "node:crypto";
import { getActivePresetAccount } from "./PreSetOwnerAccountManager.mjs";
import { resolveDestination } from "./resolveDestination.ts";
import { enforceOwnership } from "./enforceOwnership.ts";
import { shouldAvoidPayPal } from "../policy/geopolicy.mjs";

// ── Fee structure ──────────────────────────────────────────────────────────────

const DEFAULT_FEE_STRUCTURE = {
  platformFeeBps: 0,       // 0 bps = 0% (owner is the platform)
  processingFeeBps: 200,   // 2% gateway processing fee
  minFeeUsd: 0.30,
  maxFeeUsd: 100.00,
};

export function calculateFees(amountUsd, feeStructure = DEFAULT_FEE_STRUCTURE) {
  const processingFee = Math.max(
    feeStructure.minFeeUsd,
    Math.min(
      (amountUsd * feeStructure.processingFeeBps) / 10000,
      feeStructure.maxFeeUsd
    )
  );
  const platformFee = (amountUsd * feeStructure.platformFeeBps) / 10000;
  const totalFees = processingFee + platformFee;
  const netAmount = Math.max(0, amountUsd - totalFees);
  return {
    grossAmount: amountUsd,
    processingFee: Number(processingFee.toFixed(2)),
    platformFee: Number(platformFee.toFixed(2)),
    totalFees: Number(totalFees.toFixed(2)),
    netAmount: Number(netAmount.toFixed(2)),
  };
}

// ── Disbursement record ────────────────────────────────────────────────────────

const DISBURSEMENT_LOG = process.env.DISBURSEMENT_LOG_FILE || "./.swarm/disbursements.json";

async function loadLog() {
  try {
    const fs = await import("node:fs");
    return JSON.parse(fs.default.readFileSync(DISBURSEMENT_LOG, "utf8"));
  } catch {
    return [];
  }
}

async function appendLog(entry) {
  const fs = await import("node:fs");
  const dir = DISBURSEMENT_LOG.substring(0, DISBURSEMENT_LOG.lastIndexOf("/"));
  fs.default.mkdirSync(dir, { recursive: true });
  const log = await loadLog();
  log.push(entry);
  fs.default.writeFileSync(DISBURSEMENT_LOG, JSON.stringify(log, null, 2));
}

/**
 * Execute a disbursement to the owner's pre-set account.
 *
 * @param {Object} params
 * @param {string} params.settlementId — ID of the completed settlement
 * @param {string} params.rail — "paypal" | "wise" | "stripe" | "payoneer" | "bank_wire" | "crypto"
 * @param {number} params.amountUsd — gross amount in USD
 * @param {string} params.currency — target currency
 * @param {Object} params.metadata — settlement metadata
 * @param {boolean} params.dryRun — if true, simulate without executing
 * @returns {Object} disbursement result
 */
export async function disburseToPresetAccount({
  settlementId,
  rail,
  amountUsd,
  currency = "USD",
  metadata = {},
  dryRun = false,
} = {}) {
  if (!settlementId) throw new Error("settlementId required");
  if (!rail) throw new Error("rail required");
  if (!amountUsd || amountUsd <= 0) throw new Error("amountUsd must be > 0");

  // Geo-policy check (e.g. PayPal restrictions)
  if (rail === "paypal" && shouldAvoidPayPal(metadata.jurisdiction)) {
    throw new Error(`PayPal disbursement blocked by geo-policy for jurisdiction: ${metadata.jurisdiction}`);
  }

  // 1. Look up active pre-set account for this rail
  const presetAccount = await getActivePresetAccount(rail);
  if (!presetAccount) {
    throw new Error(`No active KYC-verified pre-set account for rail: ${rail}. Register and verify one first.`);
  }
  if (!presetAccount.kycVerified) {
    throw new Error(`Pre-set account ${presetAccount.accountId} is not KYC-verified.`);
  }

  // 2. Ownership enforcement — resolve destination through ownership policy
  const resolved = resolveDestination({
    requested: presetAccount.destination,
    ownerDestination: presetAccount.destination,
  });

  // 3. Enforce ownership constraint
  enforceOwnership(resolved.destination);

  // 4. Calculate fees
  const fees = calculateFees(amountUsd, metadata.feeStructure);

  // 5. Build disbursement payload
  const disbursementId = `disb_${crypto.randomUUID().slice(0, 12)}`;
  const disbursement = {
    disbursementId,
    settlementId,
    rail,
    presetAccountId: presetAccount.accountId,
    destination: resolved.destination,
    destinationRewritten: resolved.rewritten,
    currency,
    ...fees,
    status: "PREPARED",
    createdAt: new Date().toISOString(),
    metadata: {
      ...metadata,
      kycMethod: presetAccount.kycMethod,
      kycVerifiedAt: presetAccount.kycVerifiedAt,
      presetAccountLabel: presetAccount.label,
    },
  };

  if (dryRun) {
    disbursement.status = "DRY_RUN";
    disbursement.note = "Simulated disbursement — no funds moved";
    return disbursement;
  }

  // 6. Execute via gateway (delegated to ExternalGatewayManager in production)
  // The gateway call happens in the orchestrator; here we prepare the instruction.
  disbursement.status = "READY_FOR_GATEWAY";
  disbursement.gatewayInstruction = {
    rail,
    destination: resolved.destination,
    amount: fees.netAmount,
    currency,
    reference: disbursementId,
    type: "auto_payout",
    presetAccount: presetAccount.accountId,
  };

  // 7. Record immutable audit trail
  const auditEntry = {
    eventId: `audit_${crypto.randomUUID().slice(0, 12)}`,
    eventType: "DISBURSEMENT_PREPARED",
    disbursementId,
    settlementId,
    rail,
    destinationHash: crypto.createHash("sha256").update(resolved.destination).digest("hex"),
    amountUsd,
    netAmount: fees.netAmount,
    totalFees: fees.totalFees,
    presetAccountId: presetAccount.accountId,
    kycVerified: true,
    timestamp: new Date().toISOString(),
  };
  await appendLog(auditEntry);

  return disbursement;
}

/**
 * Batch disbursement — process multiple settlements to pre-set accounts.
 */
export async function batchDisburse(settlements, { dryRun = false } = {}) {
  const results = [];
  for (const s of settlements) {
    try {
      const result = await disburseToPresetAccount({ ...s, dryRun });
      results.push({ ok: true, ...result });
    } catch (err) {
      results.push({ ok: false, settlementId: s.settlementId, error: err.message });
    }
  }
  return {
    total: settlements.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/**
 * Get disbursement history.
 */
export async function getDisbursementHistory(limit = 50) {
  const log = await loadLog();
  return log.slice(-limit);
}

export default {
  calculateFees,
  disburseToPresetAccount,
  batchDisburse,
  getDisbursementHistory,
};