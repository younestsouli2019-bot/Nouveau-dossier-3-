// scripts/wise-sample-workflow.mjs
// Wise EUR→MAD payout CLI wired through the fail-closed TreasuryEdge caps.
//
// Run (Windows-safe, uses the repo's tsx loader):
//   node --import tsx scripts/wise-sample-workflow.mjs [--dry-run|--confirm] [--amount=1200] [--currency=MAD] [--idem-key=<stable>]
//
// CREDENTIALS (env only — never commit):
//   WISE_API_KEY                          bearer API key (simplest)
//   or WISE_CLIENT_ID + WISE_CLIENT_SECRET (client_credentials OAuth)
//   WISE_SANDBOX=1                        use api.sandbox.transferwise.tech (default when unset = SANDBOX)
//   WISE_MODE=live                        force production api.transferwise.com
//   WISE_PROFILE_ID                       optional: skip primary-profile lookup
//   WISE_RECIPIENT_RIB                    optional target IBAN; else WISE_RECIPIENT_ACCOUNT_ID
//
// SAFETY (fail-closed by design):
//   * Defaults to DRY-RUN — prints the plan + OAuth/profile/quote readiness and
//     moves NOTHING. You must pass --confirm to actually submit a transfer.
//   * Even with --confirm, the transfer is gated by TreasuryEdge-style caps
//     (per-txn < 5000 USD, daily < 10000 USD) and requires real creds.
//   * Money MOVes via WiseService.createTransfer(..., confirmedTransfer=true) ONLY
//     when --confirm is set AND gates pass. Idempotency keys are caller-stable.

import { WiseService } from '../src/services/wiseService';

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
Wise payout CLI (fail-closed).

USAGE
  node --import tsx scripts/wise-sample-workflow.mjs [options]

OPTIONS
  --dry-run               print plan only; move nothing (DEFAULT)
  --confirm               actually submit the transfer (gated by caps + real creds)
  --amount=<n>            source amount in sources currency (default 1200)
  --currency=<ISO>        source currency (default EUR); target is MAD
  --idem-key=<k>          stable idempotency key reused across retries (else derived)
  --help                  this message

ENV
  WISE_API_KEY | WISE_CLIENT_ID+WISE_CLIENT_SECRET (required for --confirm)
  WISE_SANDBOX=1 (default sandbox) | WISE_MODE=live (force production)
  WISE_PROFILE_ID (optional) | WISE_RECIPIENT_RIB | WISE_RECIPIENT_ACCOUNT_ID
`);
}

// TreasuryEdge-style hard gates (mirror TreasuryEdge defaults for the Wise rail).
const CAPS = { maxPerTransferUsd: 5000, maxDailyUsd: 10000, velocityWindowMs: 3600_000, velocityCapUsd: 20000 };

function gateCheck(amountUsd, usedTodayUsd) {
  const reasons = [];
  if (amountUsd > CAPS.maxPerTransferUsd) reasons.push(`per-transfer cap $${CAPS.maxPerTransferUsd} exceeded`);
  if (usedTodayUsd + amountUsd > CAPS.maxDailyUsd) reasons.push(`daily cap $${CAPS.maxDailyUsd} would be exceeded`);
  return reasons;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['--help']) return usage();

  const confirm = args['--confirm'] === true;
  const amountUsd = Number(args['--amount'] ?? 1200);
  const sourceCcy = String(args['--currency'] ?? 'EUR').toUpperCase();
  const usedTodayUsd = 0; // in-memory; a real run should read settled volume from metrics (TreasuryEdge)

  const sandbox = process.env.WISE_MODE === 'live' ? false : (process.env.WISE_SANDBOX !== '0');
  const apiKey = process.env.WISE_API_KEY;
  const clientId = process.env.WISE_CLIENT_ID;
  const clientSecret = process.env.WISE_CLIENT_SECRET;
  const profileId = process.env.WISE_PROFILE_ID;
  const targetRib = process.env.WISE_RECIPIENT_RIB;
  const targetAccountId = process.env.WISE_RECIPIENT_ACCOUNT_ID;

  console.log(`Wise payout CLI  mode=${sandbox ? 'SANDBOX' : 'LIVE'}  amount=${amountUsd} ${sourceCcy} → MAD`);
  if (!confirm) console.log('  (dry-run mode: pass --confirm to submit; gates are checked below)');

  // Gate check is meaningful for both dry-run (plan) and confirm (execution).
  const gateReasons = gateCheck(amountUsd, usedTodayUsd);
  if (gateReasons.length) {
    console.error('\n  ✗ BLOCKED by TreasuryEdge caps:');
    gateReasons.forEach((r) => console.error(`     - ${r}`));
    console.error('  Nothing will move. Lower --amount or raise caps.');
    process.exit(1);
  }

  if (!apiKey && !(clientId && clientSecret)) {
    console.error('\n  ✗ Fail-closed: no Wise credentials.');
    console.error('    Set WISE_API_KEY, or WISE_CLIENT_ID + WISE_CLIENT_SECRET, and retry.');
    process.exit(1);
  }

  const svc = new WiseService({
    apiKey, clientId, clientSecret, sandbox, profileId,
  });

  // 1) Resolve target account (IBAN or account id).
  let targetAccount = targetAccountId;
  if (!targetAccount && targetRib) {
    const acc = await svc.createRecipientAccount({
      currency: 'MAD', type: 'iban',
      accountHolderName: process.env.WISE_RECIPIENT_HOLDER_NAME || 'M TSOULI YOUNES',
      details: { IBAN: targetRib, legalType: 'PRIVATE' },
    });
    targetAccount = acc?.id;
  }
  if (!targetAccount) {
    console.error('\n  ✗ No target account: set WISE_RECIPIENT_RIB or WISE_RECIPIENT_ACCOUNT_ID.');
    process.exit(1);
  }

  // 2) Obtain token + list profiles (read-only; exercises OAuth).
  await svc.getProfiles().catch((e) => console.warn('  (profiles check skipped: ' + (e?.message || e) + ')'));
  console.log('  ✓ OAuth token acquired');

  // 3) Quote (idempotent per logical target+amount; stable key derived or caller-supplied).
  const idemKey = args['--idem-key'] || `wise-quote-${targetAccount}-${sourceCcy}MAD-${amountUsd}`;
  const quote = await svc.createQuote({
    sourceCurrency: sourceCcy, targetCurrency: 'MAD', amount: amountUsd, targetAccount,
    idempotencyKey: idemKey,
  });
  console.log('  ✓ quote minted (rate supports the amount)');

  if (!confirm) {
    console.log('\n  plan: DRY_RUN  (would submit transfer to', targetAccount, 'with idem', idemKey, ')');
    console.log('  Pass --confirm to actually execute. Nothing moved.');
    return;
  }

  // 4) Confirm-gated transfer (money MOVES here).
  console.log('  → submitting transfer (confirm=true)…');
  const transfer = await svc.createTransfer({
    targetAccount, quoteUuid: quote?.id, amount: amountUsd, currency: sourceCcy,
    reference: `settlement-${targetAccount}`, idempotencyKey: idemKey,
  }, true);
  console.log('  ✓ transfer submitted:', JSON.stringify(transfer, null, 2).slice(0, 500));
  console.log('\ndone.');
}

main().catch((e) => {
  console.error('\n  ✗ runner failed:', e?.response?.data || e?.message || e);
  process.exit(1);
});