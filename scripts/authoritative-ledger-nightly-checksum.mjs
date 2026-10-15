#!/usr/bin/env node
// S7-T04: Nightly zero-loss checksum. Compute rollingBalance = SUM(verified sales) - SUM(refunds) - SUM(payouts.completed).
// If abs(rollingBalance) > $0.15 USD -> emit system.ledger.checksum_mismatch authoritative event + exit=11 UNIQUE.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.cwd();

const LEDGER_PATH = process.env.AUTHORITATIVE_LEDGER_PATH || path.join(REPO, "data/out/authoritative-ledger.ndjson");
const TOLERANCE_CENTS = 15; // 15 cents = $0.15 USD per spec
let salesVerifiedCents = 0;
let refundsIssuedCents = 0;
let payoutsCompletedCents = 0;
let discovered = [];
function appendDiscrepancy(event) { discovered.push(event); }

if (!fs.existsSync(LEDGER_PATH)) {
  // If ledger does not exist yet — bootstrap first via verify-authoritative-ledger --plan-only
  console.log("[nightly-checksum] Ledger absent; no data = PASS (no pending balances). exit=0");
  process.exit(0);
}
const content = fs.readFileSync(LEDGER_PATH, "utf8");
if (!content.trim()) { console.log("[nightly-checksum] Empty ledger -> PASS (0). exit=0"); process.exit(0); }
const lines = content.split(/\r?\n/).filter(l=>l.trim().length>0);
for (const raw of lines) {
  try {
    const { event } = JSON.parse(raw);
    switch (event.type) {
      case "sales.payment.verified": {
        const c = Math.round(Number(event.payload?.amount_cents ?? 0));
        if (!isNaN(c) && c>0) salesVerifiedCents += c;
        break;
      }
      case "sales.refund.issued": {
        const c = Math.round(Number(event.payload?.amount_cents ?? 0));
        if (!isNaN(c) && c>0) refundsIssuedCents += c;
        break;
      }
      case "payout.completed": {
        const c = Math.round(Number(event.payload?.amount_cents ?? 0));
        if (!isNaN(c) && c>0) payoutsCompletedCents += c;
        break;
      }
      default: break;
    }
  } catch {}
}
const rollingBalanceCents = salesVerifiedCents - refundsIssuedCents - payoutsCompletedCents;
console.log(`[nightly-checksum] sales_verified=$${(salesVerifiedCents/100).toFixed(2)} refunds=$${(refundsIssuedCents/100).toFixed(2)} payouts_completed=$${(payoutsCompletedCents/100).toFixed(2)}`);
console.log(`[nightly-checksum] rollingBalance=$${(rollingBalanceCents/100).toFixed(2)} tolerance=$0.${TOLERANCE_CENTS.toString().padStart(2,'0')}`);
if (Math.abs(rollingBalanceCents) > TOLERANCE_CENTS) {
  // Append system.ledger.checksum_mismatch AUTHORITATIVE event via AuthoritativeLedger class
  // (minimal inlined append: just write a valid chained line using static chain key)
  try {
    const AuthoritativeLedgerMod = await import(path.join(REPO, "src/ledger/AuthoritativeLedger.ts").replace(/\\/g,"/"));
    const led = new AuthoritativeLedgerMod.AuthoritativeLedger({ filePath: LEDGER_PATH });
    led.append("system.ledger.checksum_mismatch", {
      rolling_balance_cents: rollingBalanceCents,
      tolerance_cents: TOLERANCE_CENTS,
      sales_verified_cents: salesVerifiedCents,
      refunds_issued_cents: refundsIssuedCents,
      payouts_completed_cents: payoutsCompletedCents,
      computed_at: new Date().toISOString(),
      note: `Nightly |rollingBalance|=$${(Math.abs(rollingBalanceCents)/100).toFixed(2)} exceeds $0.15 tolerance. Signataire MUST emit delta_cleared manual event with >=40 char reason.`
    });
  } catch (e) { console.log("[nightly-checksum] warn: TS append failed; TS compile step may be needed; rely on exit 11 alone:", e.message?.substring(0,180)); }
  console.log(`[nightly-checksum] FAIL: delta $${(Math.abs(rollingBalanceCents)/100).toFixed(2)} > tolerance $0.15 -> EXIT=11 UNIQUE. start-owner-hands-free S9 or CI will hard-block at gate until signataire clears.`);
  process.exit(11);
}
console.log(`[nightly-checksum] PASS: delta within ±$0.${TOLERANCE_CENTS.toString().padStart(2,'0')}. exit=0`);
process.exit(0);
