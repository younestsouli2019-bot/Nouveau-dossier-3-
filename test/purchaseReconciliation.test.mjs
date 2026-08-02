import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
	PurchaseReconciler,
	verifyWebhookSignature,
	normalizeTeachableSale,
	normalizeLearnWorldsSale,
	normalizeMainSiteSale,
} from "../src/edu/purchase-reconciliation.mjs";
import { AffiliateProgram } from "../src/edu/affiliate-program.mjs";

describe("purchase reconciliation", () => {
	let tmpDir;
	let ledgerPath;

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "edu-test-"));
		ledgerPath = path.join(tmpDir, "purchase-ledger.json");
	});

	after(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("rejects invalid signature", async () => {
		const reconciler = new PurchaseReconciler({ ledgerPath });
		const result = await reconciler.reconcile({
			platform: "teachable",
			event: { data: { sale_id: "s1", price: 500, currency: "USD" } },
			rawBody: "{}",
			signatureHeader: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
			secret: "s3cret",
		});
		assert.strictEqual(result.status, "REJECTED");
	});

	it("accepts valid signature and verifies a real sale", async () => {
		const emitted = [];
		const reconciler = new PurchaseReconciler({
			ledgerPath,
			emitEarning: (e) => {
				emitted.push(e);
				return { id: `E-${e.externalId}` };
			},
		});
		const body = JSON.stringify({ data: { sale_id: "s-abc", price: 500, currency: "USD" } });
		const sig = crypto.createHmac("sha256", "s3cret").update(body).digest("hex");

		const result = await reconciler.reconcile({
			platform: "teachable",
			event: JSON.parse(body),
			rawBody: body,
			signatureHeader: `sha256=${sig}`,
			secret: "s3cret",
		});

		assert.strictEqual(result.status, "VERIFIED");
		assert.strictEqual(result.externalId, "s-abc");
		assert.strictEqual(emitted.length, 1);
		assert.strictEqual(emitted[0].amount, 500);
		assert.strictEqual(emitted[0].currency, "USD");
	});

	it("dedupes identical purchase events", async () => {
		const reconciler = new PurchaseReconciler({ ledgerPath });
		const body = JSON.stringify({ data: { sale_id: "s-abc", price: 500, currency: "USD" } });
		const sig = crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
		const result = await reconciler.reconcile({
			platform: "teachable",
			event: JSON.parse(body),
			rawBody: body,
			signatureHeader: `sha256=${sig}`,
			secret: "s3cret",
		});
		assert.strictEqual(result.status, "DUPLICATE");
	});

	it("normalizes LearnWorlds orders", () => {
		const sale = normalizeLearnWorldsSale({
			data: { id: "order-9", total: 5, currency: "usd" },
		});
		assert.strictEqual(sale.externalId, "order-9");
		assert.strictEqual(sale.amount, 5);
		assert.strictEqual(sale.currency, "USD");
		assert.strictEqual(sale.platform, "learnworlds");
	});

	it("normalizes Teachable sales", () => {
		const sale = normalizeTeachableSale({
			data: { sale_id: 42, price: 499, currency: "usd" },
		});
		assert.strictEqual(sale.externalId, "42");
		assert.strictEqual(sale.amount, 499);
		assert.strictEqual(sale.currency, "USD");
	});

	it("verifyWebhookSignature returns true when no secret set", () => {
		assert.strictEqual(verifyWebhookSignature({ secret: null, rawBody: "x", signatureHeader: null }), true);
	});

	it("normalizes RealWorldCerts sales with affiliate code", () => {
		const sale = normalizeMainSiteSale({
			data: { id: "o-77", amount_cents: 1500, currency: "USD", referral_code: "RWC-XYZ" },
		});
		assert.strictEqual(sale.platform, "realworldcerts");
		assert.strictEqual(sale.externalId, "o-77");
		assert.strictEqual(sale.amount, 1500);
		assert.strictEqual(sale.affiliateCode, "RWC-XYZ");
	});

	it("records an affiliate conversion for a verified RealWorldCerts sale", async () => {
		const storePath = path.join(tmpDir, "affiliate-test.json");
		const affiliateProgram = new AffiliateProgram({ storePath });
		const aff = affiliateProgram.registerAffiliate({ name: "Jane", email: "jane@example.com" });
		const reconciler = new PurchaseReconciler({ ledgerPath, affiliateProgram });

		const body = JSON.stringify({
			data: {
				id: "o-88",
				amount_cents: 5000,
				currency: "USD",
				customer_email: "buyer@example.com",
				referral_code: aff.code,
			},
		});
		const sig = crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
		const result = await reconciler.reconcile({
			platform: "realworldcerts",
			event: JSON.parse(body),
			rawBody: body,
			signatureHeader: `sha256=${sig}`,
			secret: "s3cret",
		});
		assert.strictEqual(result.status, "VERIFIED");
		assert.strictEqual(affiliateProgram.status().conversions, 1);
		const conv = affiliateProgram.state.conversions[0];
		assert.strictEqual(conv.commissionCents, 1000);
	});
});
