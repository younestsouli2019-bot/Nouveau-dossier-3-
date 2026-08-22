import crypto from "node:crypto";
import { AppendOnlyHmacLogger } from "../audit/AppendOnlyHmacLogger.mjs";

/**
 * VirtualCardManager
 *
 * Links AI agents to virtual corporate credit cards under STRICT parameters.
 * No real-money authorization is possible here: spending is only *authorized*
 * (scored against hard limits) and must be settled through the existing
 * gateways (PayPal/Wise/BankWire/Crypto) by the owner-approved rails.
 *
 * Hard constraints enforced per spend attempt:
 *   - per-transaction cap
 *   - daily cap
 *   - total lifetime cap
 *   - merchant allowlist (mcc / merchant name glob)
 *   - expiry (card frozen after expiry)
 *   - status gating (active only)
 *   - owner approval flag (unless bypassed by explicit owner consent key)
 *   - budget-owner bound (funds only flow to owner allowlist accounts)
 */

function getEnvBool(name, def = false) {
	const v = process.env[name];
	if (v == null) return def;
	return String(v).toLowerCase() === "true";
}

function ownerRecipients() {
	return [
		process.env.OWNER_PAYPAL_EMAIL,
		process.env.OWNER_IBAN,
		process.env.OWNER_BANK_RIB,
		process.env.OWNER_BANK_ACCOUNT,
		process.env.OWNER_CRYPTO_ADDRESS,
		process.env.OWNER_TRUST_WALLET,
		process.env.OWNER_PAYONEER_ID,
	]
		.filter(Boolean)
		.map((x) => String(x).replace(/["']/g, "").replace(/\s+/g, "").toUpperCase())
		.filter(Boolean);
}

function matchMerchant(allowlist, merchant) {
	if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
	const m = String(merchant ?? "").trim().toLowerCase();
	if (!m) return false;
	return allowlist.some((rule) => {
		const r = String(rule ?? "").trim().toLowerCase();
		if (!r) return false;
		if (r.startsWith("*") && r.endsWith("*")) return m.includes(r.slice(1, -1));
		if (r.endsWith("*")) return m.startsWith(r.slice(0, -1));
		if (r.startsWith("*")) return m.endsWith(r.slice(1));
		return m === r;
	});
}

export class VirtualCardManager {
	constructor({ audit = new AppendOnlyHmacLogger() } = {}) {
		this.audit = audit;
		this.cards = new Map();
	}

	/**
	 * Provision a virtual card for an agent.
	 * @param {object} spec
	 * @param {string} spec.agentId
	 * @param {number} spec.perTransactionLimit
	 * @param {number} spec.dailyLimit
	 * @param {number} spec.totalLimit
	 * @param {string[]} [spec.merchantAllowlist]
	 * @param {string[]} [spec.mccAllowlist]
	 * @param {number} [spec.expiresAtMs] epoch ms
	 * @param {string} [spec.cardholder]
	 */
	issueCard(spec = {}) {
		const agentId = String(spec.agentId ?? "").trim();
		if (!agentId) throw new Error("VirtualCardManager: agentId required");
		const perTxn = Number(spec.perTransactionLimit);
		const daily = Number(spec.dailyLimit);
		const total = Number(spec.totalLimit);
		if (![perTxn, daily, total].every(Number.isFinite) || perTxn <= 0 || daily <= 0 || total <= 0) {
			throw new Error(
				"VirtualCardManager: positive perTransactionLimit/dailyLimit/totalLimit required",
			);
		}
		const card = {
			id: `vc_${crypto.randomBytes(8).toString("hex")}`,
			agentId,
			cardholder: spec.cardholder || agentId,
			perTransactionLimit: perTxn,
			dailyLimit: daily,
			totalLimit: total,
			spentToday: 0,
			spentTotal: 0,
			dayBucket: new Date().toISOString().slice(0, 10),
			merchantAllowlist: Array.isArray(spec.merchantAllowlist)
				? spec.merchantAllowlist.map(String)
				: [],
			mccAllowlist: Array.isArray(spec.mccAllowlist) ? spec.mccAllowlist.map(String) : [],
			expiresAtMs: Number(spec.expiresAtMs) || Date.now() + 30 * 86400000,
			status: "active",
			createdAt: new Date().toISOString(),
		};
		this.cards.set(card.id, card);
		this.audit.log("CARD_ISSUED", card.id, null, { cardId: card.id, agentId, limits: { perTxn, daily, total } }, "VirtualCardManager");
		return card;
	}

	getCard(id) {
		return this.cards.get(id);
	}

	async authorizeSpend({ cardId, amount, currency, merchant, mcc, destination, reason }) {
		const card = this.cards.get(cardId);
		if (!card) throw new Error("VirtualCardManager: unknown card");
		const reasons = [];
		if (card.status !== "active") reasons.push("card not active");
		const now = Date.now();
		if (now > card.expiresAtMs) reasons.push("card expired");

		const amt = Number(amount);
		if (!Number.isFinite(amt) || amt <= 0) reasons.push("invalid amount");

		const day = new Date().toISOString().slice(0, 10);
		if (card.dayBucket !== day) {
			card.dayBucket = day;
			card.spentToday = 0;
		}

		if (reasons.length === 0) {
			if (amt > card.perTransactionLimit) reasons.push("per-transaction limit exceeded");
			if (card.spentToday + amt > card.dailyLimit) reasons.push("daily limit exceeded");
			if (card.spentTotal + amt > card.totalLimit) reasons.push("total limit exceeded");
		}

		if (reasons.length === 0 && card.merchantAllowlist.length > 0 && !matchMerchant(card.merchantAllowlist, merchant)) {
			reasons.push("merchant not allowlisted");
		}
		if (
			reasons.length === 0 &&
			card.mccAllowlist.length > 0 &&
			!card.mccAllowlist.includes(String(mcc ?? "").toUpperCase())
		) {
			reasons.push("mcc not allowlisted");
		}

		// Owner-bound: destination must be an owner allowlisted account.
		if (reasons.length === 0 && destination) {
			const norm = String(destination)
				.replace(/["']/g, "")
				.replace(/\s+/g, "")
				.toUpperCase();
			if (!ownerRecipients().includes(norm)) {
				reasons.push("destination not owner-bound");
			}
		}

		// Owner approval gate.
		const autoApprove =
			getEnvBool("VIRTUAL_CARD_APPROVAL_BYPASS", false) &&
			String(process.env.OWNER_APPROVAL_KEY ?? "") ===
				String(process.env.VIRTUAL_CARD_OWNER_KEY ?? "");
		if (reasons.length === 0 && !autoApprove && !getEnvBool("SWARM_LIVE", false)) {
			reasons.push("not live; owner approval required");
		}

		const allowed = reasons.length === 0;
		this.audit.log(
			allowed ? "CARD_AUTHORIZED" : "CARD_DENIED",
			cardId,
			null,
			{ cardId, amount: amt, currency, merchant, mcc, destination, reasons },
			"VirtualCardManager",
			{ reason },
		);

		if (!allowed) {
			const err = new Error(`VirtualCardManager: ${reasons.join("; ")}`);
			err.code = "CARD_DENIED";
			throw err;
		}

		card.spentToday += amt;
		card.spentTotal += amt;
		return { allowed: true, cardId, amount: amt, currency, merchant, remainingTotal: card.totalLimit - card.spentTotal };
	}

	freezeCard(id) {
		const card = this.cards.get(id);
		if (!card) throw new Error("VirtualCardManager: unknown card");
		card.status = "frozen";
		this.audit.log("CARD_FROZEN", id, null, { cardId: id }, "VirtualCardManager");
		return card;
	}

	closeCard(id) {
		const card = this.cards.get(id);
		if (!card) throw new Error("VirtualCardManager: unknown card");
		card.status = "closed";
		this.audit.log("CARD_CLOSED", id, null, { cardId: id }, "VirtualCardManager");
		return card;
	}
}
