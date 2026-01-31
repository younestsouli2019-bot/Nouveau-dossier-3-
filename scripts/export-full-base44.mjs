import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { buildBase44ServiceClient } from "../src/base44-client.mjs";

const ENTITIES = [
	"Agent",
	"Campaign",
	"Analytics",
	"CoursePromotion",
	"WorkflowExecution",
	"SwarmCoordination",
	"Mission",
	"FinancialGoal",
	"TransactionLog",
	"RevenueEvent",
	"PayoutBatch",
];

async function main() {
	console.log("Starting Full Base44 Backend Export...");

	let client;
	try {
		client = buildBase44ServiceClient({ mode: "online" });
	} catch (err) {
		console.error("Failed to initialize Base44 client:", err.message);
		process.exit(1);
	}

	const outDir = path.resolve("data/base44_export");
	if (!fs.existsSync(outDir)) {
		fs.mkdirSync(outDir, { recursive: true });
	}

	console.log(`Exporting to: ${outDir}`);

	for (const entityName of ENTITIES) {
		process.stdout.write(`Fetching ${entityName}... `);
		try {
			const entityService = client.asServiceRole.entities[entityName];
			if (!entityService) {
				console.log("SKIPPED (Not found in SDK)");
				continue;
			}

			// Fetch all records (pagination might be needed for large datasets,
			// here we fetch up to 1000 which should cover most initial migrations)
			const records = await entityService.list("-created_date", 1000, 0);

			const filePath = path.join(outDir, `${entityName}.json`);
			fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
			console.log(`OK (${records.length} records)`);
		} catch (err) {
			console.log(`FAILED: ${err.message}`);
		}
	}

	// Also try to export the offline store if it exists, as a backup
	const offlinePath = path.resolve(".base44-offline-store.json");
	if (fs.existsSync(offlinePath)) {
		console.log("Backing up local offline store...");
		fs.copyFileSync(
			offlinePath,
			path.join(outDir, "offline-store-backup.json"),
		);
	}

	console.log("\nExport completed.");
	console.log(`Data saved to: ${outDir}`);
	console.log("Ready for migration to ownmy.app");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
