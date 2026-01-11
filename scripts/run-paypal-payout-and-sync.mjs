import { PayPalGateway } from '../src/financial/gateways/PayPalGateway.mjs';
import { OwnerSettlementEnforcer } from '../src/policy/owner-settlement.mjs';
import { spawnSync } from 'node:child_process';

function runSync(batchId) {
  const res = spawnSync(process.execPath, ['src/sync-paypal-payout-batch.mjs', '--batchId', batchId], { encoding: 'utf8' });
  return { ok: res.status === 0, out: res.stdout, err: res.stderr };
}

async function run() {
  process.env.PAYPAL_MODE = 'PAYOUT';
  const gw = new PayPalGateway();
  const dest = OwnerSettlementEnforcer.getOwnerAccountForType('paypal');
  const amt = Number(process.env.PAYPAL_PAYOUT_AMOUNT || 25);
  const cur = process.env.PAYPAL_PAYOUT_CURRENCY || 'USD';
  const res = await gw.createPayout(amt, cur, dest, 'Owner Hands-Free Live Payout');
  if (!res || !res.batch_header?.payout_batch_id) {
    console.log(JSON.stringify({ ok: false, error: 'missing_batch_id', res }, null, 2));
    return;
  }
  const batchId = res.batch_header.payout_batch_id;
  console.log(JSON.stringify({ ok: true, payout: { ...res, batchId } }, null, 2));
  const sync = runSync(batchId);
  console.log(sync.out || '');
  if (!sync.ok) {
    console.error(sync.err || 'SYNC_FAILED');
    process.exit(1);
  }
}

run().catch(e => {
  console.error('PAYPAL_PAYOUT_FAILED', e && e.message ? e.message : String(e));
  process.exit(1);
});
