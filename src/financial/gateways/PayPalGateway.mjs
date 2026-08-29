import { paypalRequest, getPayPalAccessToken } from "../../paypal-api.mjs";
import fs from "fs";
import path from "path";

function isPlaceholder(v) {
	if (v == null) return true;
	const s = String(v).trim();
	if (!s) return true;
	if (/^YOUR_[A-Z0-9_]+$/i.test(s)) return true;
	if (/^(REPLACE_ME|CHANGEME|TODO)$/i.test(s)) return true;
	return false;
}

export class PayPalGateway {
	constructor() {
		this.outputDir = path.join(process.cwd(), "settlements", "paypal");
		if (!fs.existsSync(this.outputDir)) {
			fs.mkdirSync(this.outputDir, { recursive: true });
		}
	}

	ensureReady({ requireDestination = null } = {}) {
		const live = String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		const clientId = process.env.PAYPAL_CLIENT_ID;
		const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
		const approved =
			String(
				process.env.PAYPAL_PPP2_APPROVED ||
					process.env.PPP2_APPROVED ||
					"false",
			).toLowerCase() === "true";
		const enableSend =
			String(
				process.env.PAYPAL_PPP2_ENABLE_SEND ||
					process.env.PPP2_ENABLE_SEND ||
					"false",
			).toLowerCase() === "true";
		const disabledRaw =
			String(process.env.PAYPAL_DISABLED || "false").toLowerCase() === "true";
		const disabled = disabledRaw || !(approved && enableSend);
		if (!live && !process.env.SWARM_OFFLINE) {
			throw Object.assign(new Error("PayPalGateway: SWARM_LIVE=true required for real payouts"),
				{ code: "PAYPAL_NOT_LIVE" });
		}
		if (disabled) {
			throw Object.assign(new Error("PayPalGateway: PayPal Payouts API not approved+enabled (PAYPAL_PPP2_APPROVED=true + PAYPAL_PPP2_ENABLE_SEND=true + PAYPAL_DISABLED≠true). Fallback to bank wire or Wise."),
				{ code: "PAYPAL_PPP2_DISABLED" });
		}
		if (!clientId || isPlaceholder(clientId)) {
			throw Object.assign(new Error("PayPalGateway: PAYPAL_CLIENT_ID missing/placeholder"),
				{ code: "PAYPAL_MISSING_CLIENT_ID" });
		}
		if (!clientSecret || isPlaceholder(clientSecret)) {
			throw Object.assign(new Error("PayPalGateway: PAYPAL_CLIENT_SECRET missing/placeholder"),
				{ code: "PAYPAL_MISSING_CLIENT_SECRET" });
		}
		if (requireDestination) {
			const email = String(requireDestination || "").trim().toLowerCase();
			if (!email || !email.includes("@")) {
				throw Object.assign(new Error("PayPalGateway: missing recipient email for PayPal payout"),
					{ code: "PAYPAL_MISSING_RECIPIENT_EMAIL" });
			}
		}
		return { live, approved, enableSend };
	}

	async createPayout(amount, currency, destination, reason) {
		this.ensureReady({ requireDestination: destination });
		const token = await getPayPalAccessToken();
		const body = {
			sender_batch_header: {
				sender_batch_id: `owner_payout_${Date.now()}`,
				email_subject: reason,
				email_message: "Here is your payout.",
			},
			items: [
				{
					recipient_type: "EMAIL",
					amount: {
						value: String(amount),
						currency: currency,
					},
					receiver: destination,
					note: reason,
					sender_item_id: `item_${Date.now()}`,
				},
			],
		};

		return paypalRequest("/v1/payments/payouts", {
			method: "POST",
			token,
			body,
		});
	}

	async executePayout(transactions) {
		let preflightErr = null;
		try {
			const dest0 = transactions[0]?.destination || transactions[0]?.email;
			this.ensureReady({ requireDestination: dest0 });
		} catch (e) {
			preflightErr = e;
		}
		if (preflightErr) {
			return {
				status: "RAIL_NOT_CONFIGURED",
				provider: "paypal",
				error: preflightErr.message,
				code: preflightErr.code || "PAYPAL_FALLBACK_REQUIRED",
				retryable: false,
				next_rail_hint: ["wise", "bank_transfer", "payoneer_standard", "crypto"],
				no_funds_moved: true,
				transactions,
			};
		}
		const token = await getPayPalAccessToken();
		const items = transactions.map((tx, i) => ({
			recipient_type: "EMAIL",
			amount: { value: String(tx.amount), currency: tx.currency || "USD" },
			receiver: tx.destination || tx.email,
			note: tx.reference || "Owner payout",
			sender_item_id: `item_${Date.now()}_${i}`,
		}));
		const body = {
			sender_batch_header: {
				sender_batch_id: `owner_payout_${Date.now()}`,
				email_subject: "Owner payout",
				email_message: "Payout processed",
			},
			items,
		};
		const res = await paypalRequest("/v1/payments/payouts", {
			method: "POST",
			token,
			body,
		});
		return {
			status: "IN_TRANSIT",
			result: res,
		};
	}

	async createInvoices(transactions) {
		const results = [];

		for (const tx of transactions) {
			const link = `https://www.paypal.com/invoice/create?amount=${tx.amount}&currency=${tx.currency}&payer=${tx.destination}`;
			results.push({
				status: "INVOICE_LINK_GENERATED",
				link,
				amount: tx.amount,
				payer: tx.destination,
			});
		}

		return {
			status: "INVOICES_READY",
			results,
			mode: "BILLING",
		};
	}

	generateInstruction(amount, currency, email, reason) {
		const timestamp = Date.now();
		const filename = `paypal_instruction_${timestamp}.json`;
		const filePath = path.join(this.outputDir, filename);

		const instruction = {
			type: "PAYPAL_PAYOUT",
			amount,
			currency,
			recipient: email,
			reason,
			timestamp: new Date().toISOString(),
			status: "WAITING_MANUAL_EXECUTION",
		};

		fs.writeFileSync(filePath, JSON.stringify(instruction, null, 2));

		return {
			status: "WAITING_MANUAL",
			filePath,
			instruction: "Log in to PayPal and send manually",
		};
	}
}
