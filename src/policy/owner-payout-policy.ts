/**
 * owner-payout-policy.ts
 * ========================
 * Defines which accounts are pre-set as owner payout destinations,
 * their verification requirements, and routing rules.
 *
 * This policy is read by resolveDestination.ts and PreSetOwnerAccountManager.
 */

export interface PreSetAccountPolicy {
  accountId: string;
  rail: "paypal" | "wise" | "stripe" | "payoneer" | "bank_wire" | "crypto";
  destination: string;
  requiresKYC: boolean;
  requiresSCA: boolean;       // Strong Customer Authentication (PSD2)
  maxSinglePayoutUsd: number;
  dailyLimitUsd: number;
  cooldownMinutes: number;     // minimum time between payouts
  jurisdiction: string;        // "MA" | "EU" | "US" | "GLOBAL"
}

export const OWNER_PAYOUT_POLICY: PreSetAccountPolicy[] = [
  {
    accountId: "preset_paypal_001",
    rail: "paypal",
    destination: process.env.OWNER_PAYPAL_EMAIL || "",
    requiresKYC: true,
    requiresSCA: true,
    maxSinglePayoutUsd: 10000,
    dailyLimitUsd: 50000,
    cooldownMinutes: 30,
    jurisdiction: "MA",
  },
  {
    accountId: "preset_wise_001",
    rail: "wise",
    destination: process.env.OWNER_WISE_IBAN || "",
    requiresKYC: true,
    requiresSCA: true,
    maxSinglePayoutUsd: 25000,
    dailyLimitUsd: 100000,
    cooldownMinutes: 15,
    jurisdiction: "EU",
  },
  {
    accountId: "preset_payoneer_001",
    rail: "payoneer",
    destination: process.env.OWNER_PAYONEER_EMAIL || "",
    requiresKYC: true,
    requiresSCA: false,
    maxSinglePayoutUsd: 5000,
    dailyLimitUsd: 20000,
    cooldownMinutes: 60,
    jurisdiction: "MA",
  },
  {
    accountId: "preset_crypto_001",
    rail: "crypto",
    destination: process.env.OWNER_CRYPTO_WALLET || "",
    requiresKYC: true,
    requiresSCA: false,
    maxSinglePayoutUsd: 50000,
    dailyLimitUsd: 200000,
    cooldownMinutes: 5,
    jurisdiction: "GLOBAL",
  },
  {
    accountId: "preset_stripe_001",
    rail: "stripe",
    destination: process.env.OWNER_STRIPE_CONNECT_ACCOUNT_ID || "",
    requiresKYC: true,
    requiresSCA: true,
    maxSinglePayoutUsd: 100000,
    dailyLimitUsd: 500000,
    cooldownMinutes: 10,
    jurisdiction: "US",
  },
  {
    accountId: "preset_bank_wire_001",
    rail: "bank_wire",
    destination: process.env.OWNER_IBAN || process.env.MOROCCAN_BANK_RIB || "",
    requiresKYC: true,
    requiresSCA: true,
    maxSinglePayoutUsd: 250000,
    dailyLimitUsd: 1000000,
    cooldownMinutes: 120,
    jurisdiction: "GLOBAL",
  },
];

/**
 * Jurisdiction-aware preference order.
 * Stripe Connect outbound-to-bank transfers are NOT available for MA
 * (Morocco) owners on Stripe 2025/2026 rails — always demote Stripe to the
 * end for MA, prefer Wise (EU) → PayPal → Payoneer → bank wire for MA.
 */
function preferenceForJurisdiction(jurisdiction: string): string[] {
  const j = String(jurisdiction || "").toUpperCase();
  if (j === "MA" || j === "DZ" || j === "TN" || j === "EG") {
    // MENA: Stripe has no outbound Connect bank-transfers for many of these
    return ["wise", "paypal", "payoneer", "crypto", "bank_wire", "stripe"];
  }
  if (j === "US" || j === "CA") {
    return ["stripe", "wise", "paypal", "payoneer", "crypto", "bank_wire"];
  }
  // EU/UK/GLOBAL default — Wise best FX, then Stripe if US/EU connect, else PayPal
  return ["wise", "stripe", "paypal", "payoneer", "crypto", "bank_wire"];
}

/**
 * Get the recommended rail for a given amount and jurisdiction.
 * Prefers the rail with the highest limit that still covers the amount.
 */
export function recommendRail(amountUsd: number, jurisdiction = "MA"): string {
  const eligible = OWNER_PAYOUT_POLICY.filter(
    (p) =>
      p.jurisdiction === jurisdiction &&
      p.maxSinglePayoutUsd >= amountUsd
  );

  if (eligible.length === 0) {
    // Fall back to global rails (crypto, bank_wire)
    const global = OWNER_PAYOUT_POLICY.filter(
      (p) => p.jurisdiction === "GLOBAL" && p.maxSinglePayoutUsd >= amountUsd
    );
    if (global.length > 0) return global[0].rail;
    throw new Error(`No eligible rail for $${amountUsd} in jurisdiction ${jurisdiction}`);
  }

  const preference = preferenceForJurisdiction(jurisdiction);
  for (const rail of preference) {
    const match = eligible.find((p) => p.rail === rail);
    if (match) return rail;
  }
  return eligible[0].rail;
}

/**
 * Validate a payout against policy limits.
 */
export function validatePayout(
  rail: string,
  amountUsd: number,
  dailyTotalUsd: number,
  lastPayoutMinutesAgo: number
): { ok: boolean; reason?: string } {
  const policy = OWNER_PAYOUT_POLICY.find((p) => p.rail === rail);
  if (!policy) return { ok: false, reason: `Unknown rail: ${rail}` };

  if (amountUsd > policy.maxSinglePayoutUsd) {
    return {
      ok: false,
      reason: `Amount $${amountUsd} exceeds single payout limit $${policy.maxSinglePayoutUsd} for ${rail}`,
    };
  }

  if (dailyTotalUsd + amountUsd > policy.dailyLimitUsd) {
    return {
      ok: false,
      reason: `Daily limit $${policy.dailyLimitUsd} would be exceeded for ${rail}`,
    };
  }

  if (lastPayoutMinutesAgo < policy.cooldownMinutes) {
    return {
      ok: false,
      reason: `Cooldown active for ${rail}: ${policy.cooldownMinutes - lastPayoutMinutesAgo} minutes remaining`,
    };
  }

  return { ok: true };
}