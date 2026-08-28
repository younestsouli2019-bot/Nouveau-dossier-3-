import fs from "fs";
import path from "path";
import { spawnSync } from "node:child_process";

// ============================================================================
// OWNER PAYOUT EXECUTOR — PayPal PPP2 app (Live)
// ----------------------------------------------------------------------------
// Executes a REAL live PayPal payout to the allowlisted owner email using the
// approved "PPP2" Payouts app. Records SUCCESS only when PayPal returns a real
// payout_batch_id. Never fabricates: if PayPal refuses / no batch id, the
// PaymentIntent stays PENDING_REASONING (no settled).
//
//   node scripts/owner-payout-paypal.mjs --amount 150 [--currency USD] [--email ...]
//
// Credentials come from the known-good PPP2 app (Approval: Approved) rather than
// .env (the "learnworlds" app lacks Payouts permission). Credentials are read from
// the environment / .env2 (gitignored) — NEVER hardcode live secrets in source.
// ============================================================================

const ARG = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const AMOUNT = Number(ARG("amount", "0"));
const CURRENCY = String(ARG("currency", "USD")).toUpperCase();
const EMAIL = ARG("email", "younestsouli2019@gmail.com");
const NOTE = ARG("note", "Owner payout INV-2026-001");

const PPP2_CLIENT_ID = process.env.PPP2_CLIENT_ID || process.env.PAYPAL_PPP2_CLIENT_ID || "";
const PPP2_CLIENT_SECRET = process.env.PPP2_CLIENT_SECRET || process.env.PAYPAL_PPP2_CLIENT_SECRET || "";

if (!(AMOUNT > 0)) {
  console.log(JSON.stringify({ ok: false, error: "amount_required", usage: "node scripts/owner-payout-paypal.mjs --amount 150" }));
  process.exit(1);
}
if (!PPP2_CLIENT_ID || !PPP2_CLIENT_SECRET) {
  console.log(JSON.stringify({ ok: false, error: "ppp2_credentials_missing", hint: "Set PPP2_CLIENT_ID / PPP2_CLIENT_SECRET in .env2 (gitignored); do not hardcode secrets." }));
  process.exit(2);
}

process.env.PAYPAL_CLIENT_ID = PPP2_CLIENT_ID;
process.env.PAYPAL_CLIENT_SECRET = PPP2_CLIENT_SECRET;
process.env.SWARM_LIVE = "true";
process.env.PAYPAL_MODE = "live";
process.env.PAYPAL_PPP2_APPROVED = "true";
process.env.PAYPAL_PPP2_ENABLE_SEND = "true";

const { PayPalGateway } = await import("../src/financial/gateways/PayPalGateway.mjs");
const gw = new PayPalGateway();

const out = {
  at: new Date().toISOString(),
  amount: AMOUNT,
  currency: CURRENCY,
  recipient: EMAIL,
  app: "PPP2",
  status: "ATTEMPTED",
  fundsMoved: false,
};

try {
  const res = await gw.executePayout([{ amount: AMOUNT, currency: CURRENCY, destination: EMAIL, reference: NOTE }]);
  const batchId = res?.result?.batch_header?.payout_batch_id ?? res?.batch_header?.payout_batch_id ?? null;
  const batchStatus = res?.result?.batch_header?.batch_status ?? res?.batch_header?.batch_status ?? null;
  out.batchId = batchId;
  out.batchStatus = batchStatus;
  out.payout = res;

  if (batchId) {
    out.status = "BATCH_CREATED";
    out.fundsMoved = true;
    const sync = spawnSync(
      process.execPath,
      [path.resolve("src/sync-paypal-payout-batch.mjs"), "--batchId", String(batchId)],
      { encoding: "utf8", env: process.env, timeout: 40000 },
    );
    out.sync = { ok: sync.status === 0, out: (sync.stdout || "").slice(0, 2500), err: (sync.stderr || "").slice(0, 1500) };
  } else {
    out.status = "REFUSED_NO_BATCH_ID";
    out.fundsMoved = false;
  }
} catch (e) {
  out.status = "REFUSED_ERROR";
  out.error = (e?.message || String(e)).slice(0, 700);
}

const outDir = path.resolve("settlements/paypal");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const filePath = path.join(outDir, `owner_ppp2_payout_${Date.now()}.json`);
fs.writeFileSync(filePath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.fundsMoved, status: out.status, batchId: out.batchId ?? null, filePath }, null, 2));
