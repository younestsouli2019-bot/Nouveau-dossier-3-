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

export class GooglePayGateway {
	ensureReady({ forMerchant = null } = {}) {
		const live = String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		const enabled = String(process.env.GOOGLEPAY_ENABLE || "false").toLowerCase() === "true";
		const clientId = process.env.GOOGLEPAY_CLIENT_ID;
		const merchantId = process.env.GOOGLEPAY_MERCHANT_ID;
		const merchantEmail = process.env.OWNER_GOOGLEPAY_EMAIL;

		if (!live && !process.env.SWARM_OFFLINE) {
			throw Object.assign(new Error("GooglePayGateway: SWARM_LIVE=true required for real operations"),
				{ code: "GOOGLEPAY_NOT_LIVE" });
		}
		if (!enabled) {
			throw Object.assign(new Error("GooglePayGateway: GOOGLEPAY_ENABLE=false (GooglePay is NOT configured as a disbursement rail; use Wise/PayPal/bank_wire/Attijariwafa fallback)"),
				{ code: "GOOGLEPAY_DISABLED" });
		}
		if (!clientId || isPlaceholder(clientId)) {
			throw Object.assign(new Error("GooglePayGateway: missing or placeholder GOOGLEPAY_CLIENT_ID env secret. Route has been failed to next deterministic rail."),
				{ code: "GOOGLEPAY_MISSING_CLIENT_ID" });
		}
		if (!merchantId || isPlaceholder(merchantId)) {
			throw Object.assign(new Error("GooglePayGateway: missing or placeholder GOOGLEPAY_MERCHANT_ID env secret (Payments & Merchant Center profile ID). Route failed to next rail."),
				{ code: "GOOGLEPAY_MISSING_MERCHANT_ID" });
		}
		if (!merchantEmail || !String(merchantEmail).includes("@")) {
			throw Object.assign(new Error("GooglePayGateway: OWNER_GOOGLEPAY_EMAIL missing/invalid — required for Google Pay Business Console verified profile."),
				{ code: "GOOGLEPAY_MISSING_MERCHANT_EMAIL" });
		}
		if (forMerchant && isPlaceholder(forMerchant)) {
			throw Object.assign(new Error("GooglePayGateway: destination merchant profile ID not provided for payout transfer."),
				{ code: "GOOGLEPAY_MISSING_DESTINATION" });
		}
		return {
			live, enabled,
			clientIdPresent: !!clientId && !isPlaceholder(clientId),
			merchantIdPresent: !!merchantId && !isPlaceholder(merchantId),
		};
	}

	async executeTransfer(transactions, { ownerMerchantId = null } = {}) {
		try {
			this.ensureReady({ forMerchant: ownerMerchantId });
		} catch (e) {
			return {
				status: "RAIL_NOT_CONFIGURED",
				provider: "googlepay",
				error: e.message,
				code: e.code || "GOOGLEPAY_FALLBACK_REQUIRED",
				retryable: false,
				next_rail_hint: ["wise", "paypal", "bank_transfer", "payoneer_standard", "crypto"],
				no_funds_moved: true,
			};
		}
		const outDir = "settlements/googlepay";
		const filename = `googlepay_instruction_${Date.now()}.json`;
		const filePath = path.join(process.cwd(), outDir, filename);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const payload = {
			provider: "googlepay",
			action: "transfer",
			items: transactions,
			status: "WAITING_PROVIDER_INTEGRATION",
			note: "GooglePay is NOT configured as a disbursement rail in this version. ALWAYS fallback via next_rail_hint above. EnsureReady passed ONLY because credentials exist — NO Google Pay Wallet-to-Wallet or Push Provisioned transfer was executed. Funds have NOT moved. Do NOT write status=completed for any transaction in this payload without a REAL Google Pay & Wallet Console receipt.",
		};
		fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
		return {
			status: "RAIL_NOT_CONFIGURED",
			provider: "googlepay",
			code: "GOOGLEPAY_NOT_A_PAYOUT_RAIL",
			error:
				"GooglePay credential checks passed but GooglePay is NOT an outbound disbursement rail in this integration. REFUSE to mark any transaction completed on googlepay rail without a verified Wallet Console receipt. Fallback to next_rail_hint.",
			next_rail_hint: ["wise", "paypal", "bank_transfer", "payoneer_standard", "crypto"],
			no_funds_moved: true,
			retryable: false,
			filePath,
		};
	}
}
