import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { VirtualCardManager } from "../src/finance/VirtualCardManager.mjs";
import { SupplyChainSelfCorrector } from "../src/procurement/SupplyChainSelfCorrector.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("VirtualCardManager strict parameters", () => {
	const cardMgr = new VirtualCardManager({ audit: { log: () => true } });

	it("rejects card without positive limits", () => {
		assert.throws(() =>
			cardMgr.issueCard({ agentId: "a1", perTransactionLimit: 0, dailyLimit: 10, totalLimit: 100 }),
		);
	});

	it("issues a card and enforces merchant allowlist", async () => {
		const card = cardMgr.issueCard({
			agentId: "agent-1",
			perTransactionLimit: 50,
			dailyLimit: 100,
			totalLimit: 500,
			merchantAllowlist: ["SAMSUNG"],
			expiresAtMs: Date.now() + 86400000,
		});
		assert.strictEqual(card.status, "active");

		await assert.rejects(
			cardMgr.authorizeSpend({ cardId: card.id, amount: 10, merchant: "MALICIOUS-MART" }),
			/not allowlisted/,
		);
	});

	it("denies spend over per-transaction limit", async () => {
		const card = cardMgr.issueCard({
			agentId: "agent-2",
			perTransactionLimit: 5,
			dailyLimit: 100,
			totalLimit: 500,
		});
		await assert.rejects(
			cardMgr.authorizeSpend({ cardId: card.id, amount: 50, merchant: "SAMSUNG" }),
			/per-transaction limit/,
		);
	});

	it("denies spend to non-owner destination", async () => {
		const card = cardMgr.issueCard({
			agentId: "agent-3",
			perTransactionLimit: 50,
			dailyLimit: 100,
			totalLimit: 500,
		});
		await assert.rejects(
			cardMgr.authorizeSpend({
				cardId: card.id,
				amount: 10,
				merchant: "SAMSUNG",
				destination: "attacker@evil.com",
			}),
			/destination not owner-bound/,
		);
	});
});

describe("SupplyChainSelfCorrector", () => {
	let tmp;
	let corrector;

	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scc-"));
		const ordersPath = path.join(tmp, "orders.json");
		fs.writeFileSync(
			ordersPath,
			JSON.stringify({
				orders: [
					{
						id: "ord-1",
						items: [
							{
								id: "item-1",
								sku: "SKU-A",
								label: "Widget A",
								expectedBy: new Date(Date.now() - 86400000).toISOString(),
								amount: 10,
								alternatives: [{ sku: "SKU-B", label: "Widget B", preference: 1, inStock: true }],
							},
							{
								id: "item-2",
								sku: "SKU-C",
								label: "Widget C",
								expectedBy: new Date(Date.now() - 86400000).toISOString(),
								status: "received",
							},
							{
								id: "item-3",
								sku: "SKU-D",
								expectedBy: new Date(Date.now() + 86400000).toISOString(),
							},
						],
					},
				],
			}),
		);
		corrector = new SupplyChainSelfCorrector({
			ordersPath,
			intentsPath: path.join(tmp, "reorder-intents.jsonl"),
			audit: { log: () => true },
		});
	});

	after(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("queues reorder intent only for delayed item with alternative", () => {
		const created = corrector.scan();
		assert.strictEqual(created.length, 1);
		assert.strictEqual(created[0].itemId, "item-1");
		assert.strictEqual(created[0].alternative.sku, "SKU-B");
		assert.strictEqual(created[0].status, "pending_approval");
	});

	it("does not duplicate intents on second scan", () => {
		const again = corrector.scan();
		assert.strictEqual(again.length, 0);
	});
});
