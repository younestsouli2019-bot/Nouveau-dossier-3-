import { getEnvBool } from "./base-client.mjs";
import { ResearchAgent } from "./research-brief.mjs";
import { ScriptWriter } from "./script-writer.mjs";

async function main() {
	const mode = process.argv[2] || "script";
	const live = getEnvBool("SWARM_LIVE", false);
	const dryRun = !getEnvBool("SWARM_LIVE", false);
	const topic = process.env.EDU_TOPIC || process.argv[3] || null;
	const category = process.env.EDU_CATEGORY || null;
	const audience = process.env.EDU_AUDIENCE || "beginners";
	const rawClaims = process.env.EDU_CLAIMS || "";
	const claims = rawClaims
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean);

	if (!topic) {
		console.error("Usage: research-script-cli.mjs [research|script] <topic>  (or set EDU_TOPIC)");
		process.exit(1);
	}

	const research = new ResearchAgent({ live });
	const writer = new ScriptWriter({ research, live });

	if (mode === "research") {
		const out = await research.run({ topic, category, dryRun });
		console.log(JSON.stringify(out, null, 2));
		return out;
	}

	const out = await writer.run({ topic, audience, category, dryRun });
	console.log(JSON.stringify(out, null, 2));
	return out;
}

if (process.argv[1] && process.argv[1].endsWith("research-script-cli.mjs")) {
	main().catch((e) => {
		console.error(`[RESEARCH-SCRIPT] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default main;
