function normalizeAccount(value) {
	return String(value ?? "")
		.replace(/["']/g, "")
		.replace(/\s+/g, "")
		.toUpperCase();
}

function getOwnerAccounts() {
	const paypal = normalizeAccount(
		process.env.OWNER_PAYPAL_EMAIL ?? "younestsouli2019@gmail.com",
	);
	const bank = normalizeAccount(
		process.env.OWNER_BANK_RIB ??
			process.env.OWNER_BANK_ACCOUNT ??
			process.env.OWNER_IBAN ??
			process.env.OWNER_BANK_IBAN ??
			"007810000448500030594182",
	);
	const payoneer = String(
		process.env.OWNER_PAYONEER_ACCOUNT_ID ??
			process.env.OWNER_PAYONEER_ID ??
			"PRINCIPAL_ACCOUNT",
	);
	const crypto = String(
		process.env.OWNER_CRYPTO_ADDRESS ?? process.env.OWNER_TRUST_WALLET ?? "",
	).trim();
	return { paypal, bank, payoneer, crypto };
}

export function validateOwnerDirectiveSetup() {
	const { paypal, bank, payoneer, crypto } = getOwnerAccounts();
	const ok = Boolean(paypal) && Boolean(bank) && Boolean(payoneer);
	return { ok, accounts: { paypal, bank, payoneer, crypto } };
}

function extractRecipientValue(recipient) {
	if (typeof recipient === "string") return recipient;
	if (recipient && typeof recipient === "object") {
		if (recipient.payout && typeof recipient.payout === "object") {
			const v =
				recipient.payout.beneficiary ??
				recipient.payout.recipient ??
				recipient.payout.recipient_email ??
				recipient.payout.recipient_address ??
				recipient.payout.address ??
				recipient.payout.to ??
				null;
			if (v != null) return v;
		}
		const v =
			recipient.beneficiary ??
			recipient.recipient ??
			recipient.recipient_email ??
			recipient.recipient_address ??
			recipient.address ??
			recipient.email ??
			recipient.paypal_email ??
			null;
		if (v != null) return v;
	}
	return recipient;
}

export function enforceOwnerDirective(recipient, recipientType) {
	const { paypal, bank, payoneer, crypto } = getOwnerAccounts();
	const raw = extractRecipientValue(recipient);
	const r = normalizeAccount(raw);
	const t = String(recipientType ?? "").toLowerCase();
	const allowed = new Set(
		[paypal, bank, payoneer, crypto].map((x) => normalizeAccount(x)).filter(Boolean),
	);
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
	const allowed = new Set(
		[paypal, bank, payoneer, crypto].map((x) => normalizeAccount(x)).filter(Boolean),
	);
	const items = Array.isArray(batch?.items) ? batch.items : [];
	for (const it of items) {
		const raw =
			it?.recipient ??
			it?.receiver ??
			it?.recipient_email ??
			it?.recipient_address ??
			it?.email ??
			it?.address ??
			"";
		const r = normalizeAccount(raw);
		if (!r || !allowed.has(r)) {
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
