import fs from "fs";
import path from "path";

// PRQ Links provided by user
const prqLinks = [
	"https://link.payoneer.com/Token?t=85E519D6DF0F4F999BC1350B37663795&src=prqLink",
	"https://link.payoneer.com/Token?t=F5BE5A433265427C82ADE11B26453D8B&src=prqLink",
	"https://link.payoneer.com/Token?t=CB64CB35E8884E8EB2F29CC1A88AF643&src=prqLink",
	"https://link.payoneer.com/Token?t=20CF6CF2E346465C8C1374799EB46548&src=prqLink",
	"https://link.payoneer.com/Token?t=5320FD2780B540E9A0A17228148D5FFC&src=prqLink",
];

// Map PRQ links to the recently generated historical batches
// We have 5 batches: _1, _2, _3, _4, _5
// We will iterate through the manifests and inject the PRQ link into the CSV and Manifest

const historicalDir = path.resolve("settlements/payoneer/historical");

try {
	const files = fs.readdirSync(historicalDir);
	const manifests = files.filter((f) => f.endsWith("_manifest.json"));

	// Sort manifests to match the order of batches 1-5
	manifests.sort((a, b) => {
		const numA = parseInt(a.match(/_(\d+)_manifest\.json$/)[1]);
		const numB = parseInt(b.match(/_(\d+)_manifest\.json$/)[1]);
		return numA - numB;
	});

	console.log(
		`Found ${manifests.length} manifests for ${prqLinks.length} PRQ links.`,
	);

	manifests.forEach((manifestFile, index) => {
		if (index >= prqLinks.length) return; // Should match exactly 5

		const prqLink = prqLinks[index];
		const manifestPath = path.join(historicalDir, manifestFile);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

		// 1. Update Manifest
		manifest.settlement_batch.prq_link = prqLink;
		manifest.settlement_batch.status = "submitted"; // Mark as submitted since we have the link
		manifest.settlement_batch.submitted_at = new Date().toISOString();

		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
		console.log(`Updated Manifest: ${manifestFile}`);

		// 2. Update CSV
		const csvFile = manifestFile.replace("_manifest.json", ".csv");
		const csvPath = path.join(historicalDir, csvFile);
		if (fs.existsSync(csvPath)) {
			let csvContent = fs.readFileSync(csvPath, "utf8");
			// The CSV header has 'prq_link' at the end.
			// The rows have an empty value at the end.
			// We need to replace the last empty value or append the link if missing.

			const lines = csvContent.split("\n");
			const header = lines[0];
			const newLines = [header];

			for (let i = 1; i < lines.length; i++) {
				const line = lines[i].trim();
				if (!line) continue;

				// Assuming standard CSV with comma separation
				// We want to replace the last empty field or append
				// Our generator puts prq_link as the last column.
				// It wrote: ...,purpose,reference,prq_link
				// Row: ...,Owner revenue distribution,HIST_SETTLE_...,""

				// Regex to replace last empty quoted string "" or empty comma ,
				// Safer to just reconstruct the line if we know the structure?
				// Or simply append if it ends with ,

				let newLine = line;
				if (line.endsWith(",")) {
					newLine = line + `"${prqLink}"`;
				} else if (line.endsWith('""')) {
					newLine = line.substring(0, line.length - 2) + `"${prqLink}"`;
				} else {
					// Fallback, maybe it wasn't empty?
					// Let's assume the generator left it empty.
					// Replace last comma-delimited field
					const lastComma = line.lastIndexOf(",");
					newLine = line.substring(0, lastComma + 1) + `"${prqLink}"`;
				}
				newLines.push(newLine);
			}

			fs.writeFileSync(csvPath, newLines.join("\n"));
			console.log(`Updated CSV: ${csvFile}`);
		}
	});

	console.log(
		"Successfully attached PRQ links to historical settlement batches.",
	);
} catch (error) {
	console.error("Error updating files:", error);
}
