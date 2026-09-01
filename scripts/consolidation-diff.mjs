import 'dotenv/config';
import { Client } from 'pg';
import fs from 'fs';

const OFFLINE = 'C:/Users/Dell/AppData/Local/Temp/opencode/swarm-tb/db/base44-offline-store.json';

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

const j = JSON.parse(fs.readFileSync(OFFLINE, 'utf8'));
const e = j.entities;

const report = {};

report.offlinePayoutBatches = e.PayoutBatch.map(b => ({
  batchId: b.batch_id, status: b.status, amount: b.total_amount, currency: b.currency,
  itemCount: b.item_count,
  reExtRef: (b.metadata && b.metadata.reconciliation_engine && b.metadata.reconciliation_engine.external_ref) || null,
  reRail: (b.metadata && b.metadata.reconciliation_engine && b.metadata.reconciliation_engine.rail) || null,
  proofHash: b.proof_hash, verifiedAt: b.verified_at, proofSource: b.proof_source,
}));

report.offlinePayoutItems = e.PayoutItem.map(i => ({
  itemId: i.item_id, batchId: i.batch_id, recipient: i.recipient, recipientType: i.recipient_type,
  amount: i.amount, currency: i.currency, status: i.status, externalTx: i.external_transaction_id,
  proofHash: i.proof_hash,
  state: (i.metadata && i.metadata.state_machine_state) || null,
  needsAuth: (i.metadata && i.metadata.requires_authorization) || false,
}));

report.offlineRevenueEvents = e.RevenueEvent.map(r => ({
  eventId: r.event_id, source: r.source, amount: r.amount, currency: r.currency, status: r.status,
}));

// DB current state (correct columns)
report.dbPayoutBatch = await q(`SELECT "batchNumber", status, "totalAmount", currency, "itemCount", "providerBatchRef", "proofHash", "proofType" FROM "PayoutBatch" ORDER BY "batchNumber"`);
report.dbPayoutItem = await q(`SELECT "batchNumber", "recipientName", "recipientEmail", amount, currency, status, "externalRef", "proofHash" FROM "PayoutItem" ORDER BY "createdAt"`);
report.dbRevenueEventCount = (await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount::numeric),0) AS total FROM "RevenueEvent"`))[0];

const dbSettlements = (await q(`SELECT "dataSource", status, COUNT(*)::int AS n FROM "OwnerSettlement" GROUP BY "dataSource", status`));
report.dbSettlements = dbSettlements;

console.log(JSON.stringify(report, null, 2));

await c.end();
