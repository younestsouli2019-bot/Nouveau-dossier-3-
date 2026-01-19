import fs from 'fs';
import path from 'path';

const revenuePath = path.resolve('data/base44_export/RevenueEvent.json');
const batchPath = path.resolve('data/base44_export/PayoutBatch.json');

const revenues = JSON.parse(fs.readFileSync(revenuePath, 'utf8'));
const batches = JSON.parse(fs.readFileSync(batchPath, 'utf8'));

// 1. Revenue Status Distribution
const statusCounts = {};
revenues.forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
});
console.log("Revenue Status Counts:", statusCounts);

// 2. Unbatched Confirmed Revenue
const readyRevenue = revenues.filter(r => 
    (r.status === 'confirmed' || r.status === 'cleared') && !r.payout_batch_id
);
console.log(`Unbatched Ready Revenue: ${readyRevenue.length}`);
if (readyRevenue.length > 0) {
    const total = readyRevenue.reduce((sum, r) => sum + r.amount, 0);
    console.log(`Total Unbatched Amount: ${total} ${readyRevenue[0].currency}`);
}

// 3. Inspect Pending Batch
const pendingBatch = batches.find(b => b.batch_id === 'PAYO_1768222857737');
if (pendingBatch) {
    console.log("\nPending Batch Details:");
    console.log(JSON.stringify(pendingBatch, null, 2));
} else {
    console.log("\nBatch PAYO_1768222857737 not found.");
}
