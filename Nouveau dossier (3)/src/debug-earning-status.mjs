import { loadEnv } from "./load-env.mjs";
import { buildBase44ServiceClient } from "./base44-client.mjs";

async function main() {
	loadEnv();
	const client = buildBase44ServiceClient();
	const collectionName = process.env.BASE44_EARNING_ENTITY ?? "earnings";

	console.log(`Checking earnings in ${collectionName}...`);
	try {
		// Try listing without arguments first to avoid 405
		const result = await client.asServiceRole.entities[collectionName].list();
		console.log(`Found ${result.length} recent earnings.`);

		// Group by status
		const statusCounts = {};
		for (const item of result) {
			const status = item.status || "undefined";
			statusCounts[status] = (statusCounts[status] || 0) + 1;
		}
		console.log("Status distribution:", statusCounts);

		if (result.length > 0) {
			console.log("First item:", JSON.stringify(result[0], null, 2));
		}
	} catch (e) {
		console.error("Error:", e.message);
	}
}

main();
