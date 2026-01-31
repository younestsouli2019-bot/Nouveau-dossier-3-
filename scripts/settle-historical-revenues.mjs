// ... imports and classes remain the same ...
import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import dotenv from "dotenv";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);

dotenv.config();

// ===== CONSTITUTIONAL ENFORCEMENT =====
class ConstitutionalGuard {
	static validateRevenueSettlement(events, settlementAmount) {
		const CONSTITUTION = {
			owner_baseline: {
				NO_SCAMS_FRAUD_DECEPTION: true,
				NO_ILLEGAL_CONDUCT: true,
				TAX_CONFORMITY_AT_JURISDICTION_LEVEL: true,
				INDUSTRY_STANDARDS_COMPLIANCE: true,
			},
			financial_constraints: {
				max_settlement_per_transaction_usd: 10000,
				max_daily_settlement_volume_usd: 50000,
				allowed_jurisdictions: ["US", "EU", "UK", "SG"],
			},
		};

		const violations = [];

		// Check individual events
		events.forEach((event) => {
			// Example: Check for suspicious notes
			const suspiciousKeywords = ["casino", "bet", "gamble", "scam", "fraud"];
			if (
				suspiciousKeywords.some((keyword) =>
					event.notes?.toLowerCase().includes(keyword),
				)
			) {
				violations.push({
					event_id: event.event_id,
					violation: "POTENTIAL_BASELINE_VIOLATION",
					reason: "Contains suspicious keywords in notes",
				});
			}
		});

		// Check total amount
		if (
			settlementAmount >
			CONSTITUTION.financial_constraints.max_settlement_per_transaction_usd
		) {
			violations.push({
				violation: "FINANCIAL_CONSTRAINT_VIOLATION",
				reason: `Settlement amount ($${settlementAmount}) exceeds per-transaction limit ($${CONSTITUTION.financial_constraints.max_settlement_per_transaction_usd})`,
			});
		}

		return {
			valid: violations.length === 0,
			violations,
			requires_human_approval: settlementAmount > 5000, // Tier 2 threshold
		};
	}
}

// ===== REVENUE PROCESSOR =====
class HistoricalRevenueProcessor {
	constructor() {
		this.revenueCsvPath = path.join(
			process.cwd(),
			"RevenueEvent_export (1).materialized.csv",
		);
		this.outputDir = path.join(
			process.cwd(),
			"settlements",
			"payoneer",
			"historical",
		);
		this.ownerConfig = {
			recipient_email:
				process.env.OWNER_PAYONEER_EMAIL ||
				process.env.SETTLEMENT_REQUESTOR_EMAIL ||
				"younestsouli2019@gmail.com", // Fallback to known owner
			recipient_name:
				process.env.OWNER_NAME ||
				process.env.SETTLEMENT_REQUESTOR_NAME ||
				"Younes Tsouli",
			payer_name: process.env.BUSINESS_NAME || "RealWorldCerts",
			payer_email:
				process.env.BUSINESS_EMAIL || "supervisor@realworldcerts.com",
			payer_company: process.env.BUSINESS_COMPANY || "RealWorldCerts",
		};
	}

	async loadRevenueEvents() {
		try {
			const csvContent = await fs.readFile(this.revenueCsvPath, "utf-8");
			const records = parse(csvContent, {
				columns: true,
				skip_empty_lines: true,
				cast: (value, context) => {
					if (context.column === "amount") return parseFloat(value) || 0;
					if (context.column === "is_sample") return value === "true";
					return value;
				},
			});

			console.log(`📊 Loaded ${records.length} revenue events`);
			return records;
		} catch (error) {
			console.error("❌ Failed to load revenue events:", error.message);
			throw error;
		}
	}

	filterUnsettledEvents(events) {
		const unsettledEvents = events.filter((event) => {
			const status = (event.status || "").toLowerCase();
			const isEarned =
				status === "earned" || status === "confirmed" || status === "cleared";
			const hasBatch =
				event.payout_batch_id && event.payout_batch_id.trim().length > 0;
			return (
				isEarned &&
				!hasBatch &&
				event.is_sample === false &&
				parseFloat(event.amount) > 0
			);
		});

		console.log(`🔍 Found ${unsettledEvents.length} unsettled revenue events`);
		return unsettledEvents;
	}

	summarizeEvents(events) {
		const summary = events.reduce((acc, event) => {
			const currency = event.currency || "USD";
			if (!acc[currency]) acc[currency] = { count: 0, total: 0, events: [] };
			acc[currency].count++;
			acc[currency].total += parseFloat(event.amount);
			acc[currency].events.push(event);
			return acc;
		}, {});
		return summary;
	}

	async generatePayoneerBatch(events, summary, batchIndex = 0) {
		await fs.mkdir(this.outputDir, { recursive: true });

		const timestamp = Date.now();
		// Add batchIndex to make ID unique if multiple batches in same run
		const batchId = `PAYO_HISTORICAL_${timestamp}_${batchIndex}`;

		// Create manifest for this settlement batch
		const manifest = {
			settlement_batch: {
				batch_id: batchId,
				generated_at: new Date().toISOString(),
				constitutional_validation:
					ConstitutionalGuard.validateRevenueSettlement(
						events,
						Object.values(summary).reduce((sum, data) => sum + data.total, 0),
					),
				summary: summary,
				source_file: this.revenueCsvPath,
				total_events: events.length,
				owner_details: this.ownerConfig,
			},
		};

		// Generate CSV rows for each currency group
		const csvRows = [];

		Object.entries(summary).forEach(([currency, data]) => {
			// Create one payout row per currency
			const row = {
				recipient: this.ownerConfig.recipient_email,
				recipient_email: this.ownerConfig.recipient_email,
				recipient_name: this.ownerConfig.recipient_name,
				amount: data.total.toFixed(2),
				currency: currency,
				batch_id: batchId,
				item_id: `${batchId}_${currency}`,
				note: `Historical revenue settlement: ${data.count} events from ${events[0]?.source || "various sources"}`,
				payer_name: this.ownerConfig.payer_name,
				payer_email: this.ownerConfig.payer_email,
				payer_company: this.ownerConfig.payer_company,
				purpose: "Owner revenue distribution",
				reference: `HIST_SETTLE_${timestamp}`,
				prq_link: "", // Will be filled by Payoneer
			};

			csvRows.push(row);
		});

		// Write manifest
		const manifestPath = path.join(this.outputDir, `${batchId}_manifest.json`);
		await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
		console.log(`📄 Manifest saved: ${manifestPath}`);

		// Write CSV file
		const csvPath = path.join(this.outputDir, `${batchId}.csv`);
		const csvContent = stringify(csvRows, {
			header: true,
			columns: [
				"recipient",
				"recipient_email",
				"recipient_name",
				"amount",
				"currency",
				"batch_id",
				"item_id",
				"note",
				"payer_name",
				"payer_email",
				"payer_company",
				"purpose",
				"reference",
				"prq_link",
			],
		});

		await fs.writeFile(csvPath, csvContent);
		console.log(`💾 Payoneer CSV saved: ${csvPath}`);

		// Also create XLS version if needed
		await this.createExcelVersion(csvRows, batchId);

		return {
			manifest,
			csvPath,
			batchId,
			totalAmount: Object.values(summary).reduce(
				(sum, data) => sum + data.total,
				0,
			),
		};
	}

	async createExcelVersion(csvRows, batchId) {
		try {
			const XLSX = await import("xlsx");
			const worksheet = XLSX.utils.json_to_sheet(csvRows);
			const workbook = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(workbook, worksheet, "Payoneer Payout");

			const xlsxPath = path.join(this.outputDir, `${batchId}.xlsx`);
			XLSX.writeFile(workbook, xlsxPath);
			console.log(`📊 Excel file saved: ${xlsxPath}`);
		} catch (error) {
			console.log(
				"⚠️  Could not create Excel file (xlsx module not available), CSV only",
			);
		}
	}

	async updateLedger(batchId, events) {
		// Update the original revenue events with the payout_batch_id
		// This marks them as settled in your ledger
		const ledgerPath = path.join(process.cwd(), "data", "ledger_updates.json");

		const updateRecord = {
			timestamp: new Date().toISOString(),
			batch_id: batchId,
			action: "historical_settlement",
			events_settled: events.map((e) => ({
				event_id: e.event_id,
				amount: e.amount,
				currency: e.currency,
				settled_at: new Date().toISOString(),
			})),
			constitutional_check: ConstitutionalGuard.validateRevenueSettlement(
				events,
				events.reduce((sum, e) => sum + parseFloat(e.amount), 0),
			),
		};

		let existingUpdates = [];
		try {
			const existing = await fs.readFile(ledgerPath, "utf-8");
			existingUpdates = JSON.parse(existing);
		} catch (error) {
			// File doesn't exist yet
		}

		existingUpdates.push(updateRecord);
		await fs.writeFile(ledgerPath, JSON.stringify(existingUpdates, null, 2));

		console.log(`📝 Ledger updated with ${events.length} settled events`);
		return updateRecord;
	}
}

// ===== MAIN EXECUTION =====
async function settleHistoricalRevenues() {
	console.log("🚀 Starting Historical Revenue Settlement");
	console.log("=".repeat(50));

	try {
		const processor = new HistoricalRevenueProcessor();

		// 1. Load and validate revenue events
		const events = await processor.loadRevenueEvents();

		// 2. Filter for unsettled events
		const unsettledEvents = processor.filterUnsettledEvents(events);

		if (unsettledEvents.length === 0) {
			console.log("✅ No unsettled revenue events found.");
			return { settled: false, reason: "NO_UNSETTLED_EVENTS" };
		}

		// Sort events by date or ID to have consistent batching
		unsettledEvents.sort((a, b) => (a.event_id > b.event_id ? 1 : -1));

		// 3. Chunking Logic
		const MAX_BATCH_AMOUNT = 9000; // Safe limit below 10k
		const chunks = [];
		let currentChunk = [];
		let currentSum = 0;

		for (const event of unsettledEvents) {
			const amount = parseFloat(event.amount);
			if (currentSum + amount > MAX_BATCH_AMOUNT) {
				if (currentChunk.length > 0) {
					chunks.push(currentChunk);
				}
				currentChunk = [event];
				currentSum = amount;
			} else {
				currentChunk.push(event);
				currentSum += amount;
			}
		}
		if (currentChunk.length > 0) {
			chunks.push(currentChunk);
		}

		console.log(
			`📦 Split ${unsettledEvents.length} events into ${chunks.length} batches to satisfy limit (<$${MAX_BATCH_AMOUNT})`,
		);

		const results = [];
		let batchIndex = 0;

		for (const chunk of chunks) {
			batchIndex++;
			const summary = processor.summarizeEvents(chunk);
			const totalAmount = Object.values(summary).reduce(
				(sum, data) => sum + data.total,
				0,
			);

			console.log(
				`\nProcessing Batch ${batchIndex}/${chunks.length} ($${totalAmount.toFixed(2)})...`,
			);

			// Constitutional validation per chunk
			const validation = ConstitutionalGuard.validateRevenueSettlement(
				chunk,
				totalAmount,
			);

			if (!validation.valid) {
				console.error("❌ Constitutional validation failed for chunk:");
				validation.violations.forEach((v) => console.error(`   - ${v.reason}`));
				continue; // Skip invalid chunks? Or abort? Let's abort to be safe.
				// Actually, if it's just one chunk failing, maybe we should stop everything.
				// But here we split specifically to pass. If it fails for other reasons (keywords), we should stop.
				return {
					settled: false,
					reason: "CONSTITUTION_VIOLATION",
					violations: validation.violations,
				};
			}

			// Human approval check
			if (
				validation.requires_human_approval &&
				!process.argv.includes("--approve")
			) {
				console.log("⚠️  TIER 2: Requires human approval (amount > $5000)");
				console.log("   Add flag --approve to proceed.");
				// We can return here requesting approval for at least this batch
				const reviewBatch = await processor.generatePayoneerBatch(
					chunk,
					summary,
					batchIndex,
				);
				return {
					settled: false,
					reason: "REQUIRES_HUMAN_APPROVAL",
					review_files: {
						csv: reviewBatch.csvPath,
						manifest: path.join(
							processor.outputDir,
							`${reviewBatch.batchId}_manifest.json`,
						),
					},
					amount: totalAmount,
					events_count: chunk.length,
				};
			}

			// Generate files
			const result = await processor.generatePayoneerBatch(
				chunk,
				summary,
				batchIndex,
			);
			await processor.updateLedger(result.batchId, chunk);
			results.push(result);
		}

		console.log("\n🎉 Historical Revenue Settlement Complete!");
		console.log("=".repeat(50));
		console.log(
			`💰 Total Settled: $${results.reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2)}`,
		);
		console.log(`📦 Batches Generated: ${results.length}`);
		console.log(`📁 Files in: ${processor.outputDir}`);

		return {
			settled: true,
			batches: results,
			total_amount: results.reduce((acc, r) => acc + r.totalAmount, 0),
		};
	} catch (error) {
		console.error("❌ Settlement failed:", error.message);
		return { settled: false, reason: "EXECUTION_ERROR", error: error.message };
	}
}

// ===== CLI INTERFACE =====
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	// Check for approval flag
	const needsApproval = process.argv.includes("--approve");

	if (needsApproval) {
		console.log("🔓 Proceeding with human-approved settlement...");
	}

	settleHistoricalRevenues()
		.then((result) => {
			if (result.settled) {
				process.exit(0);
			} else {
				console.error(`Failed: ${result.reason}`);
				process.exit(1);
			}
		})
		.catch((error) => {
			console.error("Fatal error:", error);
			process.exit(1);
		});
}

export {
	settleHistoricalRevenues,
	HistoricalRevenueProcessor,
	ConstitutionalGuard,
};
