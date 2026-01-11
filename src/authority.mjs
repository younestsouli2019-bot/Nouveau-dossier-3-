import crypto from "node:crypto";

function isPlaceholderValue(value) {
  if (value == null) return true;
  const v = String(value).trim();
  if (!v) return true;
  if (/^\s*<\s*YOUR_[A-Z0-9_]+\s*>\s*$/i.test(v)) return true;
  if (/^\s*YOUR_[A-Z0-9_]+\s*$/i.test(v)) return true;
  if (/^\s*(REPLACE_ME|CHANGEME|TODO)\s*$/i.test(v)) return true;
  return false;
}

function getEnvBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function normalizeEmailAddress(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!s.includes("@")) return null;
  return s;
}

function normalizeBankAccount(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return s.replace(/\s+/g, "").toUpperCase();
}

function parseAllowedRecipientList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((x) => String(x ?? "").trim()).filter(Boolean);
  const s = String(value).trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
    return [];
  } catch {
    return s
      .split(",")
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
  }
}

function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

function getAllowedRecipientsPolicyFromEnv() {
  const json = process.env.AUTONOMOUS_ALLOWED_PAYOUT_RECIPIENTS_JSON ?? process.env.BASE44_ALLOWED_PAYOUT_RECIPIENTS_JSON ?? null;
  if (json != null && String(json).trim() && !isPlaceholderValue(json)) {
    const parsed = safeJsonParse(String(json), null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const paypal = parseAllowedRecipientList(parsed.paypal ?? parsed.paypal_email ?? parsed.paypalEmail ?? []);
      const payoneer = parseAllowedRecipientList(parsed.payoneer ?? parsed.payoneer_id ?? parsed.payoneerId ?? []);
      const bankWireAccounts = parseAllowedRecipientList(
        parsed.bank_wire ?? parsed.bankWire ?? parsed.bank_wire_accounts ?? parsed.bankWireAccounts ?? parsed.bank_accounts ?? parsed.bankAccounts ?? []
      );
      const policy = {
        paypal: new Set(paypal.map((x) => normalizeEmailAddress(x)).filter(Boolean)),
        payoneer: new Set(payoneer.map((x) => normalizeEmailAddress(x)).filter(Boolean)),
        bankWireAccounts: new Set(bankWireAccounts.map((x) => normalizeBankAccount(x)).filter(Boolean))
      };
      const configured = policy.paypal.size > 0 || policy.payoneer.size > 0 || policy.bankWireAccounts.size > 0;
      return { ...policy, configured };
    }
  }

  const paypal = parseAllowedRecipientList(
    process.env.AUTONOMOUS_ALLOWED_PAYPAL_RECIPIENTS ??
      process.env.BASE44_ALLOWED_PAYPAL_RECIPIENTS ??
      process.env.PAYOUT_ALLOWED_PAYPAL_RECIPIENTS ??
      null
  );
  const payoneer = parseAllowedRecipientList(
    process.env.AUTONOMOUS_ALLOWED_PAYONEER_RECIPIENTS ??
      process.env.BASE44_ALLOWED_PAYONEER_RECIPIENTS ??
      process.env.PAYOUT_ALLOWED_PAYONEER_RECIPIENTS ??
      null
  );
  const bankWireAccounts = parseAllowedRecipientList(
    process.env.AUTONOMOUS_ALLOWED_BANK_WIRE_ACCOUNTS ??
      process.env.BASE44_ALLOWED_BANK_WIRE_ACCOUNTS ??
      process.env.PAYOUT_ALLOWED_BANK_WIRE_ACCOUNTS ??
      null
  );

  const policy = {
    paypal: new Set(paypal.map((x) => normalizeEmailAddress(x)).filter(Boolean)),
    payoneer: new Set(payoneer.map((x) => normalizeEmailAddress(x)).filter(Boolean)),
    bankWireAccounts: new Set(bankWireAccounts.map((x) => normalizeBankAccount(x)).filter(Boolean))
  };
  const configured = policy.paypal.size > 0 || policy.payoneer.size > 0 || policy.bankWireAccounts.size > 0;
  return { ...policy, configured };
}

function getOwnerDeclarationFromEnv() {
  const ownerPayPal = normalizeEmailAddress(process.env.OWNER_PAYPAL_EMAIL ?? process.env.PAYPAL_EMAIL ?? null);
  const ownerPayoneer = normalizeEmailAddress(process.env.OWNER_PAYONEER_ID ?? process.env.PAYONEER_EMAIL ?? null);
  const ownerBankAccount = normalizeBankAccount(
    process.env.OWNER_BANK_ACCOUNT ?? process.env.OWNER_BANK_RIB ?? process.env.BANK_ACCOUNT ?? process.env.BANK_RIB ?? process.env.BANK_IBAN ?? null
  );
  return { ownerPayPal, ownerPayoneer, ownerBankAccount };
}

function setToSortedArray(set) {
  return [...(set ?? new Set())].map((x) => String(x)).sort((a, b) => a.localeCompare(b));
}

export function computeAuthorityChecksum() {
  const owner = getOwnerDeclarationFromEnv();
  const policy = getAllowedRecipientsPolicyFromEnv();
  const payload = {
    owner,
    allowlists: {
      paypal: setToSortedArray(policy.paypal),
      payoneer: setToSortedArray(policy.payoneer),
      bankWireAccounts: setToSortedArray(policy.bankWireAccounts)
    },
    base44PayoutDestinationJson: process.env.BASE44_PAYOUT_DESTINATION_JSON ? String(process.env.BASE44_PAYOUT_DESTINATION_JSON) : null,
    noPlatformWallet: getEnvBool("NO_PLATFORM_WALLET", false)
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function enforceOwnerOnlyAllowlist({ owner, policy, action }) {
  // Only enforce PayPal allowlist for PayPal actions
  if (action && action.toLowerCase().includes('paypal')) {
    if (policy.paypal.size > 0) {
      if (!owner.ownerPayPal) throw new Error("LIVE MODE NOT GUARANTEED (missing OWNER_PAYPAL_EMAIL)");
      for (const email of policy.paypal) {
        if (email !== owner.ownerPayPal) {
          throw new Error("LIVE MODE NOT GUARANTEED (paypal allowlist contains non-owner recipient)");
        }
      }
    }
  }

  if (policy.payoneer.size > 0) {
    if (!owner.ownerPayoneer) throw new Error("LIVE MODE NOT GUARANTEED (missing OWNER_PAYONEER_ID)");
    for (const email of policy.payoneer) {
      if (email !== owner.ownerPayoneer) {
        throw new Error("LIVE MODE NOT GUARANTEED (payoneer allowlist contains non-owner recipient)");
      }
    }
  }

  if (policy.bankWireAccounts.size > 0) {
    if (!owner.ownerBankAccount) throw new Error("LIVE MODE NOT GUARANTEED (missing OWNER_BANK_ACCOUNT)");
    for (const acct of policy.bankWireAccounts) {
      if (acct !== owner.ownerBankAccount) {
        throw new Error("LIVE MODE NOT GUARANTEED (bank allowlist contains non-owner account)");
      }
    }
  }
}

export function enforceAuthorityProtocol({
  action,
  requireLive = true,
  requireNoPlatformWallet = true,
  requireOwnerDeclaration = true,
  requireOwnerOnlyAllowlists = true
} = {}) {
  const live = String(process.env.SWARM_LIVE ?? "false").toLowerCase() === "true";
  if (requireLive && !live) throw new Error(`LIVE MODE NOT GUARANTEED (${String(action ?? "authority")})`);

  if (requireNoPlatformWallet && !getEnvBool("NO_PLATFORM_WALLET", false)) {
    throw new Error(`LIVE MODE NOT GUARANTEED (NO_PLATFORM_WALLET not true: ${String(action ?? "authority")})`);
  }

  if (getEnvBool("BASE44_OFFLINE", false) || getEnvBool("BASE44_OFFLINE_MODE", false)) {
    throw new Error(`LIVE MODE NOT GUARANTEED (offline mode enabled: ${String(action ?? "authority")})`);
  }

  const owner = getOwnerDeclarationFromEnv();
  if (requireOwnerDeclaration) {
    if (!owner.ownerPayPal && !owner.ownerPayoneer && !owner.ownerBankAccount) {
      throw new Error(`LIVE MODE NOT GUARANTEED (missing owner declaration: ${String(action ?? "authority")})`);
    }
  }

  if (requireOwnerOnlyAllowlists) {
    const policy = getAllowedRecipientsPolicyFromEnv();
    if (policy.configured) enforceOwnerOnlyAllowlist({ owner, policy, action });
  }

  return {
    ok: true,
    owner,
    checksum: computeAuthorityChecksum()
  };
}

export { getAllowedRecipientsPolicyFromEnv, normalizeEmailAddress, normalizeBankAccount };
