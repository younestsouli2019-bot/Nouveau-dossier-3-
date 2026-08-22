import fs from "fs";
import path from "path";

const batchPath = path.resolve("data/base44_export/PayoutBatch.json");
const batches = JSON.parse(fs.readFileSync(batchPath, "utf8"));

const submittedIds = [
	"PAYO_1768332305884",
	"PAYO_1768332322687",
	"PAYO_1768332356274",
];

let updatedCount = 0;
batches.forEach((b) => {
	if (submittedIds.includes(b.batch_id)) {
		if (b.status !== "submitted") {
			b.status = "submitted";
			b.submitted_at = new Date().toISOString();
			console.log(`Marking batch ${b.batch_id} as submitted.`);
			updatedCount++;
		}
	}
});

if (updatedCount > 0) {
	fs.writeFileSync(batchPath, JSON.stringify(batches, null, 2));
	console.log(`Updated ${updatedCount} batches.`);
} else {
	console.log("No batches needed updating.");
}
