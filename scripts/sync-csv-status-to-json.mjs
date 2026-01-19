import fs from 'fs';
import path from 'path';

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

const csvPath = path.resolve('RevenueEvent_export (1).materialized.csv');
const jsonPath = path.resolve('data/base44_export/RevenueEvent.json');

console.log("Reading CSV...");
const csvContent = fs.readFileSync(csvPath, 'utf8');
const lines = csvContent.split(/\r?\n/).filter(l => l.trim().length > 0);

const header = parseCsvLine(lines[0]);
const idIdx = header.indexOf('event_id');
const statusIdx = header.indexOf('status');

if (idIdx === -1 || statusIdx === -1) {
    console.error("Missing columns in CSV");
    process.exit(1);
}

const csvStatusMap = new Map();
for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const id = row[idIdx];
    const status = row[statusIdx];
    if (id && status) {
        csvStatusMap.set(id, status);
    }
}

console.log("Reading JSON...");
const events = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

let updatedCount = 0;
events.forEach(e => {
    if (csvStatusMap.has(e.event_id)) {
        const newStatus = csvStatusMap.get(e.event_id);
        if (e.status !== newStatus && newStatus === 'earned') {
            // Only update if upgrading to earned, or if it matches source of truth
            e.status = newStatus;
            updatedCount++;
        }
    }
});

if (updatedCount > 0) {
    console.log(`Updating ${updatedCount} events to 'earned' in JSON...`);
    fs.writeFileSync(jsonPath, JSON.stringify(events, null, 2));
} else {
    console.log("No status updates needed.");
}
