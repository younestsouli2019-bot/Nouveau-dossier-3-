import { buildSwarmGuardrails } from "../src/swarm-guardrails.mjs";
import fs from "node:fs";
import path from "node:path";

function main() {
	const root = process.cwd();
	const ledgerPath = path.resolve(root, "data", "financial", "settlement_ledger.json");
	const g = buildSwarmGuardrails();

	const ledger = fs.existsSync(ledgerPath)
		? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
		: { settlements: [], totalSettledUsd: 0, totalRevenueUsd: 0 };

	if (!Array.isArray(ledger.settlements)) ledger.settlements = [];

	const uniq = new Map();
	const kept = [];
	let droppedDups = 0;
	for (const s of ledger.settlements) {
		const cycle = String(s?.cycle_ref ?? s?.cycleRef ?? "");
		const conn = String(s?.connector ?? s?.rail ?? "");
		const curr = String(s?.currency ?? "USD");
		const amt = Number(s?.amount ?? s?.amount_usd ?? 0);
		const rhash = String(s?.recipient_hash ?? "");
		const amtRounded = Number.isFinite(amt) ? amt.toFixed(6) : "nan";
		const key = [cycle, conn, curr, amtRounded, rhash].join("|");
		if (uniq.has(key)) {
			droppedDups++;
			console.log("DROP DUP cycle=%s key=%s", cycle, key);
			continue;
		}
		uniq.set(key, true);
		kept.push(s);
	}
	ledger.settlements = kept;
	ledger.dedupAppliedAt = new Date().toISOString();
	ledger.duplicatesDropped = droppedDups;
	fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
	fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
	const totalRevenue = ledger.settlements.reduce(
		(s, x) => s + (Number(x?.revenue_usd ?? 0) || 0),
		0,
	);
	console.log(
		"dedup ok: kept=%s dropped=%s totalRevenueUsd=%s",
		ledger.settlements.length,
		droppedDups,
		totalRevenue.toFixed(4),
	);

	for (const [label, actor] of [
		["oracle_baseline:chainlink", "oracle_chainlink"],
		["oracle_baseline:pyth", "oracle_pyth"],
		["oracle_baseline:birdeye", "oracle_birdeye"],
	]) {
		g.recordDecision(label, "independent oracle/source baseline", { actor });
	}
	console.log("oracle baseline decisions seeded");
}

main();
