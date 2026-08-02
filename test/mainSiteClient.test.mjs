import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { MainSiteClient, verifyMainSiteWebhookSignature, normalizeMainSiteSale } from "../src/edu/main-site-client.mjs";

function mockFetch() {
	const calls = [];
	return {
		calls,
		async fetchImpl(url, opts) {
			calls.push({ url: String(url), opts });
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
	};
}

describe("MainSiteClient (RealWorldCerts)", () => {
	it("verifies webhook HMAC signatures (timing-safe)", () => {
		const secret = "s3cr3t";
		const payload = '{"id":"o1","amount_cents":500}';
		const sig = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
		assert.strictEqual(verifyMainSiteWebhookSignature({ signature: sig, payload, secret }), true);
		assert.strictEqual(verifyMainSiteWebhookSignature({ signature: "sha256=deadbeef", payload, secret }), false);
	});

	it("normalizes a sale payload with affiliate referral code", () => {
		const sale = normalizeMainSiteSale({
			id: "o-123",
			amount_cents: 1500,
			currency: "USD",
			customer_email: "buyer@example.com",
			product_name: "Prep Tests",
			referral_code: "RWC-ABC123",
		});
		assert.strictEqual(sale.platform, "realworldcerts");
		assert.strictEqual(sale.externalId, "o-123");
		assert.strictEqual(sale.amountCents ?? sale.amount, 1500);
		assert.strictEqual(sale.affiliateCode, "RWC-ABC123");
	});

	it("calls the RealWorldCerts API for sales and affiliates", async () => {
		const m = mockFetch();
		const client = new MainSiteClient({ apiKey: "key-1", fetchImpl: m.fetchImpl });
		await client.listSales();
		await client.createAffiliate({ name: "Jane", email: "jane@example.com", commissionRate: 0.2 });
		const calls = m.calls;
		assert.ok(calls[0].url.includes("/v1/sales"));
		assert.ok(calls[1].url.includes("/v1/affiliates"));
		assert.strictEqual(calls[1].opts.method, "POST");
		const body = JSON.parse(calls[1].opts.body);
		assert.strictEqual(body.commission_rate, 0.2);
		assert.strictEqual(calls[0].opts.headers.Authorization, "Bearer key-1");
	});

	it("throws on a non-2xx API response", async () => {
		const client = new MainSiteClient({
			apiKey: "key-1",
			apiBase: "https://api.realworldcerts.com",
			fetchImpl: async () => new Response("boom", { status: 500 }),
		});
		await assert.rejects(() => client.status(), /EDU request failed \(500\)/);
	});
});
