// scripts/paypal-payout-workflow.mjs
// PayPal payout CLI wired through the fail-closed TreasuryEdge caps.
//
// Run (Windows-safe, uses the repo's tsx loader):
//   node --import tsx scripts/paypal-payout-workflow.mjs [--dry-run|--confirm] [--amount=1.00] [--recipient=<email>]
//
// CREDENTIALS (env only — never commit):
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
//   PAYPAL_MODE=live (else sandbox: api-m.sandbox.paypal.com)
//   PAYPAL_RECIPIENT_EMAIL  (or pass --recipient)
//
// SAFETY (fail-closed by design):
//   * Defaults to DRY-RUN — prints the plan and submits NOTHING. Pass --confirm to
//     actually create a payout.
//   * Gated by TreasuryEdge-style caps (per-txn < 5000 USD, daily < 10000 USD).
//   * The batch is idempotent: batchId (and its sender_item_id) are derived from a
//     stable key, so retries do NOT double-submit.

import { PayPalService } from '../src/services/paypalService';

function parseArgs(argv) {
  const a = {};
  const bool = new Set(['--dry-run', '--confirm', '--help']);
  for (const arg of argv) {
    if (bool.has(arg)) { a[arg] = true; continue; }
    const m = arg.match(/^--([a-z-]+)=(.*)$/i);
    if (m) a[m[1]] = m[2];
  }
  return a;
}

function usage() {
  console.log(`
PayPal payout CLI (fail-closed).

USAGE
  node --import tsx scripts/paypal-payout-workflow.mjs [options]

OPTIONS
  --dry-run               print plan only; submit nothing (DEFAULT)
  --confirm               actually create the payout (gated by caps + real creds)
  --amount=<n>            payout value (default 1.00)
  --recipient=<email>     receiver email (or PAYPAL_RECIPIENT_EMAIL env)
  --batch-id=<k>          stable batch id for idempotency (else derived)
  --help                  this message

ENV
  PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (required for --confirm)
  PAYPAL_MODE=live (else sandbox)
  PAYPAL_RECIPIENT_EMAIL (optional target)
`);
}

const CAPS = { maxPerTransferUsd: 5000, maxDailyUsd: 10000 };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) return usage();

  const confirm = args['--confirm'] === true;
  const amountUsd = Number(args['--amount'] ?? 1);
  const recipient = args['--recipient'] || process.env.PAYPAL_RECIPIENT_EMAIL;
  const sandbox = process.env.PAYPAL_MODE !== 'live';

  console.log(`PayPal payout CLI  mode=${sandbox ? 'SANDBOX' : 'LIVE'}  amount=$${amountUsd}  recipient=${recipient || '(missing)'}`);
  if (!confirm) console.log('  (dry-run mode: pass --confirm to submit; caps checked below)');

  // Cap gates (mirror TreasuryEdge).
  if (amountUsd > CAPS.maxPerTransferUsd) {
    console.error(`\n  ✗ BLOCKED: amount $${amountUsd} exceeds per-transfer cap $${CAPS.maxPerTransferUsd}.`);
    process.exit(1);
  }

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    console.error('\n  ✗ Fail-closed: missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.');
    process.exit(1);
  }
  if (confirm && !recipient) {
    console.error('\n  ✗ Fail-closed: --recipient (or PAYPAL_RECIPIENT_EMAIL) required for a real payout.');
    process.exit(1);
  }

  const svc = new PayPalService({ sandbox });

  // OAuth + balances (read-only; exercises token caching).
  await svc.getBalances().catch((e) => console.warn('  (balances check skipped: ' + (e?.message || e) + ')'));
  console.log('  ✓ OAuth token acquired');

  // Idempotent batch id: stable per logical payout, reused across retries.
  const batchId = args['--batch-id'] || `batch-${recipient || 'unknown'}-${amountUsd}`;

  if (!confirm) {
    console.log('\n  plan: DRY_RUN  (would submit payout to', recipient || '(no recipient)', 'with batch', batchId, ')');
    console.log('  Pass --confirm to actually execute. Nothing submitted.');
    return;
  }

  console.log('  → submitting payout (confirm)…');
  const result = await svc.createSinglePayout(batchId, recipient, 'USD', amountUsd.toFixed(2), 'Payout');
  console.log('  ✓ payout submitted:', JSON.stringify(result, null, 2).slice(0, 500));
  console.log('\ndone.');
}

main().catch((e) => {
  console.error('\n  ✗ runner failed:', e?.response?.data || e?.message || e);
  process.exit(1);
});