import fs from "node:fs";
import path from "node:path";
import { ProcurementExecutionEngine } from "../src/procurement/ProcurementExecutionEngine.mjs";

const CATEGORIES = {
	medical: { priority: "critical", urgencyHours: 6 },
	health: { priority: "critical", urgencyHours: 12 },
	food: { priority: "critical", urgencyHours: 24 },
	perishable: { priority: "critical", urgencyHours: 24 },
	bulk: { priority: "bulk", urgencyHours: 120 },
	general: { priority: "standard", urgencyHours: 168 },
};

const VENDORS = [
	{ id: "VEN-MED-A", name: "MedSupply Direct", slaHours: 12 },
	{ id: "VEN-MED-B", name: "PharmaLogix", slaHours: 24 },
	{ id: "VEN-FOOD-A", name: "FreshChain Cold", slaHours: 6 },
	{ id: "VEN-BULK-A", name: "BulkWare International", slaHours: 96 },
	{ id: "VEN-GEN-A", name: "General Distributors", slaHours: 72 },
];

function buildOrders(count = 55) {
	const orders = [];
	for (let i = 1; i <= count; i++) {
		const roll = i % 10;
		let category;
		if (roll <= 2) category = "medical";
		else if (roll === 3) category = "food";
		else if (roll === 4) category = "perishable";
		else if (roll <= 7) category = "bulk";
		else category = "general";
		const cfg = CATEGORIES[category];
		const vendor =
			category === "medical" || category === "health"
				? VENDORS[i % 2 === 0 ? 1 : 0]
				: category === "food" || category === "perishable"
					? VENDORS[2]
					: category === "bulk"
						? VENDORS[3]
						: VENDORS[4];
		orders.push({
			id: `ORD-${String(i).padStart(3, "0")}`,
			sku: `SKU-${category.toUpperCase()}-${i}`,
			label: `${category} item ${i}`,
			category,
			priority: cfg.priority,
			urgencyHours: cfg.urgencyHours,
			qty: category === "bulk" ? 50 + i : 1 + (i % 10),
			unitPrice: category === "medical" ? 250 : category === "bulk" ? 12 : 18,
			currency: "USD",
			vendor,
			destination: `WH-${(i % 3) + 1}`,
		});
	}
	return orders;
}

function main() {
	const queuePath = path.resolve("data", "procurement", "execution", "order-queue.json");
	const orders = buildOrders(Number(process.argv[2] || 55));
	if (fs.existsSync(queuePath)) {
		console.error("order-queue.json already exists; remove it to re-seed");
		process.exit(1);
	}
	const engine = new ProcurementExecutionEngine();
	const state = engine.loadState();
	let count = 0;
	for (const raw of orders) {
		engine.ingestOrder(state, raw);
		count++;
	}
	engine.saveState(state);
	console.log(JSON.stringify({ seeded: count, telemetry: engine.telemetry(state) }, null, 2));
}

main();
