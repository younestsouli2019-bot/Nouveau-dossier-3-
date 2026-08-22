import { getEnvBool } from "./base-client.mjs";
import { LearnWorldsPublisher } from "./learnworlds-publisher.mjs";
import { GDrivePrepTestImporter } from "./gdrive-import.mjs";

function ownerCourses() {
	const raw = process.env.EDU_COURSES;
	if (!raw) {
		return [
			{ name: "Prep Tests", description: "Exam preparation practice tests", priceCents: 500 },
		];
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		return raw
			.split("|")
			.map((s) => s.trim())
			.filter(Boolean)
			.map((name) => ({ name, priceCents: 500 }));
	}
}

async function loadModules(importer) {
	const folderIds = (process.env.GDRIVE_FOLDER_IDS || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const modules = [];
	for (const folderId of folderIds) {
		const result = await importer.importFolder({ folderId });
		for (const file of result?.imported ?? []) {
			modules.push({
				title: file.name ?? "Lesson",
				videoId: null,
				script: "",
				topic: file.name ?? null,
			});
		}
	}
	return modules;
}

async function main() {
	const mode = process.argv[2] || "publish";
	const live = getEnvBool("SWARM_LIVE", false);
	const payoutDestination = {
		beneficiary: process.env.OWNER_PAYPAL_EMAIL,
		type: "owner",
	};

	if (mode === "publish") {
		const importer = new GDrivePrepTestImporter();
		const modules = await loadModules(importer);
		const publisher = new LearnWorldsPublisher({ live });
		const results = await publisher.publishAll({
			courses: ownerCourses().map((c) => ({
				title: c.name,
				description: c.description ?? "",
				priceCents: c.priceCents,
				modules,
			})),
			payoutDestination,
		});
		console.log(JSON.stringify({ live, results }, null, 2));
		return results;
	}

	if (mode === "status") {
		const importer = new GDrivePrepTestImporter();
		const modules = await loadModules(importer);
		console.log(JSON.stringify({ live, courses: ownerCourses(), moduleCount: modules.length }, null, 2));
		return { live, modules };
	}

	console.error("Usage: edu-publisher-cli.mjs [publish|status]");
	process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("edu-publisher-cli.mjs")) {
	main().catch((e) => {
		console.error(`[EDU] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default main;
