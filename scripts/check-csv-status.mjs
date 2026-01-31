import fs from "fs";
import path from "path";

function parseCsvLine(l) {
	const vals = [];
	let cur = "";
	let inQ = false;
	for (let i = 0; i < l.length; i++) {
		const ch = l[i];
		if (inQ) {
			if (ch === '"') {
				if (l[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					inQ = false;
				}
			} else {
				cur += ch;
			}
		} else {
			if (ch === ",") {
				vals.push(cur);
				cur = "";
			} else if (ch === '"') {
				inQ = true;
			} else {
				cur += ch;
			}
		}
	}
	vals.push(cur);
	return vals;
}

const file = path.resolve("RevenueEvent_export (1).materialized.csv");
const content = fs.readFileSync(file, "utf8");
const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

const header = parseCsvLine(lines[0]);
const statusIdx = header.indexOf("status");

const statusCounts = {};

for (let i = 1; i < lines.length; i++) {
	const row = parseCsvLine(lines[i]);
	const status = row[statusIdx];
	statusCounts[status] = (statusCounts[status] || 0) + 1;
}

console.log("CSV Status Counts:", statusCounts);
