import fs from "node:fs";
import path from "node:path";
import { ProcurementExecutionEngine } from "../src/procurement/ProcurementExecutionEngine.mjs";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg.startsWith("--")) {
		const eq = arg.indexOf("=");
		const key = eq !== -1 ? arg.slice(2, eq) : arg.slice(2);
		if (eq !== -1) args[key] = arg.slice(eq + 1);
		else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args[key] = argv[++i];
		else args[key] = true;
	}
}

function readOrders(filePath) {
	const abs = path.resolve(process.cwd(), filePath);
	const data = JSON.parse(fs.readFileSync(abs, "utf8"));
	if (Array.isArray(data)) return data;
	if (Array.isArray(data.orders)) return data.orders;
	throw new Error("expected JSON array or { orders: [...] }");
}

async function main() {
	const engine = new ProcurementExecutionEngine();
	const state = engine.loadState();

	if (args["ingest"]) {
		const orders = readOrders(args["ingest"]);
		let count = 0;
		for (const raw of orders) {
			const exists = state.queue.some((o) => o.id === (raw.id ?? null));
			if (exists) continue;
			engine.ingestOrder(state, raw);
			count++;
		}
		engine.saveState(state);
		console.log(JSON.stringify({ ingested: count, queued: state.queue.length }, null, 2));
		return;
	}

	if (args["status"]) {
		console.log(JSON.stringify(engine.telemetry(state), null, 2));
		return;
	}

	if (args["reconcile"]) {
		if (!args["receipts"]) throw new Error("--reconcile requires --receipts <file.json>");
		const receipts = readOrders(args["receipts"]);
		const result = engine.reconcileReceipts(receipts);
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const result = engine.runCycle();
	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
