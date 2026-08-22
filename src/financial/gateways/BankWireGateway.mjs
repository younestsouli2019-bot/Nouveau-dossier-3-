import crypto from "node:crypto";

/**
 * BankWireGateway (LIVE ONLY)
 *
 * Simulation paths are removed. This gateway will NOT submit any payment unless
 * explicitly configured for LIVE provider and required env flags are set.
 * Use RouteManager failover or disable the route until a real provider is integrated.
 */
export class BankWireGateway {
	constructor({ provider = process.env.BANK_WIRE_PROVIDER } = {}) {
		this.provider = String(provider || "").toUpperCase();
	}

	wiseBase() {
		const raw = String(process.env.WISE_API_BASE || "").trim();
		if (raw) return raw.replace(/\/+$/, "");
		return "https://api.wise.com";
	}

	wiseHeaders() {
		const token =
			process.env.OWNER_WISE_API_TOKEN || process.env.WISE_API_TOKEN || "";
		if (!token || String(token).trim() === "")
			throw new Error("WISE_API_TOKEN missing (OWNER_WISE_API_TOKEN or WISE_API_TOKEN)");
		return {
			Authorization: `Bearer ${String(token).trim()}`,
			"Content-Type": "application/json",
			Accept: "application/json",
			"User-Agent": "OwnerRevenueSystem/2.0",
		};
	}

	async wiseRequest(path, { method = "GET", body } = {}) {
		const base = this.wiseBase();
		const url = `${base}${path}`;
		const headers = this.wiseHeaders();
		const res = await fetch(url, {
			method,
			headers,
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		const text = await res.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = { raw: text };
		}
		if (!res.ok) {
			throw new Error(`WISE_${method}_${path}_error ${res.status}: ${text}`);
		}
		return json;
	}

	async wiseGetProfileId() {
		const list = await this.wiseRequest("/v2/profiles");
		if (Array.isArray(list) && list.length > 0) {
			const business = list.find((p) => String(p?.type || "").toUpperCase() === "BUSINESS");
			return (business || list[0])?.id;
		}
		throw new Error("WISE_NO_PROFILES");
	}

	async wiseEnsureRecipient({ profileId, currency, owner }) {
		let curr = String(currency || "USD").toUpperCase();
		// Prefer a valid IBAN; if OWNER_IBAN is not valid, fall back to IBAN_BC/BANK_IBAN
		const isValidIban = (v) =>
			/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/i.test(
				String(v || "").replace(/["']/g, "").replace(/\s+/g, ""),
			);
		let iban = null;
		const candidates = [
			owner?.iban,
			process.env.OWNER_IBAN,
			process.env.IBAN_BC,
			process.env.BANK_IBAN,
		].filter(Boolean);
		for (let c of candidates) {
			if (isValidIban(c)) {
				iban = c;
				break;
			}
		}
		if (!iban)
			throw new Error("WISE_RECIPIENT_MISSING_IBAN (set OWNER_IBAN or IBAN_BC)");
		const cleanedIban = String(iban).replace(/["']/g, "").replace(/\s+/g, "").toUpperCase();
		const country = cleanedIban.slice(0, 2);
		// Adjust currency for IBAN-based SEPA accounts (EUR)
		const sepaCountries = new Set([
			"AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IE",
			"IT","LV","LI","LT","LU","MT","MC","NL","NO","PL","PT","RO","SM","SK","SI",
			"ES","SE","CH","GB"
		]);
		if (sepaCountries.has(country)) curr = "EUR";
		const payload = {
			currency: curr,
			type: "iban",
			profile: Number(profileId),
			ownedByCustomer: true,
			accountHolderName: owner?.name || process.env.OWNER_BENEFICIARY_NAME,
			details: {
				legalType: "BUSINESS",
				iban: cleanedIban,
				country,
			},
		};
		const rec = await this.wiseRequest("/v1/accounts", {
			method: "POST",
			body: payload,
		});
		const accountId = rec?.id || rec?.account?.id || rec?.accountId || rec?.account_id;
		return { id: accountId, currency: curr };
	}

	async wiseCreateQuote({ profileId, sourceCurrency, targetCurrency, sourceAmount, targetAccountId }) {
		const payload = {
			sourceCurrency,
			targetCurrency,
			sourceAmount: Number(sourceAmount),
			targetAmount: null,
			payOut: "BANK_TRANSFER",
			preferredPayIn: "BANK_TRANSFER",
			targetAccount: Number(targetAccountId),
		};
		const quote = await this.wiseRequest(`/v3/profiles/${Number(profileId)}/quotes`, {
			method: "POST",
			body: payload,
		});
		return quote?.id || quote?.quoteUuid || quote?.quoteId;
	}

	async wiseCreateTransfer({ targetAccountId, quoteId, reference }) {
		const payload = {
			targetAccount: Number(targetAccountId),
			quoteUuid: String(quoteId),
			customerTransactionId: crypto.randomUUID(),
			details: { reference: String(reference || "Owner wire") },
		};
		const transfer = await this.wiseRequest(`/v1/transfers`, {
			method: "POST",
			body: payload,
		});
		return transfer?.id || transfer?.transferId;
	}

	computeBeneficiaryFingerprint({ name, iban, swift }) {
		const norm = `${String(name || "").trim()}|${String(iban || "")
			.replace(/\s+/g, "")
			.toUpperCase()}|${String(swift || "")
			.trim()
			.toUpperCase()}`;
		return crypto.createHash("sha256").update(norm).digest("hex");
	}

	ensureReady() {
		const live =
			String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		const enabled =
			String(process.env.BANK_WIRE_ENABLE || "false").toLowerCase() === "true";
		if (!live) throw new Error("BankWireGateway: SWARM_LIVE=true required");
		if (!enabled)
			throw new Error("BankWireGateway: BANK_WIRE_ENABLE=true required");

		if (this.provider !== "LIVE" && this.provider !== "WISE") {
			throw new Error(
				"BankWireGateway: Simulation disabled. Set BANK_WIRE_PROVIDER=LIVE or WISE, or disable route",
			);
		}

		const owner = {
			name: process.env.OWNER_BENEFICIARY_NAME,
			iban: process.env.OWNER_IBAN,
			swift: process.env.OWNER_SWIFT,
			bankName: process.env.OWNER_BANK_NAME,
			bankCountry: process.env.OWNER_BANK_COUNTRY || undefined,
		};
		if (!owner.name || !owner.iban || !owner.swift) {
			throw new Error(
				"BankWireGateway: Missing owner bank details (OWNER_BENEFICIARY_NAME/OWNER_IBAN/OWNER_SWIFT)",
			);
		}
		const fp = this.computeBeneficiaryFingerprint(owner);
		const allowJson = process.env.OWNER_BENEFICIARY_ALLOWLIST_JSON || "[]";
		let allow = [];
		try {
			allow = JSON.parse(allowJson);
		} catch {
			allow = [];
		}
		const allowed = Array.isArray(allow) && allow.map(String).includes(fp);
		const normIban = String(owner.iban || "").replace(/\s+/g, "").toUpperCase();
		const allowedIban = Array.isArray(allow) && allow.map((s) => String(s).replace(/\s+/g, "").toUpperCase()).includes(normIban);
		if (!allowedIban && !allowed)
			throw new Error("BankWireGateway: Owner beneficiary not allowlisted (fingerprint or IBAN required)");

		return { owner };
	}

	normalizeTransactions(transactions) {
		const list = Array.isArray(transactions) ? transactions : [];
		if (list.length === 0)
			throw new Error("BankWireGateway: No transactions provided");
		const currency = (list[0].currency || "USD").toUpperCase();
		let total = 0;
		for (const t of list) {
			const c = (t.currency || "USD").toUpperCase();
			if (c !== currency)
				throw new Error(
					`BankWireGateway: Mixed currencies not supported (${c} vs ${currency})`,
				);
			const amt = Number(t.amount);
			if (!Number.isFinite(amt) || amt <= 0) continue;
			total += amt;
		}
		if (!(total > 0))
			throw new Error("BankWireGateway: Sum of amounts is zero");
		const reference =
			list[0]?.reference ||
			`Owner wire ${new Date().toISOString().slice(0, 10)}`;
		return { amount: Number(total.toFixed(2)), currency, reference };
	}

	async executeTransfer(transactions) {
		const { owner } = this.ensureReady();
		const { amount, currency, reference } =
			this.normalizeTransactions(transactions);

		if (this.provider === "LIVE") {
			throw new Error(
				"BankWireGateway: LIVE provider integration not implemented. Set BANK_WIRE_PROVIDER=WISE or disable route",
			);
		}

		// WISE provider implementation
		const receiptsDir = "settlements/bank_wires";
		try {
			const profileId = await this.wiseGetProfileId();
			const recipient = await this.wiseEnsureRecipient({
				profileId,
				currency,
				owner,
			});
			const quoteId = await this.wiseCreateQuote({
				profileId,
				sourceCurrency: currency,
				targetCurrency: recipient.currency || currency,
				sourceAmount: amount,
				targetAccountId: recipient.id,
			});
			const transferId = await this.wiseCreateTransfer({
				targetAccountId: recipient.id,
				quoteId,
				reference,
			});
			// Write receipt
			const fs = await import("node:fs");
			const path = await import("node:path");
			const dir = path.resolve(process.cwd(), receiptsDir);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			const file = path.join(
				dir,
				`wise_${String(transferId)}_${Date.now()}.json`,
			);
			const payload = {
				provider: "WISE",
				transfer_id: transferId,
				quote_id: quoteId,
				recipient_id: recipient.id,
				recipient_currency: recipient.currency || null,
				amount,
				currency,
				reference,
				timestamp: new Date().toISOString(),
				api_base: this.wiseBase(),
			};
			fs.writeFileSync(file, JSON.stringify(payload, null, 2));
			return {
				route: "bank_transfer",
				provider: "WISE",
				status: "SUBMITTED",
				transfer_id: transferId,
				quote_id: quoteId,
				recipient_id: recipient.id,
				receipt_file: file,
			};
		} catch (e) {
			throw new Error(`WISE_TRANSFER_FAILED: ${e?.message || String(e)}`);
		}
	}
}
