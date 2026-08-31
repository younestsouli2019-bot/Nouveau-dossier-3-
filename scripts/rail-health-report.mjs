import "dotenv/config";
import fs from "fs";
import path from "path";

// ============================================================================
// HONEST RAIL-HEALTH REPORT
// ----------------------------------------------------------------------------
// Reconciles CONFIG-declared route status against MEASURED deliverability.
// The config-derived routes-status reports paypal/crypto as "open" purely from
// flags, but real send capability was probed and is far more restrictive.
// This report keeps the picture truthful: a rail is only "deliverable" when it
// both (a) is enabled by config AND (b) actually authenticates AND can move funds.
//
// Evidence basis (measured at 2026-08-28 by live API probes):
//   - PayPal `.env2`/PPP2 creds: valid token, payouts scope, BUT payout POST
//     -> 403 AUTHORIZATION_ERROR until account CIP/identity review clears.
//   - Binance (both key sets):  -2015 Invalid API-key/IP/permissions.
//   - Bitget:                    40018 Invalid IP 41.140.6.124 (key IP-locked).
//   - Bybit:                     auth OK but $0 balance.
//   - Wise `.env2` key:          invalid_token (401).
//   - Payoneer:                  no API client creds.
// Regenerate when credentials/clears change.
// ============================================================================

function flag(name) {
  return String(process.env[name] ?? "").trim().toLowerCase() === "true";
}

const measured = {
  paypal: {
    configOpen: flag("PAYPAL_PPP2_APPROVED") && flag("PAYPAL_PPP2_ENABLE_SEND") && !flag("PAYPAL_DISABLED"),
    authOk: false,
    canSend: false,
    reason: "Live OAuth probe 2026-08-31 -> 401 invalid_client (Client Authentication failed) against api-m.paypal.com. Credentials currently fail auth; Payouts scope NOT confirmed. C.I.P. status moot until creds authenticate.",
    measuredAt: "2026-08-31T12:48Z",
  },
  binance: { configOpen: flag("CRYPTO_WITHDRAW_ENABLE"), authOk: false, canSend: false, reason: "-2015 Invalid API-key/IP/permissions (both key sets).", measuredAt: "2026-08-28" },
  bitget: { configOpen: flag("CRYPTO_WITHDRAW_ENABLE"), authOk: true, canSend: false, reason: "Auth OK now (IP allowlist fixed; previous 40018 resolved on retest). Balance: ~80,203 VND (~$3.20) + 0.128 BGB; USDT=$0.00. No meaningful funds to send.", measuredAt: "2026-08-28T00:50Z" },
  bybit: { configOpen: flag("CRYPTO_WITHDRAW_ENABLE"), authOk: true, canSend: false, reason: "Auth OK but $0.00 USDT balance.", measuredAt: "2026-08-28" },
  wise: { configOpen: flag("WISE_ENABLE"), authOk: false, canSend: false, reason: "WISE_API_KEY rejected (invalid_token).", measuredAt: "2026-08-28" },
  payoneer: { configOpen: true, authOk: false, canSend: false, reason: "No PAYONEER_CLIENT_ID/SECRET/TOKEN present.", measuredAt: "2026-08-28" },
};

const report = {
  generatedAt: new Date().toISOString(),
  note: "Config-declared route openness does NOT imply send capability. This report reconciles both. A rail is deliverable only if configOpen AND authOk AND canSend.",
  routes: {
    payoneer: { declared: measured.payoneer.configOpen, deliverable: false, ...measured.payoneer },
    paypal: { declared: measured.paypal.configOpen, deliverable: false, ...measured.paypal },
    bank: { declared: flag("BANK_INTEGRATION_ENABLED"), deliverable: false, reason: "No authenticated/funded bank-send credential; bank config is receipt-mode (RECEIVE_LIVE).", measuredAt: "2026-08-28" },
    crypto: {
      declared: flag("CRYPTO_WITHDRAW_ENABLE"),
      deliverable: false,
      exchanges: {
        binance: measured.binance,
        bitget: measured.bitget,
        bybit: measured.bybit,
      },
      reason: "No exchange can withdraw: Binance/Bitget auth-fail, Bybit $0.",
      measuredAt: "2026-08-28",
    },
    wiseDeclared: { declared: measured.wise.configOpen, deliverable: false, ...measured.wise },
  },
  summary: {
    deliverableOutboundRails: ["bank_wire (Banking Circle USD, no-FX, 35bps) via supervised optimum route — route assigned, funds NOT yet moved", "NONE live-authenticated outbound sender currently moves funds (PayPal OAuth client auth fail)"],
    topBlocker: "Outbound funds movement requires a live-authenticated sender rail. PayPal creds fail OAuth 401 invalid_client (live probe 2026-08-31). Supervised optimum route resolved to Banking Circle — Primary for the $6,224.55 pipeline; pending a live bank-send credential before funds move.",
  },
};

const outFile = path.resolve("data/out/rail-health-report.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ written: outFile, deliverableOutboundRails: report.summary.deliverableOutboundRails, blocker: report.summary.topBlocker }, null, 2));
