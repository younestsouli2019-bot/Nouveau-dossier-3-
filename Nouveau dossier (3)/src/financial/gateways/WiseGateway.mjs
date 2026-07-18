import { randomUUID } from "node:crypto";

export class WiseGateway {
	constructor({ audit } = {}) {
		this.audit = audit;
		this.apiKey = process.env.WISE_API_KEY;
		this.profileId = process.env.WISE_PROFILE_ID;
		this.environment = process.env.WISE_ENVIRONMENT || "live";
		this.baseUrl =
			this.environment === "live"
				? "https://api.wise.com"
				: "https://api.sandbox.transferwise.tech";
	}

	async makeAuthenticatedRequest(endpoint, options = {}) {
		if (!this.apiKey) throw new Error("WiseGateway: Missing WISE_API_KEY");

		const response = await fetch(`${this.baseUrl}${endpoint}`, {
			...options,
			headers: {
				...options.headers,
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			const errorData = await response.text();
			throw new Error(`WiseGateway: API error ${response.status} - ${errorData}`);
		}

		return response;
	}

	async _ensureProfileAndRecipient() {
		if (this.profileId && process.env.OWNER_WISE_RECIPIENT_ID) return;

		const profilesResponse =
			await this.makeAuthenticatedRequest("/v1/profiles");
		const profiles = await profilesResponse.json();
		const profile = profiles.find((p) => p.type === "personal") || profiles[0];
		if (!profile) throw new Error("WiseGateway: No profiles found on account");
		this.profileId = profile.id;

		const recipientsResponse = await this.makeAuthenticatedRequest(
			`/v1/accounts?profile=${this.profileId}`,
		);
		const recipients = await recipientsResponse.json();

		const ownerEmail = process.env.OWNER_WISE_EMAIL || process.env.WISE_EMAIL;
		let recipient = recipients.find(
			(r) => r.type === "balance" && r.currency === "USD",
		);
		if (!recipient && ownerEmail) {
			recipient = recipients.find(
				(r) =>
					r.accountHolderName?.toLowerCase().includes("younes") ||
					r.details?.email === ownerEmail,
			);
		}
		if (!recipient && recipients.length > 0) recipient = recipients[0];
		if (!recipient)
			throw new Error("WiseGateway: No suitable recipients found on account");

		process.env.OWNER_WISE_RECIPIENT_ID = recipient.id;
	}

	async executeTransfer(transferDetails) {
		const live =
			String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		const enabled =
			String(process.env.WISE_ENABLE || "false").toLowerCase() === "true";

		if (!live) throw new Error("WiseGateway: SWARM_LIVE=true required");
		if (!enabled) throw new Error("WiseGateway: WISE_ENABLE=true required");
		if (!this.apiKey) throw new Error("WiseGateway: Missing WISE_API_KEY");

		await this._ensureProfileAndRecipient();

		const { payoutBatchId, description } = transferDetails || {};
		let { amount, currency } = transferDetails || {};
		if (
			amount == null &&
			Array.isArray(transferDetails?.transactions) &&
			transferDetails.transactions.length > 0
		) {
			const list = transferDetails.transactions;
			currency = (list[0].currency || "USD").toUpperCase();
			let total = 0;
			for (const t of list) {
				const c = (t.currency || "USD").toUpperCase();
				if (c !== currency)
					throw new Error(
						`WiseGateway: Mixed currencies not supported (${c} vs ${currency})`,
					);
				const amt = Number(t.amount);
				if (!Number.isFinite(amt) || amt <= 0) continue;
				total += amt;
			}
			if (!(total > 0)) throw new Error("WiseGateway: Sum of amounts is zero");
			amount = Number(total.toFixed(2));
		}

		const recipient = process.env.OWNER_WISE_RECIPIENT_ID;
		if (!recipient)
			throw new Error("WiseGateway: Missing OWNER_WISE_RECIPIENT_ID");

		const quoteResponse = await this.makeAuthenticatedRequest(
			`/v3/profiles/${this.profileId}/quotes`,
			{
				method: "POST",
				body: JSON.stringify({
					sourceCurrency: currency || "USD",
					targetCurrency: currency || "USD",
					sourceAmount: amount,
					targetAmount: null,
					payOut: "BALANCE",
				}),
			},
		);
		const quote = await quoteResponse.json();

		const sanitizedReference = (description || `Payout ${payoutBatchId}`)
			.replace(/[^a-zA-Z0-9- ]/g, " ")
			.substring(0, 40);

		const transferData = {
			targetAccount: recipient,
			quoteUuid: quote.id,
			customerTransactionId: randomUUID(),
			details: {
				reference: sanitizedReference,
				transferPurpose: "Personal payment",
				sourceOfFunds: "Other",
			},
		};

		const transferResponse = await this.makeAuthenticatedRequest(
			"/v1/transfers",
			{
				method: "POST",
				body: JSON.stringify(transferData),
			},
		);
		const transfer = await transferResponse.json();

		const fundResponse = await this.makeAuthenticatedRequest(
			`/v3/profiles/${this.profileId}/transfers/${transfer.id}/payments`,
			{
				method: "POST",
				body: JSON.stringify({ type: "BALANCE" }),
			},
		);
		const fundedTransfer = await fundResponse.json();

		if (this.audit?.log) {
			this.audit.log("WISE_TRANSFER_EXECUTED", payoutBatchId, null, fundedTransfer, "System");
		}

		return fundedTransfer;
	}
}

