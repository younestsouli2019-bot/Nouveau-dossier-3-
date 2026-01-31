import fs from "fs";
import path from "path";

const revenuePath = path.resolve("data/base44_export/RevenueEvent.json");
const batchPath = path.resolve("data/base44_export/PayoutBatch.json");

const revenues = JSON.parse(fs.readFileSync(revenuePath, "utf8"));
const batches = JSON.parse(fs.readFileSync(batchPath, "utf8"));

console.log(`Total Revenue Events: ${revenues.length}`);
console.log(`Total Batches: ${batches.length}`);

// 1. Check for unbatched revenue
// Assuming revenue has a batch_id field or we need to look it up.
// Let's inspect one full revenue object to see fields.
// But based on previous context, usually revenue -> batch is via batch_id.

// 2. Check for batches that are approved but not submitted
const approvedBatches = batches.filter(
	(b) => b.status === "approved" || b.status === "pending_approval",
);
const submittedBatches = batches.filter((b) => b.status === "submitted");
const paidBatches = batches.filter((b) => b.status === "paid");

console.log(`Approved/Pending Batches: ${approvedBatches.length}`);
console.log(`Submitted Batches: ${submittedBatches.length}`);
console.log(`Paid Batches: ${paidBatches.length}`);

console.log("\n--- Approved/Pending Batches Details ---");
approvedBatches.forEach((b) => {
	console.log(
		`ID: ${b.batch_id} | Amount: ${b.total_amount} ${b.currency} | Status: ${b.status} | Created: ${b.created_at || "N/A"}`,
	);
});

// Check if any of these match the ones the user said are "already submitted"
// User mentioned: payoneer_payout_PAYO_1768332305884.xls
