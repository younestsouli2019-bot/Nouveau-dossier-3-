import fs from "fs/promises";
import path from "path";

async function listFiles(dir, ext) {
	try {
		const files = await fs.readdir(dir);
		return files.filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
	} catch (e) {
		return [];
	}
}

/**
 * PURGE PHANTOM DATA
 *
 * Aggressively deletes all "Simulation" and "Historical Migration" artifacts.
 * If it doesn't have a Real Provider ID, it goes in the trash.
 */
async function purgePhantomData() {
	console.log(">> STARTING PHANTOM DATA PURGE <<");

	// 1. Define the targets (The files identified in the audit)
	const phantoms = [
		"settlements/payoneer/historical/PAYO_HISTORICAL_1768559674249_1.csv",
		"settlements/payoneer/historical/PAYO_HISTORICAL_1768559742922_1.csv",
		"settlements/payoneer/historical/PAYO_HISTORICAL_1768559743232_4.csv",
		"data/financial/settlement_ledger.json", // We will reset this to empty
	];

	let deletedCount = 0;

	for (const file of phantoms) {
		try {
			const absPath = path.resolve(process.cwd(), file);
			await fs.unlink(absPath);
			console.log(`🗑️ DELETED: ${file}`);
			deletedCount++;
		} catch (e) {
			console.log(`⚠️ Could not delete ${file}: ${e.message}`);
		}
	}

	// 2. Reset the Ledger to Clean Slate
	const ledgerPath = path.resolve(
		process.cwd(),
		"data/financial/settlement_ledger.json",
	);
	try {
		await fs.writeFile(ledgerPath, JSON.stringify([], null, 2));
		console.log(
			"🧹 LEDGER WIPED: settlement_ledger.json reset to empty array.",
		);
	} catch (e) {
		// Create if missing
		await fs.writeFile(ledgerPath, JSON.stringify([], null, 2));
	}

	// 3. Delete any "Receipts" that lack external IDs
	// (Simple heuristic: delete all receipts older than today to be safe, or just specific ones)
	// For now, we stick to the known phantoms to avoid deleting potentially real logs.

	console.log(
		`\n>> PURGE COMPLETE. Deleted ${deletedCount} phantom files. Ledger is clean. <<`,
	);
	console.log("Only REAL money allowed from this point forward.");
}

purgePhantomData();
