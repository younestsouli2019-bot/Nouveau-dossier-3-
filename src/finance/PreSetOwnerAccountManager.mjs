/**
 * PreSetOwnerAccountManager.mjs
 * =================================
 * Manages pre-registered owner payout accounts.
 *
 * Architecture:
 *   Buyer → Platform Settlement Account → [verify + split + fee deduct] → Auto-payout to Pre-Set Owner Account
 *
 * The "pre-set" part means the payout destination is configured ONCE,
 * KYC-verified, and reused for all subsequent disbursements.
 * Settlement still routes through the platform (regulatory compliance),
 * but the final disbursement leg is automated.
 *
 * This is what Stripe Connect, Adyen MarketPay, and Wise Platform do:
 * funds touch the platform briefly, then auto-payout to the pre-registered account.
 */

import crypto from "node:crypto";
import { resolveDestination } from "./resolveDestination.ts";
import { enforceOwnership } from "./enforceOwnership.ts";

// ── Pre-Set Account Registry ───────────────────────────────────────────────────

const PRESET_ACCOUNTS_FILE = process.env.PRESET_ACCOUNTS_FILE || "./.swarm/preset-accounts.json";

/**
 * Pre-set account shape:
 * {
 *   accountId:     string  — internal ID (e.g. "preset_paypal_001")
 *   rail:          string  — "paypal" | "wise" | "stripe" | "payoneer" | "bank_wire" | "crypto"
 *   destination:   string  — email / IBAN / wallet address
 *   label:         string  — human-readable label
 *   kycVerified:   boolean — KYC/KYB verification status
 *   kycVerifiedAt: string  — ISO timestamp
 *   kycMethod:     string  — "manual" | "plaid" | "stripe_identity" | "wise_kyc"
 *   active:        boolean — whether this account is the current payout target
 *   priority:      number  — fallback ordering (1 = primary)
 *   currency:      string  — default currency for this account
 *   metadata:      object  — rail-specific metadata
 * }
 */

export async function loadPresetAccounts() {
  try {
    const fs = await import("node:fs");
    const raw = fs.default.readFileSync(PRESET_ACCOUNTS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function savePresetAccounts(accounts) {
  const fs = await import("node:fs");
  const dir = PRESET_ACCOUNTS_FILE.substring(0, PRESET_ACCOUNTS_FILE.lastIndexOf("/"));
  fs.default.mkdirSync(dir, { recursive: true });
  fs.default.writeFileSync(PRESET_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

/**
 * Register a new pre-set owner account.
 * Must pass KYC before it can be activated.
 */
export async function registerPresetAccount(account) {
  const accounts = await loadPresetAccounts();

  // Dedup check
  const exists = accounts.find(
    (a) => a.rail === account.rail && a.destination === account.destination
  );
  if (exists) {
    throw new Error(`Pre-set account already exists: ${account.rail}:${account.destination}`);
  }

  const newAccount = {
    accountId: account.accountId || `preset_${account.rail}_${crypto.randomUUID().slice(0, 8)}`,
    rail: account.rail,
    destination: account.destination,
    label: account.label || `${account.rail} account`,
    kycVerified: false,
    kycVerifiedAt: null,
    kycMethod: null,
    active: false,
    priority: account.priority || accounts.length + 1,
    currency: account.currency || "USD",
    metadata: account.metadata || {},
    createdAt: new Date().toISOString(),
  };

  accounts.push(newAccount);
  await savePresetAccounts(accounts);
  return newAccount;
}

/**
 * Mark a pre-set account as KYC-verified.
 * Only verified accounts can be activated for auto-payout.
 */
export async function verifyPresetAccount(accountId, { method = "manual", verifier = "owner" } = {}) {
  const accounts = await loadPresetAccounts();
  const acct = accounts.find((a) => a.accountId === accountId);
  if (!acct) throw new Error(`Account not found: ${accountId}`);

  acct.kycVerified = true;
  acct.kycVerifiedAt = new Date().toISOString();
  acct.kycMethod = method;
  acct.verifiedBy = verifier;

  await savePresetAccounts(accounts);
  return acct;
}

/**
 * Activate a pre-set account as the current payout target.
 * Only one account per rail can be active at a time.
 */
export async function activatePresetAccount(accountId) {
  const accounts = await loadPresetAccounts();
  const acct = accounts.find((a) => a.accountId === accountId);
  if (!acct) throw new Error(`Account not found: ${accountId}`);
  if (!acct.kycVerified) {
    throw new Error(`Cannot activate unverified account: ${accountId}. Run KYC verification first.`);
  }

  // Deactivate other accounts on the same rail
  for (const a of accounts) {
    if (a.rail === acct.rail) a.active = false;
  }
  acct.active = true;
  acct.activatedAt = new Date().toISOString();

  await savePresetAccounts(accounts);
  return acct;
}

/**
 * Get the active pre-set account for a given rail.
 * Falls back to highest-priority verified account if none explicitly active.
 */
export async function getActivePresetAccount(rail) {
  const accounts = await loadPresetAccounts();
  const verified = accounts.filter((a) => a.kycVerified && a.rail === rail);
  if (verified.length === 0) return null;

  const active = verified.find((a) => a.active);
  if (active) return active;

  // Fallback: highest priority (lowest number)
  return verified.sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Get all pre-set accounts, optionally filtered by rail.
 */
export async function listPresetAccounts(rail = null) {
  const accounts = await loadPresetAccounts();
  if (rail) return accounts.filter((a) => a.rail === rail);
  return accounts;
}

export default {
  loadPresetAccounts,
  savePresetAccounts,
  registerPresetAccount,
  verifyPresetAccount,
  activatePresetAccount,
  getActivePresetAccount,
  listPresetAccounts,
};