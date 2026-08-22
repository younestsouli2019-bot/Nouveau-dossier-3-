import { AffiliateProgram } from "../src/edu/affiliate-program.mjs";

const mode = process.argv[2] || "status";
const storePath = process.env.AFFILIATE_STORE_PATH || "data/edu/affiliate-program.json";
const prog = new AffiliateProgram({
	storePath,
	live: process.env.SWARM_LIVE === "true",
});

async function main() {
	if (mode === "status") {
		console.log(JSON.stringify(prog.status(), null, 2));
		return;
	}
	if (mode === "recruit") {
		const sponsorEmail = process.env.AFFILIATE_SPONSOR_EMAIL;
		if (!sponsorEmail) {
			console.error("AFFILIATE_SPONSOR_EMAIL required");
			process.exit(1);
		}
		const recruits = JSON.parse(process.env.AFFILIATE_RECRUITS || "[]");
		const created = prog.recruitLoop({
			sponsorEmail,
			sponsorDestination: JSON.parse(process.env.AFFILIATE_SPONSOR_DESTINATION || "{}"),
			recruits,
		});
		console.log(JSON.stringify({ created: created.length, affiliates: created }, null, 2));
		return;
	}
	if (mode === "approve") {
		const approved = prog.approvePayouts({
			ownerDestination: JSON.parse(process.env.AFFILIATE_OWNER_DESTINATION || "{}"),
		});
		console.log(JSON.stringify({ approved }, null, 2));
		return;
	}
	console.error("Usage: affiliate-program-cli.mjs [status|recruit|approve]");
	process.exit(1);
}

main().catch((e) => {
	console.error(`[AFFILIATE] Fatal: ${e.message}`);
	process.exit(1);
});
