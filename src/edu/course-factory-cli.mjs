import { getEnvBool } from "./base-client.mjs";
import { CourseFactory } from "./course-factory.mjs";

async function main() {
	const mode = process.argv[2] || "preview";
	const live = getEnvBool("SWARM_LIVE", false);
	const dryRun = !getEnvBool("SWARM_LIVE", false);
	const topics = (process.env.EDU_TOPICS || process.env.COURSE_FACTORY_TOPICS || "")
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean);
	const niche = process.env.EDU_NICHE || null;
	const category = process.env.EDU_CATEGORY || "technology";
	const audience = process.env.EDU_AUDIENCE || "beginners";

	const factory = new CourseFactory({ live });
	const payoutDestination = {
		beneficiary: process.env.OWNER_PAYPAL_EMAIL,
		type: "owner",
	};

	if (mode === "preview" || mode === "publish") {
		const results = await factory.run({
			topics,
			audience,
			category,
			niche,
			dryRun: mode === "preview",
			payoutDestination,
		});
		console.log(JSON.stringify({ live, dryRun, count: results.length, results }, null, 2));
		return results;
	}

	console.error("Usage: course-factory-cli.mjs [preview|publish]");
	process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("course-factory-cli.mjs")) {
	main().catch((e) => {
		console.error(`[COURSE-FACTORY] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default main;
