import { loadEnv } from "./load-env.mjs";
import { buildBase44ServiceClient } from "./base44-client.mjs";

async function main() {
	console.log("Loading env...");
	loadEnv();

	console.log("BASE44_API_URL:", process.env.BASE44_API_URL);
	console.log("BASE44_SERVER_URL:", process.env.BASE44_SERVER_URL);

	const client = buildBase44ServiceClient();
	console.log("Client created.");

	try {
		console.log("Attempting to list earnings...");
		// Assuming 'earnings' is the collection name, or checking env for it
		const collectionName = process.env.EARNING_COLLECTION || "earnings";
		console.log(`Collection: ${collectionName}`);

		console.log("Testing list() args...");

		try {
			console.log("1. list()");
			const r1 = await client.asServiceRole.entities[collectionName].list();
			console.log("   -> Success, count:", r1.length);
		} catch (e) {
			console.log("   -> Failed:", e.message);
		}

		try {
			console.log("2. list(10) (limit as first arg?)");
			const r2 = await client.asServiceRole.entities[collectionName].list(10);
			console.log("   -> Success, count:", r2.length);
		} catch (e) {
			console.log("   -> Failed:", e.message);
		}

		try {
			console.log("3. list({ limit: 10 }) (options object?)");
			const r3 = await client.asServiceRole.entities[collectionName].list({
				limit: 10,
			});
			console.log("   -> Success, count:", r3.length);
		} catch (e) {
			console.log("   -> Failed:", e.message);
		}

		try {
			console.log("4. list(null, 10) (filter first?)");
			const r4 = await client.asServiceRole.entities[collectionName].list(
				null,
				10,
			);
			console.log("   -> Success, count:", r4.length);
		} catch (e) {
			console.log("   -> Failed:", e.message);
		}

		console.log("Done testing.");
	} catch (e) {
		console.error("List failed:", e.message);
		if (e.response) {
			console.error("Status:", e.response.status);
			console.error("Data:", e.response.data);
		}
	}
}

main();
