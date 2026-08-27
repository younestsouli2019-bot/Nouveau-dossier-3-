import "dotenv/config";
import { Client } from "pg";
import { createHash } from "crypto";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

/**
 * PaymentIntent Ledger + Reconciliation (persistent, Postgres-backed)
 *
 * Replaces the ephemeral in-memory Layer-7 ledger for OUTBOUND payout
 * lifecycle tracking. Uses the canonical PaymentIntent table with the
 * state machine:
 *
 *   PENDING_REASONING → AUTHORIZED → EXECUTING → SETTLED → RECONCILED
 *   PENDING_REASONING → DENIED
 *
 * HONESTY RULE: every PaymentIntent is created in PENDING_REASONING with
 * NO receipt hash and NO fabricated confirmation. It only represents the
 * INTENT to pay — it does not claim money moved. Settlement (SETTLED) is
 * only reachable after a real rail confirmation is supplied via
 * confirmIntent() with an external providerRef/receipt.
 *
 * Idempotent: idempotencyKey is UNIQUE, so re-running never duplicates.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "data", "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

export class PaymentIntentLedger {
  constructor({ connectionString = process.env.DATABASE_URL } = {}) {
    this.client = new Client({ connectionString });
  }
  async connect() { await this.client.connect(); }
  async close() { await this.client.end(); }

  makeIdempotencyKey(kind, ref) {
    return createHash("sha256").update(`${kind}|${ref}`).digest("hex").slice(0, 40);
  }

  async ensureBankAccount({ label, accountType, provider, currency }) {
    const existing = await this.client.query(
      `SELECT id FROM "BankAccount" WHERE label=$1 LIMIT 1`,
      [label]
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const r = await this.client.query(
      `INSERT INTO "BankAccount" (id,label,"accountType","accountNumber",balance,currency,"isActive","isPrimary",provider,metadata,"createdAt","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,true,true,$6,'{}',now(),now()) RETURNING id`,
      [label, accountType, null, 0, currency, provider]
    );
    return r.rows[0].id;
  }

  /**
   * Create (or find existing) a PaymentIntent in PENDING_REASONING.
   * Never fabricates settlement. Idempotent by idempotencyKey.
   */
  async createIntent({
    idempotencyKey,
    amount,
    currency = "USD",
    direction = "outbound",
    destination,
    source = null,
    description = null,
    bankAccountId,
  }) {
    if (!Array.isArray(currency)) currency = String(currency);
    const existing = await this.client.query(
      `SELECT * FROM "PaymentIntent" WHERE "idempotencyKey"=$1`, [idempotencyKey]
    );
    if (existing.rows[0]) return { created: false, intent: existing.rows[0] };
    const r = await this.client.query(
      `INSERT INTO "PaymentIntent"
         (id,"bankAccountId","idempotencyKey",amount,currency,direction,status,destination,source,description,
          "approvedBy","approvedAt","executedAt","settledAt","reconciledAt","createdAt","updatedAt")
       VALUES
         (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL,NULL,NULL,now(),now())
       RETURNING *`,
      [bankAccountId, idempotencyKey, amount, currency, direction, "PENDING_REASONING", destination, source, description]
    );
    return { created: true, intent: r.rows[0] };
  }

  async listIntents(status = null) {
    const where = status ? `WHERE status=$1` : "";
    const params = status ? [status] : [];
    const r = await this.client.query(
      `SELECT * FROM "PaymentIntent" ${where} ORDER BY "createdAt" DESC`, params
    );
    return r.rows;
  }

  /**
   * Advance a PENDING_REASONING intent to AUTHORIZED (after owner/MFA
   * approval) — still requires live rail confirmation before SETTLED.
   */
  async authorize(intentId, approvedBy) {
    return this.client.query(
      `UPDATE "PaymentIntent" SET status='AUTHORIZED',"approvedBy"=$2,"approvedAt"=now(),"updatedAt"=now() WHERE id=$1 AND status='PENDING_REASONING'`, [intentId, approvedBy]
    );
  }

  /**
   * Confirmation of REAL external proof — the ONLY path to SETTLED.
   * Creates a WireExecutionLog with the provider ref + proof hash.
   * Fails closed if no providerRef or proof is supplied.
   */
  async confirmIntent({ intentId, channel, providerRef, proofHash, feeAmount = 0, netAmount = null, metadata = null }) {
    if (!providerRef || !proofHash) {
      throw new Error("confirmIntent requires providerRef AND proofHash (real external proof)");
    }
    const u = await this.client.query(
      `UPDATE "PaymentIntent" SET status='SETTLED',"settledAt"=now(),"updatedAt"=now()
       WHERE id=$1 AND status IN ('AUTHORIZED','EXECUTING','PENDING_REASONING') RETURNING *`, [intentId]
    );
    if (!u.rows[0]) return { ok: false, error: `intent ${intentId} not found or not in deployable state` };
    const intent = u.rows[0];
    await this.client.query(
      `INSERT INTO "WireExecutionLog"
        (id,"paymentIntentId",channel,status,"providerRef","proofHash","feeAmount","netAmount",metadata,"submittedAt","confirmedAt","createdAt")
       VALUES
        (gen_random_uuid(),$1,$2,'confirmed',$3,$4,$5,$6,$7,now(),now(),now())`,
      [intentId, channel, providerRef, proofHash, feeAmount, netAmount ?? intent.amount - feeAmount, metadata ? JSON.stringify(metadata) : null]
    );
    return { ok: true, intent };
  }

  /**
   * Reconcile SETTLED intents → RECONCILED when matched to a counterpart
   * (e.g. PayoutItem delivery confirmed with external ref).
   */
  async reconcile(intentId) {
    return this.client.query(
      `UPDATE "PaymentIntent" SET status='RECONCILED',"reconciledAt"=now(),"updatedAt"=now() WHERE id=$1 AND status='SETTLED'`, [intentId]
    );
  }
}

const USAGE = `
Build persistent PaymentIntent ledger from PayoutBatch/PayoutItem/PayoutBatch state.

  node scripts/payment-intent-ledger.mjs build      — create intents for all payout items (PENDING_REASONING)
  node scripts/payment-intent-ledger.mjs status     — print current intent counts by state
  node scripts/payment-intent-ledger.mjs reconcile  — reconcile output JSON to data/out/payment-intent-ledger.json
`;

async function main() {
  const cmd = process.argv[2] || "build";
  const ledger = new PaymentIntentLedger();
  await ledger.connect();
  try {
    const bankId = await ledger.ensureBankAccount({
      label: "Banking Circle — Primary",
      accountType: "bank_wire",
      provider: "banking_circle",
      currency: "USD",
    });

    if (cmd === "build") {
      const items = (await ledger.client.query(
        `SELECT * FROM "PayoutItem" WHERE "deliveryConfirmed"=false OR true ORDER BY "createdAt" ASC`
      )).rows;
      let created = 0, existed = 0;
      const skipped = [];
      for (const it of items) {
        const key = ledger.makeIdempotencyKey("payout_item", it.id);
        const res = await ledger.createIntent({
          idempotencyKey: key,
          amount: it.amount,
          currency: it.currency || "USD",
          direction: "outbound",
          destination: it.recipientEmail || it.recipientName,
          source: `PayoutItem:${it.id}`,
          description: `Outbound payout to ${it.recipientName} (batch ${it.batchNumber}, ${it.paymentMethod})`,
          bankAccountId: bankId,
        });
        if (res.created) created++; else existed++;
        if (!res.created) skipped.push(it.id);
      }
      console.log(`[payout-intent-ledger] created=${created} existed=${existed} bankAccountId=${bankId}`);
    } else if (cmd === "status") {
      const rows = await ledger.listIntents();
      const byState = {};
      for (const r of rows) byState[r.status] = (byState[r.status] || 0) + 1;
      const sum = rows.filter((r) => r.status === "PENDING_REASONING").reduce((a, r) => a + r.amount, 0);
      console.log(JSON.stringify({ total: rows.length, byState, pendingSumUsd: +sum.toFixed(2) }, null, 2));
    } else if (cmd === "reconcile") {
      const rows = await ledger.listIntents();
      const report = {
        generatedAt: new Date().toISOString(),
        bankAccountId: bankId,
        intentCount: rows.length,
        byState: {},
        pendingSumUsd: 0,
        intents: rows,
      };
      for (const r of rows) {
        report.byState[r.status] = (report.byState[r.status] || 0) + 1;
        if (r.status === "PENDING_REASONING") report.pendingSumUsd += r.amount;
      }
      report.pendingSumUsd = +report.pendingSumUsd.toFixed(2);
      writeFileSync(resolve(OUT, "payment-intent-ledger.json"), JSON.stringify(report, null, 2));
      console.log(`Wrote ${resolve(OUT, "payment-intent-ledger.json")}`);
    } else {
      console.log(USAGE);
    }
  } finally {
    await ledger.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
