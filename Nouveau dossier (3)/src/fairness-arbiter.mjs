import fs from "node:fs/promises";
import path from "node:path";

function toArray(x) {
	return Array.isArray(x) ? x : [];
}

async function readJsonMaybe(p, fallback) {
	try {
		const t = await fs.readFile(p, "utf8");
		const v = JSON.parse(String(t));
		return v && typeof v === "object" ? v : fallback;
	} catch {
		return fallback;
	}
}

function sum(arr, sel) {
	let s = 0;
	for (const x of arr) {
		const n = Number(sel(x));
		if (Number.isFinite(n)) s += n;
	}
	return s;
}

export async function runFairnessAudit({
	baseDir = "data/base44_export",
} = {}) {
	const root = path.resolve(process.cwd(), baseDir);
	const payouts = await readJsonMaybe(path.join(root, "PayoutBatch.json"), []);
	const revenue = await readJsonMaybe(path.join(root, "RevenueEvent.json"), []);
	const payoutArr = toArray(payouts);
	const revenueArr = toArray(revenue);

	const agentPayouts = {};
	let totalPayouts = 0;
	for (const p of payoutArr) {
		const agentId = p?.metadata?.agent_id ?? p?.agent_id ?? "unknown";
		const amount = Number(p?.total_amount ?? p?.amount ?? 0);
		if (!Number.isFinite(amount) || amount <= 0) continue;
		totalPayouts += amount;
		agentPayouts[agentId] = (agentPayouts[agentId] ?? 0) + amount;
	}

	const agentRevenue = {};
	let totalRevenue = 0;
	for (const r of revenueArr) {
		const agentId = r?.metadata?.agent_id ?? r?.agent_id ?? "unknown";
		const amount = Number(r?.amount ?? 0);
		if (!Number.isFinite(amount) || amount <= 0) continue;
		totalRevenue += amount;
		agentRevenue[agentId] = (agentRevenue[agentId] ?? 0) + amount;
	}

	const agents = new Set([
		...Object.keys(agentPayouts),
		...Object.keys(agentRevenue),
	]);
	const avgPayout = agents.size > 0 ? totalPayouts / agents.size : 0;
	const bias = [];
	for (const a of agents) {
		const pa = agentPayouts[a] ?? 0;
		const ra = agentRevenue[a] ?? 0;
		const deviation = avgPayout > 0 ? (avgPayout - pa) / avgPayout : 0;
		if (deviation > 0.2) {
			bias.push({
				agent: a,
				status: "UNDER_FUNDED",
				deficitPercent: Number((deviation * 100).toFixed(1)),
				payoutAmount: pa,
				revenueAmount: ra,
			});
		} else if (deviation < -0.2) {
			bias.push({
				agent: a,
				status: "OVER_FUNDED",
				surplusPercent: Number((Math.abs(deviation) * 100).toFixed(1)),
				payoutAmount: pa,
				revenueAmount: ra,
			});
		}
	}

	const summary = {
		ok: true,
		at: new Date().toISOString(),
		totals: { payouts: totalPayouts, revenue: totalRevenue },
		agents: Array.from(agents),
		bias,
	};
	return summary;
}
