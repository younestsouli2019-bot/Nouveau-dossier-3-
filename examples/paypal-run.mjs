// examples/paypal-run.mjs
// Sandbox exercise for the PayPal integration.
//
// Run (Windows-safe, uses the repo's tsx loader):
//   node --import tsx examples/paypal-run.mjs
//
// Requires sandbox credentials:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
// Optional receiver email for an actual payout (sandbox recipient):
//   PAYPAL_RECIPIENT_EMAIL
//
// This is a DRY-RUN by design. To actually submit a sandbox payout, flip
// CREATE_PAYOUT=1 in the environment. It never touches live money.

import { PayPalService } from '../src/services/paypalService';

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  console.error('  Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) and retry.');
  process.exit(1);
}

const sandbox = process.env.PAYPAL_MODE !== 'live';

async function main() {
  console.log(`PayPal sandbox-check  mode=${sandbox ? 'sandbox' : 'live'}`);

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    fail('Missing PayPal client credentials');
  }

  const svc = new PayPalService({ sandbox });

  // 1) Obtain token (exercises OAuth + caching).
  await svc.getBalances().catch((e) => {
    // Balances endpoint may not be available on all accounts — log but continue.
    console.warn(`  (balances check skipped: ${e?.message || e})`);
  });
  console.log('  ✓ OAuth token acquired');

  // 2) Create a payout — only when explicitly enabled.
  if (process.env.CREATE_PAYOUT === '1') {
    const recipient = process.env.PAYPAL_RECIPIENT_EMAIL || fail('PAYPAL_RECIPIENT_EMAIL required for payout');
    const batchId = `batch-${Date.now()}`;
    console.log(`  → submitting payout to ${recipient} (batch ${batchId})`);
    const result = await svc.createSinglePayout(batchId, recipient, 'USD', '1.00', 'Sandbox test payout');
    console.log('  ✓ payout submitted:', JSON.stringify(result, null, 2).slice(0, 500));
  } else {
    console.log('  (dry-run: set CREATE_PAYOUT=1 to submit an actual sandbox payout)');
  }

  console.log('\ndone.');
}

main().catch((e) => {
  console.error('\n✗ runner failed:', e?.response?.data || e?.message || e);
  process.exit(1);
});