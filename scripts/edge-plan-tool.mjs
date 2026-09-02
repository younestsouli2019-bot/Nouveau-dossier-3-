// scripts/edge-plan-tool.mjs
// TreasuryEdge decision-support dry-run. Constructs a REAL TreasuryEdge from
// env/CLI config and evaluates the full gate stack (per-txn cap, daily cap,
// velocity, multi-sig) for a hypothetical transfer — WITHOUT moving money.
//
// Run (Windows-safe, tsx loader):
//   node --import tsx scripts/edge-plan-tool.mjs [--rail=wise|paypal] [--amount=2000]
//       [--counterparty=<id>] [--currency=USD] [--confirm]
//
// The rail caps default from env or safe defaults; a transfer is ALWAYS a plan
// here — this tool never executes. `--confirm` only flips the plan's verdict
// classification (DRY_RUN vs APPROVE/REJECT), never sends money.
//
// This is decision support for an operator: see WHICH gate blocks a payout and
// why, before you ever run the actual payout:wise / payout:paypal CLIs.

import { TreasuryEdge } from '../src/finance/TreasuryEdge.ts';
import { assertSafeBaseUrl } from '../src/lib/url-guard';

function parseArgs(argv) {
  const a = {};
  const bool = new Set(['--confirm', '--help']);
  for (const arg of argv) {
    if (bool.has(arg)) { a[arg] = true; continue; }
    const m = arg.match(/^--([a-z-]+)=(.*)$/i);
    if (m) a['--' + m[1]] = m[2];
  }
  return a;
}

function usage() {
  console.log(`
TreasuryEdge decision-support dry-run (NEVER moves money).

USAGE
  node --import tsx scripts/edge-plan-tool.mjs [options]

OPTIONS
  --rail=<wise|paypal|payoneer|crypto>   (default wise)
  --amount=<n>                         transfer amount in USD (default 2000)
  --counterparty=<id>                  recipient account id / wallet / RIB
  --currency=<ISO>                     currency (default USD)
  --base-url=<url>                     override provider base (validated SSRF)
  --confirm                            classify verdict as approve/reject (no send)
  --help                               this message

The plan prints which TreasuryEdge gates pass/fail and why. No money moves.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) return usage();

  const rail = String(args['--rail'] || 'wise');
  const amountUsd = Number(args['--amount'] ?? 2000);
  const counterparty = String(args['--counterparty'] || (rail === 'paypal' ? 'owner-paypal@example.com' : 'attijari:007810000448500030594182'));
  const currency = String(args['--currency'] || 'USD').toUpperCase();

  // Caps: from env or safe defaults (mirror TreasuryEdge sample defaults).
  const maxPerTransferUsd = Number(process.env.EDGE_MAX_PER_TRANSFER_USD ?? 5000);
  const maxDailyUsd = Number(process.env.EDGE_MAX_DAILY_USD ?? 10000);
  const multiSigThresholdUsd = Number(process.env.EDGE_MULTISIG_THRESHOLD_USD ?? 5000);
  const velocityWindowMs = Number(process.env.EDGE_VELOCITY_WINDOW_MS ?? 3600_000);
  const velocityCapUsd = Number(process.env.EDGE_VELOCITY_CAP_USD ?? 20000);

  const baseUrl = String(args['--base-url'] || process.env.WISE_API_BASE || (rail === 'paypal'
    ? (process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')
    : 'https://api.transferwise.com'));

  // SSRF-validate the base (fail-closed on localhost/private) before constructing.
  try {
    assertSafeBaseUrl(baseUrl);
  } catch (e) {
    console.error('\n  ✗ base URL rejected by SSRF guard:', e.message);
    process.exit(1);
  }

  const edge = new TreasuryEdge({
    rail,
    maxPerTransferUsd,
    maxDailyUsd,
    multiSigThresholdUsd,
    velocityWindowMs,
    velocityCapUsd,
    baseUrl,
    getAccessToken: async () => process.env.WISE_API_KEY || process.env.PAYPAL_CLIENT_SECRET || '',
    requireApproval: async () => Number(process.env.EDGE_MULTI_SIG_APPROVED ?? 0) === 1,
  },
  // Decision-support only: inject lightweight non-blocking collaborators so we
  // never start the FingerprintManager rotation timer / disk-backed stores that
  // would keep the process alive. TreasuryEdge uses none of these on the plan()
  // path, so a stub is safe here — this tool never sends money.
  { current: () => ({ identity: rail.toUpperCase() }), axiosHeaders: () => ({}) },
  { addEvent: async () => true, listEvents: async () => [] },
  { record: async () => ({ ok: true }), snapshot: () => ({ daily: {} }), dailyVolume: () => ({ volume: 0 }) });

  const plan = await edge.plan({
    counterparty,
    amountUsd,
    currency,
    confirm: args['--confirm'] === true,
  });

  console.log(`\nTreasuryEdge plan  rail=${rail}  ${amountUsd} ${currency} → ${counterparty}`);
  console.log(`  baseUrl: ${baseUrl}`);
  console.log(`  verdict: ${plan.verdict}`);
  console.log(`  idempotencyKey: ${plan.idempotencyKey}`);
  console.log('\n  gates:');
  console.log(`    per-txn cap ${plan.gated.capOk ? '✓' : '✗'}   (max $${maxPerTransferUsd})`);
  console.log(`    daily   cap ${plan.gated.dailyOk ? '✓' : '✗'}   (max $${maxDailyUsd})`);
  console.log(`    velocity   ${plan.gated.velocityOk ? '✓' : '✗'}   (cap $${velocityCapUsd})`);
  console.log(`    multi-sig  ${plan.gated.multiSigOk ? '✓' : '✗'}   (threshold $${multiSigThresholdUsd})`);
  if (plan.reasons.length) {
    console.log('\n  reject reasons:');
    plan.reasons.forEach((r) => console.log(`    - ${r}`));
  }
  console.log('\n  NOTE: this is DRY-RUN decision support. Nothing was sent. Run');
  console.log(`  payout:wise / payout:paypal with --confirm to actually move money.`);
}

main().catch((e) => {
  console.error('\n  ✗ edge-plan-tool failed:', e?.message || e);
  process.exit(1);
});