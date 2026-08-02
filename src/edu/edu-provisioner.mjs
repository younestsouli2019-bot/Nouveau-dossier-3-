import { getEnvBool } from "./base-client.mjs";
import { LearnWorldsClient } from "./learnworlds-client.mjs";
import { LearnWorldsPublisher } from "./learnworlds-publisher.mjs";
import { TeachableClient } from "./teachable-client.mjs";
import { GDrivePrepTestImporter } from "./gdrive-import.mjs";
import { PurchaseReconciler } from "./purchase-reconciliation.mjs";

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

async function main() {
	const mode = process.argv[2] || "provision";
	const publicBase = process.env.EDU_PUBLIC_BASE_URL || "https://example.com";

	if (mode === "provision") {
		const live = getEnvBool("SWARM_LIVE", false);
		const learnworlds = new LearnWorldsClient();
		const results = { live, teachable: null, learnworlds: null };

		if (getEnvBool("TEACHABLE_ENABLED", false)) {
			const teachable = new TeachableClient();
			results.teachable = { courses: [] };
			for (const course of ownerCourses()) {
				const created = await teachable.createCourse(course);
				const id = created?.course?.id ?? created?.id;
				results.teachable.courses.push({ name: course.name, id });
				if (id) {
					await teachable.setCoursePrice(id, course.priceCents);
					if (getEnvBool("TEACHABLE_PUBLISH", false)) {
						await teachable.publishCourse(id);
					}
				}
			}
		}

		if (getEnvBool("LEARNWORLDS_ENABLED", false)) {
			const publisher = new LearnWorldsPublisher({ client: learnworlds });
			results.learnworlds = await publisher.publishAll({
				courses: ownerCourses().map((c) => ({
					title: c.name,
					description: c.description ?? "",
					priceCents: c.priceCents,
					modules: c.modules ?? [],
				})),
				payoutDestination: {
					beneficiary: process.env.OWNER_PAYPAL_EMAIL,
					type: "owner",
				},
			});
		}

		console.log(JSON.stringify(results, null, 2));
		return results;
	}

	if (mode === "import-preptests") {
		const importer = new GDrivePrepTestImporter();
		const folderIds = (process.env.GDRIVE_FOLDER_IDS || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const results = [];
		for (const folderId of folderIds) {
			const r = await importer.importFolder({ folderId });
			results.push(r);
		}
		console.log(JSON.stringify(results, null, 2));
		return results;
	}

	if (mode === "register-webhooks") {
		const results = {};
		if (getEnvBool("TEACHABLE_ENABLED", false)) {
			const client = new TeachableClient();
			results.teachable = await client.registerWebhook({
				eventName: "course.sale.created",
				url: `${publicBase}/webhook/teachable`,
				secret: process.env.EDU_WEBHOOK_SECRET,
			});
		}
		if (getEnvBool("LEARNWORLDS_ENABLED", false)) {
			const client = new LearnWorldsClient();
			results.learnworlds = await client.registerWebhook({
				event: "sale",
				url: `${publicBase}/webhook/learnworlds`,
			});
		}
		console.log(JSON.stringify(results, null, 2));
		return results;
	}

	if (mode === "status") {
		const reconciler = new PurchaseReconciler();
		console.log(JSON.stringify({ reconciler: reconciler.status() }, null, 2));
		return reconciler.status();
	}

	console.error("Usage: edu-provisioner.mjs [provision|import-preptests|register-webhooks|status]");
	process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("edu-provisioner.mjs")) {
	main().catch((e) => {
		console.error(`[EDU] Fatal: ${e.message}`);
		process.exit(1);
	});
}

export default main;
