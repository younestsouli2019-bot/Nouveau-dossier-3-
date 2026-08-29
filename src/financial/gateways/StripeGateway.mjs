import fs from "node:fs";
import path from "node:path";

function isPlaceholder(v) {
	if (v == null) return true;
	const s = String(v).trim();
	if (!s) return true;
	if (/^YOUR_[A-Z0-9_]+$/i.test(s)) return true;
	if (/^(REPLACE_ME|CHANGEME|TODO)$/i.test(s)) return true;
	return false;
}

export class StripeGateway {
	ensureReady({ forConnectAccount = null } = {}) {
		const live = String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		const enabled = String(process.env.STRIPE_ENABLE || "false").toLowerCase() === "true";
		const sk = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
		const pub = process.env.STRIPE_PUBLISHABLE_KEY;

		if (!live && !process.env.SWARM_OFFLINE) {
			throw Object.assign(new Error("StripeGateway: SWARM_LIVE=true required for real transfers"),
				{ code: "STRIPE_NOT_LIVE" });
		}
		if (!enabled) {
			throw Object.assign(new Error("StripeGateway: STRIPE_ENABLE=true required (Stripe not operational in MA; use Wise/PayPal/bank fallback)"),
				{ code: "STRIPE_DISABLED_IN_JURISDICTION" });
		}
		if (!sk || isPlaceholder(sk)) {
			throw Object.assign(new Error("StripeGateway: missing STRIPE_SECRET_KEY. Route has been failed to next rail."),
				{ code: "STRIPE_MISSING_SECRET_KEY" });
		}
		if (!pub || isPlaceholder(pub)) {
			throw Object.assign(new Error("StripeGateway: missing STRIPE_PUBLISHABLE_KEY."),
				{ code: "STRIPE_MISSING_PUBLISHABLE_KEY" });
		}
		if (forConnectAccount && (isPlaceholder(forConnectAccount) || !/^acct_/i.test(String(forConnectAccount)))) {
			throw Object.assign(new Error("StripeGateway: OwnerAccount.stripeConnectAccountId is missing/invalid (not an acct_xxx connected account ID). Cannot create Connect transfer without a verified connected account destination."),
				{ code: "STRIPE_MISSING_CONNECT_ACCOUNT", destination: forConnectAccount });
		}
		return { live, enabled, skPresent: !!sk && !isPlaceholder(sk) };
	}

	async executeTransfer(transactions, { ownerStripeConnectAccountId = null } = {}) {
		try {
			this.ensureReady({ forConnectAccount: ownerStripeConnectAccountId });
		} catch (e) {
			return {
				status: "RAIL_NOT_CONFIGURED",
				provider: "stripe",
				error: e.message,
				code: e.code || "STRIPE_FALLBACK_REQUIRED",
				retryable: false,
				next_rail_hint: ["wise", "paypal", "bank_transfer", "payoneer_standard", "crypto"],
				no_funds_moved: true,
			};
		}
		const outDir = "settlements/stripe";
		const filename = `stripe_instruction_${Date.now()}.json`;
		const filePath = path.join(process.cwd(), outDir, filename);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const payload = {
			provider: "stripe",
			action: "transfer",
			items: transactions,
			status: "WAITING_PROVIDER_INTEGRATION",
		};
		fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
		return { status: "INSTRUCTIONS_READY", filePath };
	}
}
