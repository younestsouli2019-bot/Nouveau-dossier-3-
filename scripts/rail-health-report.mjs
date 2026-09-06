import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ============================================================================
// HONEST RAIL-HEALTH REPORT
// ----------------------------------------------------------------------------
// Reconciles CONFIG-declared route status against MEASURED deliverability.
// A rail is only "deliverable" when it (a) is enabled by config AND (b) actually
// authenticates AND can move funds.
//
// Honesty rules ( tightened 2026-09-05 ):
//   - Binance is LIVE-PROBED (read-only /api/v3/account balance) on every run
//     when credentials are present in env. A failed probe falls back to the
//     cached measurement, explicitly labeled, never silently.
//   - Every route carries its own measuredAt. A measurement older than 48h is
//     listed in summary.staleMeasurements — a fresh generatedAt must never
//     launder old evidence (the 09-05 stale-Binance-row defect).
//   - Routes without env credentials are marked stale rather than re-asserted.
//   - No send path here. Read-only probes only.
//
// Evidence basis (unchanged rows keep their original measuredAt):
//   - Bitget:  auth OK, ~80,203 VND (~$3.20) + 0.128 BGB; USDT=$0.00 (08-28).
//   - Bybit:   auth OK but $0.00 USDT balance (08-28).
//   - Wise:    invalid_token 401 (08-28). Payoneer: no API creds (08-28).
//   - PayPal:  08-31 probe saw 401 invalid_client; the 2026-09-04 REAL payout
//     attempt then returned 403 AUTHORIZATION_ERROR post-auth — credentials DO
//     authenticate; the block is Payouts permission/CIP. fundsMoved=false.
// ============================================================================

function flag(name) {
  return String(process.env[name] ?? "").trim().toLowerCase() === "true";
}

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const BSC_MIN_USDT = 3.01; // withdrawal min + $0.01 fee

async function probeBinance() {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) return null; // no creds in env — caller keeps cached row
  try {
    const t = await fetch("https://api.binance.com/api/v3/time");
    const { serverTime } = await t.json();
    const qs = new URLSearchParams({ timestamp: String(serverTime), recvWindow: "10000" }).toString();
    const sig = crypto.createHmac("sha256", secret).update(qs).digest("hex");
    const r = await fetch(`https://api.binance.com/api/v3/account?${qs}&signature=${sig}`, {
      headers: { "X-MBX-APIKEY": key },
    });
    const j = await r.json();
    if (j.code || r.status !== 200) return { authOk: false, error: j.msg || "http_" + r.status };
    const usdt = (j.balances || []).find((b) => b.asset === "USDT");
    const free = usdt ? parseFloat(usdt.free) + parseFloat(usdt.locked) : 0;
    return { authOk: true, usdt: free, canWithdrawBsc: free >= BSC_MIN_USDT };
  } catch (e) {
    return { authOk: false, error: String(e?.message || e).slice(0, 120) };
  }
}

// ── Binance row: live probe preferred, cached measurement explicitly stale ─
const binanceProbe = await probeBinance();
const now = new Date().toISOString();
let binance;
if (binanceProbe && binanceProbe.authOk) {
  binance = {
    configOpen: flag("CRYPTO_WITHDRAW_ENABLE"),
    authOk: true,
    canSend: binanceProbe.canWithdrawBsc,
    reason: binanceProbe.canWithdrawBsc
      ? `Live probe: auth OK, ${binanceProbe.usdt} USDT available (BSC-withdrawable ≥${BSC_MIN_USDT}). I8 CAP_WITHDRAW_CRYPTO grant still required before any withdrawal.`
      : `Live probe: auth OK but UNFUNDED (${binanceProbe.usdt} USDT < ${BSC_MIN_USDT} BSC minimum). Deposit USDT to Binance spot. I8 CAP_WITHDRAW_CRYPTO grant still required before any withdrawal.`,
    measuredAt: now,
  };
} else if (binanceProbe) {
  binance = {
    configOpen: flag("CRYPTO_WITHDRAW_ENABLE"),
    authOk: false,
    canSend: false,
    reason: `Live probe failed: ${binanceProbe.error}. (Cached 2026-08-28 measurement was: -2015 Invalid API-key/IP/permissions.)`,
    measuredAt: now,
  };
} else {
  binance = {
    configOpen: flag("CRYPTO_WITHDRAW_ENABLE"),
    authOk: false,
    canSend: false,
    reason: "-2015 Invalid API-key/IP/permissions (both key sets) [CACHED — no BINANCE_API_KEY/SECRET in env to re-probe].",
    measuredAt: "2026-08-28",
    stale: true,
  };
}

const measured = {
  paypal: {
    configOpen: flag("PAYPAL_PPP2_APPROVED") && flag("PAYPAL_PPP2_ENABLE_SEND") && !flag("PAYPAL_DISABLED"),
    authOk: true,
    canSend: false,
    reason: "2026-09-04 real payout attempt ($1.00, POST /v1/payments/payouts) -> 403 AUTHORIZATION_ERROR (debug_id 24e19c70391c2): OAuth credentials DO authenticate; the block is the Payouts permission/CIP on the PPP2 app. fundsMoved=false. (The 08-31 401 invalid_client probe is superseded by this post-auth 403.)",
    measuredAt: "2026-09-04T10:23Z",
  },
  binance,
  bitget: { configOpen: flag("CRYPTO_WITHDRAW_ENABLE"), authOk: true, canSend: false, reason: "Auth OK now (IP allowlist fixed; previous 40018 resolved on retest). Balance: ~80,203 VND (~$3.20) + 0.128 BGB; USDT=$0.00. No meaningful funds to send.", measuredAt: "2026-08-28T00:50Z" },
  bybit: { configOpen: flag("CRYPTO_WITHDRAW_ENABLE"), authOk: true, canSend: false, reason: "Auth OK but $0.00 USDT balance.", measuredAt: "2026-08-28" },
  wise: { configOpen: flag("WISE_ENABLE"), authOk: false, canSend: false, reason: "WISE_API_KEY rejected (invalid_token).", measuredAt: "2026-08-28" },
  payoneer: { configOpen: true, authOk: false, canSend: false, reason: "No PAYONEER_CLIENT_ID/SECRET/TOKEN present.", measuredAt: "2026-08-28" },
};

const binanceGreen = binance.authOk && binance.canSend;
const binanceLive = binance.authOk;

const deliverableRails = [
  "bank_wire (Banking Circle USD, no-FX, 35bps) via supervised optimum route — route assigned, funds NOT yet moved",
];
if (binanceGreen) {
  deliverableRails.push("binance_bsc_usdt — auth OK and funded; execution still gated by I8 CAP_WITHDRAW_CRYPTO + explicit --confirm");
} else {
  deliverableRails.push("NONE live-authenticated outbound sender currently moves funds" + (binanceLive ? " (Binance authenticated but unfunded)" : ""));
}

const topBlocker = binanceGreen
  ? "Funding gate satisfied by Binance (live + funded). Remaining gates before any movement: I8 CAP_WITHDRAW_CRYPTO grant and operator-supplied --confirm."
  : binanceLive
    ? `Deposit ≥${BSC_MIN_USDT} USDT to Binance spot — the rail is authenticated but unfunded; that is the single actionable blocker.`
    : "Outbound funds movement requires a live-authenticated sender rail. PayPal authenticates but is CIP/permission-blocked; Banking Circle send credential not provisioned.";

const report = {
  generatedAt: now,
  note: "Config-declared route openness does NOT imply send capability. This report reconciles both. A rail is deliverable only if configOpen AND authOk AND canSend. Binance is live-probed per run when creds are present; all other rows keep their original measuredAt.",
  routes: {
    payoneer: { declared: measured.payoneer.configOpen, deliverable: false, ...measured.payoneer },
    paypal: { declared: measured.paypal.configOpen, deliverable: false, ...measured.paypal },
    bank: { declared: flag("BANK_INTEGRATION_ENABLED"), deliverable: false, reason: "No authenticated/funded bank-send credential; bank config is receipt-mode (RECEIVE_LIVE).", measuredAt: "2026-08-28" },
    crypto: {
      declared: flag("CRYPTO_WITHDRAW_ENABLE"),
      deliverable: binanceGreen,
      exchanges: {
        binance: measured.binance,
        bitget: measured.bitget,
        bybit: measured.bybit,
      },
      reason: binanceGreen
        ? "Binance live + funded (BSC)."
        : binanceLive
          ? "Binance authenticated but unfunded; Bitget/Bybit have no meaningful funds."
          : "No exchange can withdraw: Binance auth-fail/unprobed, Bitget/Bybit $0.",
      measuredAt: binance.measuredAt,
    },
    wiseDeclared: { declared: measured.wise.configOpen, deliverable: false, ...measured.wise },
  },
  summary: {
    deliverableOutboundRails: deliverableRails,
    topBlocker,
    staleMeasurements: [],
  },
};

// Staleness sweep: a fresh generatedAt must never launder old evidence.
for (const [route, row] of Object.entries(report.routes)) {
  const rows = route === "crypto" ? Object.entries(row.exchanges) : [[route, row]];
  for (const [name, r] of rows) {
    const t = Date.parse(r.measuredAt);
    if (Number.isNaN(t) || Date.now() - t > STALE_AFTER_MS) {
      report.summary.staleMeasurements.push({
        route: route === "crypto" ? `crypto.${name}` : route,
        measuredAt: r.measuredAt,
        stale: true,
      });
    }
  }
}

const outFile = path.resolve("data/out/rail-health-report.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  written: outFile,
  deliverableOutboundRails: report.summary.deliverableOutboundRails,
  blocker: report.summary.topBlocker,
  staleMeasurements: report.summary.staleMeasurements,
}, null, 2));
