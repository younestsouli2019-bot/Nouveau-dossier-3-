/**
 * Owner identity + beneficiary guard for the HIT Swarm revenue engine.
 *
 * COME-WHAT-MAY RULE:
 * Swarm-generated revenue may only ever settle to the verified owner. Any
 * payout destination (email, IBAN/RIB, account number, wallet) that is not in
 * the owner allowlist is refused with a hard throw. The swarm fails closed: if
 * no owner configuration is present, payouts are locked.
 */

const OWNER_LEGAL_NAME = process.env.OWNER_LEGAL_NAME || "Younes Tsouli";
const OWNER_CIN = process.env.OWNER_CIN || "";

function envList(key: string): string[] {
  const raw = process.env[key];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    return [raw];
  } catch {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function norm(id: unknown): string {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** Every identifier that may receive swarm revenue. Normalized + deduped. */
export function ownerBeneficiaryAllowlist(): string[] {
  const set = new Set<string>();
  const push = (v?: string) => {
    const n = norm(v);
    if (n) set.add(n);
  };
  push(process.env.OWNER_PAYPAL_EMAIL);
  push(process.env.OWNER_PAYONEER_EMAIL);
  push(process.env.OWNER_EMAIL);
  for (const e of envList("OWNER_EMAILS")) push(e);
  push(process.env.OWNER_IBAN);
  push(process.env.MOROCCAN_BANK_RIB);
  push(process.env.OWNER_BANK_ACCOUNT_NUM);
  push(process.env.OWNER_PAYONEER_ID);
  push(process.env.TRUST_WALLET_ADDRESS);
  push(process.env.TRUST_WALLET_USDT_ERC20);
  push(process.env.TRUST_WALLET_USDT_BEP20);
  push(process.env.BYBIT_USDT_ERC20);
  for (const e of envList("OWNER_BENEFICIARY_ALLOWLIST_JSON")) push(e);
  for (const e of envList("AUTONOMOUS_ALLOWED_BANK_WIRE_ACCOUNTS")) push(e);
  for (const e of envList("BASE44_ALLOWED_BANK_WIRE_ACCOUNTS")) push(e);
  for (const e of envList("PAYOUT_ALLOWED_BANK_WIRE_ACCOUNTS")) push(e);
  return [...set];
}

export function isOwnerIdentifier(id: unknown): boolean {
  const n = norm(id);
  if (!n) return false;
  return ownerBeneficiaryAllowlist().includes(n);
}

/** Hard guard. Throws if `id` is not a verified owner destination. */
export function assertOwnerOnly(id: unknown, context: string): void {
  if (!isOwnerIdentifier(id)) {
    throw new Error(
      `OWNER GUARD BLOCKED (${context}): destination "${maskIdentifier(
        id
      )}" is not a verified owner beneficiary. ` +
        `Come-what-may rule: HIT Swarm revenue may only ever settle to the owner (${OWNER_LEGAL_NAME}).`
    );
  }
}

export function ownerLegalName(): string {
  return OWNER_LEGAL_NAME;
}

export function maskIdentifier(id: unknown): string {
  const s = String(id || "");
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

export function ownerPublicProfile() {
  return {
    legalName: OWNER_LEGAL_NAME,
    cinConfigured: Boolean(OWNER_CIN),
    allowlistCount: ownerBeneficiaryAllowlist().length,
    allowlistMasked: ownerBeneficiaryAllowlist()
      .slice(0, 5)
      .map(maskIdentifier),
  };
}
