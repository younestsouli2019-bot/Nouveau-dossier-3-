// Banking Circle EUR->MAD wire executor.
// Activated when BANKING_CIRCLE_CLIENT_ID and BANKING_CIRCLE_CLIENT_SECRET are set.
// Flow: 1) OAuth client_credentials -> access_token
//       2) POST /v1/payments with EUR amount + beneficiary
//       3) If EUR->MAD, optionally book FX trade first via /v1/fx/trades
//       4) Poll payment status until completed or failed

import { buildBase44ServiceClient } from "../src/base44-client.mjs";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function envFlag(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function masked(v, head = 4, tail = 4) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length <= head + tail) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, head)}...${s.slice(-tail)} (len=${s.length})`;
}

async function safeJsonFetch(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { status: res.status, ok: res.ok, body: parsed || text.slice(0, 600) };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function getAccessToken(base, id, sec) {
  const r = await safeJsonFetch(`${base}/v1/auth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });
  if (r.status !== 200 || !r.body?.access_token) {
    return { ok: false, error: `token_failed status=${r.status}`, detail: r.body };
  }
  return { ok: true, token: r.body.access_token, expires_in: r.body.expires_in };
}

async function main() {
  console.log("[banking-circle-execute] starting");
  const id = process.env.BANKING_CIRCLE_CLIENT_ID;
  const sec = process.env.BANKING_CIRCLE_CLIENT_SECRET;
  if (!id || !sec) {
    console.log("[banking-circle-execute] MISSING_CREDS");
    console.log("[banking-circle-execute] Apply at https://www.bankingcircle.com/contact/ and set BANKING_CIRCLE_CLIENT_ID + BANKING_CIRCLE_CLIENT_SECRET");
    process.exit(1);
  }
  const env = (process.env.BANKING_CIRCLE_ENV || "sandbox").toLowerCase();
  const base = process.env.BANKING_CIRCLE_API_BASE ||
    (env === "production" || env === "live"
      ? "https://api.bankingcircle.com"
      : "https://api-sandbox.bankingcircle.com");
  const accountId = process.env.BANKING_CIRCLE_ACCOUNT_ID;
  const beneficiaryId = process.env.BANKING_CIRCLE_BENEFICIARY_ID;
  const fxPair = process.env.BANKING_CIRCLE_FX_PAIR || "EUR/MAD";

  console.log(`[banking-circle-execute] env=${env} base=${base} account=${masked(accountId)} beneficiary=${masked(beneficiaryId)} fx_pair=${fxPair}`);

  const tok = await getAccessToken(base, id, sec);
  if (!tok.ok) {
    console.log(`[banking-circle-execute] TOKEN_ERROR: ${tok.error} ${JSON.stringify(tok.detail).slice(0, 200)}`);
    process.exit(2);
  }
  console.log(`[banking-circle-execute] got access_token (expires_in=${tok.expires_in})`);

  // Fetch owner Attijari destination
  const dest = {
    beneficiary_name: process.env.OWNER_BENEFICIARY_NAME || "M TSOULI YOUNES",
    bank_name: process.env.OWNER_BANK_NAME || "Attijariwafa Bank",
    rib: process.env.OWNER_BANK_RIB || process.env.OWNER_BANK_ACCOUNT || "007810000448500030594182",
    swift: process.env.OWNER_SWIFT || "BCMAMAMC",
    country: process.env.OWNER_BANK_COUNTRY || "MA",
  };

  // Read pending PayoutBatch (status=completed or pending) with rail=BANKING_CIRCLE
  let batchIds = [];
  let base44 = null;
  try {
    base44 = buildBase44ServiceClient();
    const pb = base44.asServiceRole.entities.PayoutBatch;
    const all = await pb.filter({}, "-created_date", 200, 0).catch(() => []);
    batchIds = all
      .filter((b) => {
        const r = String(b.rail || "");
        const bid = String(b.batch_id || "");
        return r === "BANKING_CIRCLE" || bid.startsWith("BATCH_BANKING_CIRCLE_");
      })
      .filter((b) => ["pending", "ready_to_send", "ready_for_wire"].includes(b.status))
      .map((b) => b.batch_id);
  } catch (e) {
    console.log(`[banking-circle-execute] base44 unavailable: ${e.message}`);
  }
  console.log(`[banking-circle-execute] pending BANKING_CIRCLE batches: ${batchIds.length}`);

  // Placeholder for the actual payment flow. Real API calls go here once creds are valid.
  // Each batch -> 1) get FX quote 2) accept quote 3) submit payment 4) poll status
  const outDir = "exports/banking_circle";
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `execute_${Date.now()}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    env,
    base_url: base,
    account_id_present: !!accountId,
    beneficiary_id_present: !!beneficiaryId,
    fx_pair: fxPair,
    destination: dest,
    pending_batches: batchIds,
    payments: [],
    note: "Scaffolding only. Real Banking Circle API calls (POST /v1/payments, /v1/fx/trades) require verified production credentials.",
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[banking-circle-execute] wrote report to ${reportPath}`);
  console.log("BANKING_CIRCLE_EXECUTE_SUMMARY:");
  console.log(JSON.stringify({
    timestamp: report.timestamp,
    token_obtained: true,
    pending_batches: batchIds.length,
    report_path: reportPath,
    next_step: "After creds verified, this script will: 1) accept FX quote EUR->MAD, 2) submit payment instruction, 3) poll until status=Completed, 4) mark PayoutBatch.status=completed, wire_status=submitted_to_bank",
  }, null, 2));
}

main().catch((e) => {
  console.error("[banking-circle-execute] FATAL", e.message || e);
  process.exit(1);
});
