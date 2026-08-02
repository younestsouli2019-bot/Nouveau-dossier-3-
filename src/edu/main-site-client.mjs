import crypto from "node:crypto";
import { eduFetch, getEnvBool, getEnvOrThrow, getHttpTimeoutMs, liveModeGate } from "./base-client.mjs";

const DEFAULT_BASE = "https://www.realworldcerts.com";
const DEFAULT_API = "https://api.realworldcerts.com";

export function verifyMainSiteWebhookSignature({ signature, payload, secret }) {
	if (!secret) return true;
	if (typeof signature !== "string" || !signature) return false;
	const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
	const a = Buffer.from(signature);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

export function normalizeMainSiteSale(sale = {}) {
	const amountCents = Math.round(Number(sale.amount_cents ?? sale.amount ?? 0) * 1);
	return {
		externalId: String(sale.id ?? sale.order_id ?? ""),
		platform: "realworldcerts",
		productName: sale.product_name ?? sale.title ?? "Course",
		customerEmail: sale.customer_email ?? sale.email ?? "",
		amountCents,
		currency: sale.currency ?? "USD",
		referralCode: sale.referral_code ?? sale.affiliate_code ?? null,
		affiliateCode: sale.referral_code ?? sale.affiliate_code ?? null,
		status: sale.status ?? "paid",
		ts: sale.created_at ?? new Date().toISOString(),
	};
}

export class MainSiteClient {
	constructor({ apiKey, baseUrl = DEFAULT_BASE, apiBase = DEFAULT_API, fetchImpl = fetch } = {}) {
		this.apiKey =
			apiKey ?? (getEnvBool("MAINSITE_ENABLED", false) ? getEnvOrThrow("MAINSITE_API_KEY") : process.env.MAINSITE_API_KEY);
		this.baseUrl = baseUrl ?? process.env.MAINSITE_URL ?? DEFAULT_BASE;
		this.apiBase = apiBase ?? process.env.MAINSITE_API_URL ?? DEFAULT_API;
		this.fetchImpl = fetchImpl;
	}

	_headers() {
		return {
			Accept: "application/json",
			...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
		};
	}

	async _api(path, { method = "GET", body } = {}) {
		return eduFetch({
			url: `${this.apiBase}${path}`,
			method,
			headers: this._headers(),
			body,
			fetchImpl: this.fetchImpl,
		});
	}

	async listSales({ page = 1, limit = 50 } = {}) {
		return this._api(`/v1/sales?page=${page}&limit=${limit}`);
	}

	async getSale(saleId) {
		return this._api(`/v1/sales/${encodeURIComponent(saleId)}`);
	}

	async listAffiliates({ page = 1, limit = 50 } = {}) {
		return this._api(`/v1/affiliates?page=${page}&limit=${limit}`);
	}

	async createAffiliate({ name, email, commissionRate = 0.2, payoutMethod = "paypal" } = {}) {
		return this._api("/v1/affiliates", {
			method: "POST",
			body: {
				name,
				email,
				commission_rate: commissionRate,
				payout_method: payoutMethod,
			},
		});
	}

	async getAffiliateConversions(affiliateId) {
		return this._api(`/v1/affiliates/${encodeURIComponent(affiliateId)}/conversions`);
	}

	async registerWebhook({ event, url, secret } = {}) {
		return this._api("/v1/webhooks", {
			method: "POST",
			body: {
				event,
				url,
				...(secret ? { secret } : {}),
			},
		});
	}

	async status() {
		return this._api("/v1/status");
	}
}

export default MainSiteClient;
