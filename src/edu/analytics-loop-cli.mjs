import { getEnvBool } from "./base-client.mjs";
import { CourseAnalytics } from "./analytics-loop.mjs";

async function main() {
	const live = getEnvBool("SWARM_LIVE", false);
	const dryRun = !getEnvBool("SWARM_LIVE", false);
	const dnaFile = process.argv[3] || process.env.EDU_ANALYTICS_DNA || null;
	const priceCents = Number(process.env.EDU_PRICE_CENTS || 3000);

	let dna = { id: "unknown", title: "Course", priceCents, modules: [] };
	if (dnaFile) {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		dna = JSON.parse(await fs.readFile(path.resolve(dnaFile), "utf8"));
	}

	const stats = safeJson(process.env.EDU_ANALYTICS_STATS);
	const saleStats = safeJson(process.env.EDU_ANALYTICS_SALES, { pageViews: 0, enrollments: 0 });

	const analytics = new CourseAnalytics({ live });
	const out = await analytics.run({ dna, stats, saleStats, dryRun });
	console.log(JSON.stringify(out, null, 2));
	return out;
}

function safeJson(raw, fallback = {}) {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw);
	} catch {
		return fallback;
	}
}

if (process.argv[1] && process.argv[1].endsWith("analytics-loop-cli.mjs")) {
	main().catch((e) => {
		console.error(`[ANALYTICS] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default main;
