import { getEnvBool } from "./base-client.mjs";
import { SiteStandardsAuditor, mainSiteDefaults } from "./site-standards.mjs";

async function main() {
	const dryRun = !getEnvBool("SWARM_LIVE", false);
	const live = getEnvBool("SWARM_LIVE", false);
	const profileFile = process.argv[3] || process.env.EDU_STANDARDS_PROFILE || null;
	const auditor = new SiteStandardsAuditor({ live });

	let profile = mainSiteDefaults();
	if (profileFile) {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const resolved = path.resolve(profileFile);
		profile = { ...profile, ...JSON.parse(await fs.readFile(resolved, "utf8")) };
	}

	const out = await auditor.audit({ profile, dryRun });
	console.log(JSON.stringify(out, null, 2));
	return out;
}

if (process.argv[1] && process.argv[1].endsWith("standards-audit-cli.mjs")) {
	main().catch((e) => {
		console.error(`[STANDARDS] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default main;
