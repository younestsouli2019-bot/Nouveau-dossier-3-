// Comprehensive procurement diagnostics for ALL payout rails.
// Tests each rail's credentials and reports clear status + remediation.

function masked(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length <= 8) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 4)}...${s.slice(-4)} (len=${s.length})`;
}

async function safeJsonFetch(url, opts = {}, timeoutMs = 8000) {
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

function basicAuth(id, sec) {
  return "Basic " + Buffer.from(`${id}:${sec}`).toString("base64");
}

function checkPayPal() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_CLIENT_SECRET;
  const live = String(process.env.SWARM_LIVE || "true").toLowerCase() === "true";
  const base = live
    ? (String(process.env.PAYPAL_MODE || "live").toLowerCase() === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com")
    : (process.env.PAYPAL_API_BASE_URL || "https://api-m.paypal.com");
  const out = { rail: "PAYPAL", creds: {}, verdict: null };
  out.creds = {
    client_id: masked(id),
    client_secret: masked(sec),
    api_base: base,
    live_mode: live,
    mode: process.env.PAYPAL_MODE || "live",
    disabled: String(process.env.PAYPAL_DISABLED || "false").toLowerCase() === "true",
  };
  if (!id || !sec) {
    out.verdict = "MISSING_CREDS";
    out.fix = "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in GitHub secrets";
    return out;
  }
  out.verdict = "CREDS_PRESENT";
  out.detail = "PayPal creds present. Runtime test (auth) is performed by paypal-cred-test.mjs.";
  return out;
}

function checkPlaid() {
  const out = { rail: "PLAID", creds: {}, verdict: null };
  out.creds = {
    client_id: masked(process.env.PLAID_CLIENT_ID),
    secret: masked(process.env.PLAID_SECRET),
    env: process.env.PLAID_ENV,
    access_token: masked(process.env.PLAID_OWNER_ACCESS_TOKEN),
  };
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    out.verdict = "MISSING_CREDS";
    out.fix = "Set PLAID_CLIENT_ID and PLAID_SECRET in GitHub secrets";
  } else if (!process.env.PLAID_OWNER_ACCESS_TOKEN) {
    out.verdict = "MISSING_ACCESS_TOKEN";
    out.fix = "Set PLAID_OWNER_ACCESS_TOKEN. Run Plaid Link flow to obtain it.";
  } else {
    out.verdict = "CREDS_PRESENT";
  }
  return out;
}

function checkPayoneer() {
  const out = { rail: "PAYONEER", creds: {}, verdict: null };
  out.creds = {
    api_base: process.env.PAYONEER_API_BASE,
    client_id: masked(process.env.PAYONEER_CLIENT_ID),
    client_secret: masked(process.env.PAYONEER_CLIENT_SECRET),
    program_id: process.env.PAYONEER_PROGRAM_ID,
    owner_id: process.env.PAYONEER_OWNER_ID,
  };
  const required = ["PAYONEER_API_BASE", "PAYONEER_CLIENT_ID", "PAYONEER_CLIENT_SECRET", "PAYONEER_PROGRAM_ID", "PAYONEER_OWNER_ID"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    out.verdict = "MISSING_CREDS";
    out.detail = `Missing: ${missing.join(", ")}`;
    out.fix = "Register at https://developer.payoneer.com/";
  } else {
    out.verdict = "CREDS_PRESENT";
  }
  return out;
}

function checkBankingCircle() {
  const out = { rail: "BANKING_CIRCLE", creds: {}, verdict: null };
  out.creds = {
    api_base: process.env.BANKING_CIRCLE_API_BASE || "https://api-sandbox.bankingcircle.com",
    env: process.env.BANKING_CIRCLE_ENV || "sandbox",
    client_id: masked(process.env.BANKING_CIRCLE_CLIENT_ID),
    client_secret: masked(process.env.BANKING_CIRCLE_CLIENT_SECRET),
    account_id: masked(process.env.BANKING_CIRCLE_ACCOUNT_ID),
    beneficiary_id: masked(process.env.BANKING_CIRCLE_BENEFICIARY_ID),
    fx_pair: process.env.BANKING_CIRCLE_FX_PAIR || "EUR/MAD",
  };
  if (!process.env.BANKING_CIRCLE_CLIENT_ID || !process.env.BANKING_CIRCLE_CLIENT_SECRET) {
    out.verdict = "MISSING_CREDS";
    out.detail = "Banking Circle S.A. (Luxembourg) account + API access required.";
    out.fix = "Apply at https://www.bankingcircle.com/contact/ — 2-4 weeks for account, 1 week for API access";
    out.use_case = "Automated EUR->MAD wires with 24/7 FX booking via API";
    out.application_url = "https://www.bankingcircle.com/contact/";
    out.docs_url = "https://developer.bankingcircle.com/";
    out.expected_secrets = ["BANKING_CIRCLE_CLIENT_ID", "BANKING_CIRCLE_CLIENT_SECRET", "BANKING_CIRCLE_ACCOUNT_ID", "BANKING_CIRCLE_BENEFICIARY_ID"];
  } else {
    out.verdict = "CREDS_PRESENT";
  }
  return out;
}

function checkCrypto() {
  const out = { rail: "CRYPTO", creds: {}, verdict: null };
  out.creds = {
    mode: process.env.CRYPTO_MODE,
    network: process.env.CRYPTO_NETWORK,
    wallet_address: masked(process.env.TRUST_WALLET_ADDRESS),
    private_key: process.env.TRUST_WALLET_PRIVATE_KEY ? "***SET***" : "NOT_SET",
  };
  if (!process.env.TRUST_WALLET_ADDRESS) {
    out.verdict = "MISSING_WALLET";
  } else if (!process.env.TRUST_WALLET_PRIVATE_KEY) {
    out.verdict = "MISSING_PRIVATE_KEY";
  } else {
    out.verdict = "CREDS_PRESENT";
  }
  return out;
}

function checkWise() {
  const out = { rail: "WISE", creds: {}, verdict: null };
  out.creds = {
    api_token: masked(process.env.WISE_API_TOKEN),
    profile_id: process.env.WISE_PROFILE_ID,
  };
  if (!process.env.WISE_API_TOKEN) {
    out.verdict = "MISSING_CREDS";
    out.fix = "Get WISE_API_TOKEN at https://wise.com/developers";
  } else {
    out.verdict = "CREDS_PRESENT";
  }
  return out;
}

function checkBankWire() {
  const out = { rail: "BANK_WIRE", creds: {}, verdict: null };
  out.creds = {
    bank_name: process.env.OWNER_BANK_NAME,
    bank_rib: masked(process.env.OWNER_BANK_RIB),
    iban: masked(process.env.OWNER_IBAN),
    swift: process.env.OWNER_SWIFT,
    beneficiary: process.env.OWNER_BENEFICIARY_NAME,
  };
  if (!process.env.OWNER_BENEFICIARY_NAME) {
    out.verdict = "MISSING_BENEFICIARY";
  } else if (!process.env.OWNER_IBAN && !process.env.OWNER_BANK_RIB) {
    out.verdict = "MISSING_ACCOUNT";
  } else {
    out.verdict = "HEALTHY";
  }
  return out;
}

function checkStripe() {
  const out = { rail: "STRIPE", creds: {}, verdict: null };
  out.creds = { secret_key: masked(process.env.STRIPE_SECRET_KEY) };
  out.verdict = !process.env.STRIPE_SECRET_KEY ? "NOT_CONFIGURED" : "CREDS_PRESENT";
  return out;
}

function checkRevolut() {
  const out = { rail: "REVOLUT", creds: {}, verdict: null };
  out.creds = { api_key: masked(process.env.REVOLUT_API_KEY) };
  out.verdict = !process.env.REVOLUT_API_KEY ? "NOT_CONFIGURED" : "CREDS_PRESENT";
  return out;
}

async function main() {
  console.log("[procurement] starting comprehensive rail diagnostics");
  const results = [];
  results.push(checkPayPal());
  results.push(checkPlaid());
  results.push(checkPayoneer());
  results.push(checkBankingCircle());
  results.push(checkCrypto());
  results.push(checkWise());
  results.push(checkBankWire());
  results.push(checkStripe());
  results.push(checkRevolut());

  const healthy = results.filter((r) => r.verdict === "HEALTHY" || r.verdict === "CREDS_PRESENT");
  const broken = results.filter((r) => r.verdict !== "HEALTHY" && r.verdict !== "CREDS_PRESENT" && r.verdict !== "NOT_CONFIGURED");

  const summary = {
    timestamp: new Date().toISOString(),
    total_rails: results.length,
    healthy: healthy.map((r) => r.rail),
    broken: broken.map((r) => ({ rail: r.rail, verdict: r.verdict, fix: r.fix })),
    results,
  };
  console.log("PROCUREMENT_REPORT:");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[procurement] HEALTHY: ${healthy.map((r) => r.rail).join(", ") || "(none)"}`);
  console.log(`[procurement] BROKEN: ${broken.map((r) => `${r.rail}=${r.verdict}`).join(", ") || "(none)"}`);

  if (broken.length > 0) {
    console.log("[procurement] REMEDIATION_NEEDED:");
    for (const r of broken) {
      console.log(`  - ${r.rail} [${r.verdict}]: ${r.fix}`);
    }
  }
}

main().catch((e) => {
  console.error("[procurement] FATAL", e);
  process.exit(1);
});
