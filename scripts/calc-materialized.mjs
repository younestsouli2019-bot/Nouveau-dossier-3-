import fs from 'fs';
import path from 'path';

// Using readCsv logic since we don't have a library
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

const file = path.resolve('RevenueEvent_export (1).materialized.csv');
const content = fs.readFileSync(file, 'utf8');
const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

if (lines.length < 2) {
    console.log("File is empty or only header.");
    process.exit(0);
}

const header = parseCsvLine(lines[0]);
const amountIdx = header.indexOf('amount');
const statusIdx = header.indexOf('status');

if (amountIdx === -1) {
    console.error("Column 'amount' not found.");
    process.exit(1);
}

let total = 0;
let count = 0;

for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    // The file name implies all are materialized, but let's be safe.
    // User asked for "total of 'materialized'".
    // If status column exists, we can check. 
    // The sample shows 'earned'. 'Materialized' might be the file concept, not the status value.
    // However, usually 'materialized' means 'real' vs 'projected'.
    // In Base44 context, 'earned', 'confirmed', 'cleared', 'paid_out' are all materialized stages.
    // 'projected' is not.
    
    // Let's sum everything in this file because the file name IS "materialized.csv".
    // But if there is a status column, we can print breakdown.
    
    const amount = parseFloat(row[amountIdx]);
    if (!isNaN(amount)) {
        total += amount;
        count++;
    }
}

console.log(`File: RevenueEvent_export (1).materialized.csv`);
console.log(`Total Rows: ${count}`);
console.log(`Total Amount: ${total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`);
