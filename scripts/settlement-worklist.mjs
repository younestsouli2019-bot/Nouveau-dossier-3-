#!/usr/bin/env node
/**
 * settlement-worklist.mjs  (AUTONOMOUS · READ-ONLY · no money movement)
 *
 * Generates a structured worklist of all unsettled owner settlements, mapped
 * to the Attijari Wafa Bank IBAN, ready for operator execution through their
 * own mobile banking app. This replaces the dead API-based payout path with
 * a human-in-the-loop execution model that's honest and auditable.
 *
 *   node scripts/settlement-worklist.mjs
 *
 * Produces: data/out/settlement-worklist.json
 * Never moves money. Never fabricates proof.
 */
import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Owner bank details (pre-authed, real)
const OWNER_IBAN = 'MA59007810000448500030594182';
const OWNER_BANK = 'Attijari Wafa Bank';
const OWNER_NAME = 'Younes Souli';

// Known owner account labels (derived from earlier audit)
const ACCT_LABELS = {
  '01afb980-d04f-4e9a-87bb-e8caa25a516a': 'Younes Souli (primary)',
  'e6ce7a7c-b7cd-4f62-b8ed-c4aea9be3ab6': 'Younes Souli (salary)',
  'b8e59fe5-6ca8-45f5-ae10-23298b9300d7': 'Younes Souli (general)',
  '4ee28082-7b85-4290-b87f-0cc2d16e67f6': 'Younes Souli (vendor)',
  '3ac169ef-aefb-45ca-abc7-e87ff8fd5796': 'Younes Souli (crypto)',
};

try {
  await c.connect();

  // OwnerSettlements: all are needs_manual_proof (no API path succeeded)
  const settlements = (await c.query(
    `SELECT id, amount, status, "ownerAccountId", "sourceLabel", "destinationLabel",
            "externalRef", description, currency, direction, purpose
     FROM "OwnerSettlement"
     WHERE status = 'needs_manual_proof'
     ORDER BY amount DESC`
  )).rows;

  // RevenueEvents: the revenue side (what funds these settlements)
  const revenues = (await c.query(
    `SELECT id, source, amount, status, "proofHash", "proofType", currency
     FROM "RevenueEvent"
     WHERE status IN ('pending', 'PENDING_REASONING')
     ORDER BY amount DESC`
  )).rows;

  // PayoutBatches: the batch-level view
  const batches = (await c.query(
    `SELECT id, "batchNumber", "totalAmount", status, "paymentProvider", "providerBatchRef"
     FROM "PayoutBatch"
     WHERE status IN ('processing', 'needs_manual_proof')
     ORDER BY "totalAmount" DESC`
  )).rows;

  // Group settlements by owner account
  const byAccount = {};
  for (const s of settlements) {
    const acct = s.ownerAccountId || 'unknown';
    if (!byAccount[acct]) byAccount[acct] = { label: ACCT_LABELS[acct] || acct, entries: [], total: 0 };
    byAccount[acct].entries.push({
      id: s.id,
      amount: Number(s.amount),
      source: s.sourceLabel,
      destination: s.destinationLabel,
      purpose: s.purpose || s.description || s.sourceLabel,
      currency: s.currency || 'USD',
      externalRef: s.externalRef,
    });
    byAccount[acct].total += Number(s.amount);
  }

  // Build the worklist: each settlement is an "action item" for the operator
  const worklist = {
    at: new Date().toISOString(),
    engine: 'settlement-worklist',
    bank: { name: OWNER_BANK, iban: OWNER_IBAN, holder: OWNER_NAME },
    totalUnsettled: settlements.reduce((a, r) => a + Number(r.amount), 0),
    totalSettlements: settlements.length,
    totalRevenueUnsettled: revenues.reduce((a, r) => a + Number(r.amount), 0),
    totalBatchProcessing: batches.reduce((a, r) => a + Number(r.totalAmount), 0),
    accounts: byAccount,
    actions: settlements.map((s, i) => ({
      seq: i + 1,
      id: s.id,
      amount: Number(s.amount),
      currency: s.currency || 'USD',
      source: s.sourceLabel,
      purpose: s.purpose || s.description || s.sourceLabel,
      bankAction: `Transfer $${Number(s.amount).toFixed(2)} USD from Attijari Wafa Bank (${OWNER_IBAN}) to appropriate recipient`,
      status: 'needs_operator_action',
      note: 'Execute through Attijari mobile app. Record transaction ID when done.',
    })),
    batches: batches.map(b => ({
      batchNumber: b.batchNumber,
      totalAmount: Number(b.totalAmount),
      status: b.status,
      provider: b.paymentProvider,
      ref: b.providerBatchRef,
    })),
    revenueQueues: {
      pending: revenues.filter(r => r.status === 'pending'),
      pendingReasoning: revenues.filter(r => r.status === 'PENDING_REASONING'),
    },
    note: 'READ-ONLY worklist. Execute through Attijari mobile app. No API, no fabrication, no autonomous send.',
  };

  writeFileSync(resolve(OUT, 'settlement-worklist.json'), JSON.stringify(worklist, null, 2));
  console.log(JSON.stringify({
    ok: true,
    totalUnsettled: worklist.totalUnsettled,
    settlements: worklist.totalSettlements,
    revenuePending: worklist.totalRevenueUnsettled,
    batchesProcessing: worklist.totalBatchProcessing,
    accounts: Object.keys(byAccount).length,
  }, null, 2));
} finally {
  await c.end();
}
