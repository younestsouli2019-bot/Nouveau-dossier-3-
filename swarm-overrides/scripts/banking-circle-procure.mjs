// Banking Circle procurement diagnostic + scaffolding.
// Verifies creds when present; documents the application path when missing.
// Targets: automated EUR→MAD wires via Banking Circle API.

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

async function safeJsonFetch(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { status: res.status, ok: res.ok, body: parsed || text.slice(0, 400) };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function checkBankingCircle() {
  const id = process.env.BANKING_CIRCLE_CLIENT_ID;
  const sec = process.env.BANKING_CIRCLE_CLIENT_SECRET;
  const env = (process.env.BANKING_CIRCLE_ENV || "sandbox").toLowerCase();
  // Banking Circle API: prod=https://api.bankingcircle.com, sandbox=https://api-sandbox.bankingcircle.com
  const base = process.env.BANKING_CIRCLE_API_BASE ||
    (env === "production" || env === "live"
      ? "https://api.bankingcircle.com"
      : "https://api-sandbox.bankingcircle.com");
  const out = { rail: "BANKING_CIRCLE", creds: {}, auth: null, verdict: null };
  out.creds = {
    client_id: masked(id),
    client_secret: masked(sec),
    api_base: base,
    env,
    account_id: masked(process.env.BANKING_CIRCLE_ACCOUNT_ID),
    beneficiary_id: masked(process.env.BANKING_CIRCLE_BENEFICIARY_ID),
    fx_quote_currency_pair: process.env.BANKING_CIRCLE_FX_PAIR || "EUR/MAD",
  };
  if (!id || !sec) {
    out.verdict = "MISSING_CREDS";
    out.detail = "BANKING_CIRCLE_CLIENT_ID and BANKING_CIRCLE_CLIENT_SECRET not set";
    out.application = {
      step_1: "Go to https://www.bankingcircle.com and click 'Contact us' to apply for a Banking Circle S.A. business account",
      step_2: "Complete KYC: company registration, beneficial owners, expected transaction volume, source of funds, purpose (cross-border EUR→MAD wires)",
      step_3: "Sign Master Service Agreement + Pricing Schedule (fees per transaction)",
      step_4: "Request API access (separate application for the developer portal + API credentials)",
      step_5: "Complete API technical onboarding (sandbox first, then production)",
      step_6: "Set GitHub secrets: BANKING_CIRCLE_CLIENT_ID, BANKING_CIRCLE_CLIENT_SECRET, BANKING_CIRCLE_ACCOUNT_ID, BANKING_CIRCLE_BENEFICIARY_ID",
      application_url: "https://www.bankingcircle.com/contact/",
      docs_url: "https://developer.bankingcircle.com/",
    };
    out.fix = "Apply at https://www.bankingcircle.com/contact/ — Luxembourg-regulated credit institution. Account is required before API creds.";
    out.expected_time = "2-4 weeks for account approval + 1 week for API access";
    return out;
  }
  // Test auth: get OAuth token
  const tokenUrl = `${base}/v1/auth/access_token`;
  const r = await safeJsonFetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });
  out.auth = { status: r.status, body: r.body || r.error };
  if (r.status === 200 && r.body?.access_token) {
    out.verdict = "HEALTHY";
    out.token_expires_in = r.body.expires_in;
  } else if (r.status === 401) {
    out.verdict = "INVALID_CREDS";
    out.fix = "Banking Circle rejected the credentials. Verify with the developer portal.";
  } else if (r.status === 400 && r.body?.error === "invalid_request") {
    out.verdict = "MALFORMED_REQUEST";
    out.fix = "Check client_id/secret format and api_base URL";
  } else {
    out.verdict = "UNKNOWN_ERROR";
  }
  return out;
}

async function main() {
  console.log("[banking-circle-procure] starting");
  const result = await checkBankingCircle();
  console.log("BANKING_CIRCLE_REPORT:");
  console.log(JSON.stringify(result, null, 2));
  if (result.verdict === "MISSING_CREDS") {
    console.log("\n[banking-circle-procure] APPLICATION REQUIRED");
    console.log("Visit: https://www.bankingcircle.com/contact/");
    console.log("API docs: https://developer.bankingcircle.com/");
    console.log("\nWhat Banking Circle gives us:");
    console.log("  - EUR Cross-border SWIFT (cut-off 16:00 CET)");
    console.log("  - EUR SEPA Instant (24/7)");
    console.log("  - EUR T2 RTGS (cut-off 16:15 CET)");
    console.log("  - FX trades 24/7 via API (EUR/MAD supported)");
    console.log("  - API for payments, beneficiaries, FX booking, balances");
    console.log("\nWorkflow after approval:");
    console.log("  1. Get sandbox creds -> test integration");
    console.log("  2. Get production creds -> switch BANKING_CIRCLE_ENV=production");
    console.log("  3. Set BANKING_CIRCLE_BENEFICIARY_ID for Attijari");
    console.log("  4. Set BANKING_CIRCLE_FX_PAIR=EUR/MAD");
    console.log("  5. Run banking-circle-execute.mjs to send EUR->MAD wires");
  } else if (result.verdict === "HEALTHY") {
    console.log("\n[banking-circle-procure] READY TO USE");
  } else {
    console.log(`\n[banking-circle-procure] VERDICT: ${result.verdict}`);
    console.log(`FIX: ${result.fix}`);
  }
}

main().catch((e) => {
  console.error("[banking-circle-procure] FATAL", e.message || e);
  process.exit(1);
});
