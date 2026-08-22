import fs from "node:fs";
import path from "node:path";

function loadPayoutBatches(filePath) {
	const fullPath = path.resolve(process.cwd(), filePath);
	const raw = fs.readFileSync(fullPath, "utf8");
	const data = JSON.parse(raw);
	return Array.isArray(data) ? data : [];
}

function hoursBetween(a, b) {
	const t1 = new Date(a).getTime();
	const t2 = new Date(b).getTime();
	if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
	return (t2 - t1) / (1000 * 60 * 60);
}

function main() {
	const args = process.argv.slice(2);
	const file = args[0] || "data/base44_export/PayoutBatch.json";
	const maxAgeHoursRaw = process.env.PAYOUT_HEALTH_MAX_HOURS || args[1] || "24";
	const maxAgeHours = Number(maxAgeHoursRaw) || 24;

	const batches = loadPayoutBatches(file);
	const nowIso = new Date().toISOString();

	const approvedNotSubmitted = [];
	const submittedStale = [];
	const missingApprovedBy = [];

	for (const b of batches) {
		const status = String(b.status || "").toLowerCase();
		const approvedBy = b.approved_by ?? b.approvedBy ?? null;
		const submittedAt = b.submitted_at || b.submittedAt || null;
		const completedAt = b.completed_at || b.completedAt || null;
		const created = b.created_date || b.createdAt || null;

		if (status === "approved" && !b.paypal_batch_id && !b.paypalBatchId) {
			approvedNotSubmitted.push(b);
		}

		if (status === "submitted_to_paypal" && !completedAt && submittedAt) {
			const age = hoursBetween(submittedAt, nowIso);
			if (age != null && age > maxAgeHours) submittedStale.push({ ...b, age });
		}

		if (status === "approved" && !approvedBy) {
			missingApprovedBy.push(b);
		}
	}

	function formatBatch(b) {
		return [
			b.batch_id || b.batchId,
			b.currency,
			b.total_amount,
			b.status,
			b.approved_by || b.approvedBy || "-",
		]
			.map((v) => String(v ?? "-"))
			.join(" | ");
	}

	console.log("=== Payout Pipeline Health Report ===");
	console.log("");

	console.log("Approved but not submitted_to_paypal:");
	if (approvedNotSubmitted.length === 0) {
		console.log("  none");
	} else {
		for (const b of approvedNotSubmitted) {
			console.log("  ", formatBatch(b));
		}
	}

	console.log("");
	console.log(
		`Submitted_to_paypal older than ${maxAgeHours}h without completed_at:`,
	);
	if (submittedStale.length === 0) {
		console.log("  none");
	} else {
		for (const b of submittedStale) {
			console.log("  ", formatBatch(b), "age_h=", b.age.toFixed(2));
		}
	}

	console.log("");
	console.log("Approved batches with missing approved_by:");
	if (missingApprovedBy.length === 0) {
		console.log("  none");
	} else {
		for (const b of missingApprovedBy) {
			console.log("  ", formatBatch(b));
		}
	}
}

main();
