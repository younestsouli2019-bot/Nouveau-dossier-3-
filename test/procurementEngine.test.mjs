import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProcurementExecutionEngine } from "../src/procurement/ProcurementExecutionEngine.mjs";

function tempDir() {
	const dir = path.join(os.tmpdir(), `proc-test-${process.pid}-${Date.now()}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function makeEngine() {
	const dir = tempDir();
	const engine = new ProcurementExecutionEngine({
		queuePath: path.join(dir, "order-queue.json"),
		ledgerPath: path.join(dir, "erp-ledger.json"),
		poDir: path.join(dir, "purchase-orders"),
	});
	engine.liveMode = false;
	return engine;
}

describe("ProcurementExecutionEngine", () => {
	it("classifies critical needs as Phase 1 (immediate dispatch)", () => {
		const engine = makeEngine();
		const state = engine.loadState();
		engine.ingestOrder(state, {
			id: "MED-1",
			category: "medical",
			priority: "critical",
			urgencyHours: 6,
			qty: 10,
			unitPrice: 100,
		});
		engine.ingestOrder(state, {
			id: "BULK-1",
			category: "general",
			priority: "bulk",
			qty: 500,
			unitPrice: 5,
		});
		assert.strictEqual(state.queue.find((o) => o.id === "MED-1").phase, 1);
		assert.strictEqual(state.queue.find((o) => o.id === "BULK-1").phase, 2);
	});

	it("auto-approves and dispatches Phase 1 immediately, drafts POs in dry-run", () => {
		const engine = makeEngine();
		const state = engine.loadState();
		engine.ingestOrder(state, {
			id: "ORD-A",
			category: "perishable",
			urgencyHours: 12,
			qty: 4,
			unitPrice: 50,
			vendor: { id: "VEN-X", slaHours: 6 },
		});
		engine.saveState(state);
		const result = engine.runCycle();
		const order = result.telemetry;
		assert.ok(order);
		const poPath = path.join(engine.poDir, "PO-ORD-A.json");
		assert.ok(fs.existsSync(poPath), "PO should be drafted");
		const po = JSON.parse(fs.readFileSync(poPath, "utf8"));
		assert.strictEqual(po.mode, "draft");
		assert.strictEqual(po.approval.mode, "auto");
		assert.ok(po.approval.status, "dry_run_no_key");
	});

	it("flags a receipt quantity discrepancy during reconciliation", () => {
		const engine = makeEngine();
		const state = engine.loadState();
		engine.ingestOrder(state, {
			id: "ORD-B",
			category: "food",
			qty: 3,
			unitPrice: 10,
		});
		engine.saveState(state);
		engine.runCycle();
		const result = engine.reconcileReceipts([{ orderId: "ORD-B", qty: 999 }]);
		assert.strictEqual(result.matched.length, 1);
		assert.strictEqual(result.matched[0].quantityMatch, false);
		const after = engine.loadState();
		assert.strictEqual(after.queue.find((o) => o.id === "ORD-B").status, "discrepancy");
	});

	it("deferring approval when amount exceeds the auto-approve cap", () => {
		const engine = makeEngine();
		engine.autoApproveMaxUsd = 100;
		const state = engine.loadState();
		engine.ingestOrder(state, {
			id: "ORD-C",
			category: "general",
			qty: 10,
			unitPrice: 100,
		});
		const approval = engine.autoApprove(state.queue[0]);
		assert.strictEqual(approval.status, "deferred_amount_cap");
	});
});
