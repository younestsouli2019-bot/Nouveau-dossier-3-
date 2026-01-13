function getOwnerAccounts() {
  const paypal = String(process.env.OWNER_PAYPAL_EMAIL ?? "younestsouli2019@gmail.com");
  const bank = String(process.env.OWNER_BANK_RIB ?? process.env.OWNER_BANK_ACCOUNT ?? "007810000448500030594182");
  const payoneer = String(process.env.OWNER_PAYONEER_ACCOUNT_ID ?? process.env.OWNER_PAYONEER_ID ?? "PRINCIPAL_ACCOUNT");
  const crypto = String(process.env.OWNER_CRYPTO_ADDRESS ?? process.env.OWNER_TRUST_WALLET ?? "").trim();
  return { paypal, bank, payoneer, crypto };
}

export function validateOwnerDirectiveSetup() {
  const { paypal, bank, payoneer, crypto } = getOwnerAccounts();
  const ok = Boolean(paypal) && Boolean(bank) && Boolean(payoneer);
  return { ok, accounts: { paypal, bank, payoneer, crypto } };
}

export function enforceOwnerDirective(recipient, recipientType) {
  const { paypal, bank, payoneer, crypto } = getOwnerAccounts();
  const r = String(recipient ?? "").trim();
  const t = String(recipientType ?? "").toLowerCase();
  const allowed = new Set([paypal, bank, payoneer, crypto].filter(Boolean));
  if (!r || !allowed.has(r)) {
    throw new Error("OwnerDirectiveViolation");
  }
  if (t && !["owner", "email", "rib", "account", "wallet"].includes(t)) {
    throw new Error("OwnerDirectiveViolation");
  }
  return true;
}

export async function preExecutionOwnerCheck({ batch }) {
  const { paypal, bank, payoneer, crypto } = getOwnerAccounts();
  const allowed = new Set([paypal, bank, payoneer, crypto].filter(Boolean));
  const items = Array.isArray(batch?.items) ? batch.items : [];
  for (const it of items) {
    const r = String(it?.recipient ?? "");
    if (!allowed.has(r)) {
      throw new Error("OwnerDirectiveViolation");
    }
  }
  return { ok: true, itemsCount: items.length };
}

export function autoCorrectToOwner(payoutMethod) {
  const { paypal, bank, payoneer } = getOwnerAccounts();
  const m = String(payoutMethod ?? "").toUpperCase();
  if (m === "PAYPAL") return paypal;
  if (m === "BANK_WIRE") return bank;
  if (m === "PAYONEER") return payoneer;
  return paypal;
}

