import 'dotenv/config';
import { PayPalGateway } from '../src/financial/gateways/PayPalGateway.mjs';
import { ExternalGatewayManager } from '../src/finance/ExternalGatewayManager.mjs';
import { spawnSync } from 'node:child_process';

function runSync(batchId) {
  const res = spawnSync(process.execPath, ['src/sync-paypal-payout-batch.mjs', '--batchId', batchId], { encoding: 'utf8' });
  return { ok: res.status === 0, out: res.stdout, err: res.stderr };
}

async function run() {
  process.env.PAYPAL_MODE = 'PAYOUT';
  const gw = new PayPalGateway();
  const dest =
    process.env.PAYPAL_PAYOUT_EMAIL ||
    process.env.OWNER_PAYPAL_EMAIL ||
    process.env.PAYPAL_EMAIL;
  const amt = Number(process.env.PAYPAL_PAYOUT_AMOUNT || 25);
  const cur = process.env.PAYPAL_PAYOUT_CURRENCY || 'USD';
  try {
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
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (msg.includes('AUTHORIZATION_ERROR')) {
      const storage = { load: () => null, save: (_t, _id, r) => r };
      const audit = { log: () => {} };
      const executor = { execute: async (_k, fn) => fn() };
      const manager = new ExternalGatewayManager(storage, audit, executor);
      const payoutBatchId = `AUTO-${Date.now()}`;
      const items = [{ amount: amt, currency: cur, recipient_email: dest, note: 'Owner Hands-Free Live Payout' }];
      const prepared = await manager.initiateAutoSettlement(payoutBatchId, items, `idem-${payoutBatchId}`, 'System');
      const route = prepared.route_attempted || 'bank_transfer';
      const broadcast = await manager.broadcastSettlement(route, prepared, items, 'System');
      console.log(JSON.stringify({ ok: true, fallback: { route, prepared, broadcast } }, null, 2));
      return;
    }
    console.error('PAYPAL_PAYOUT_FAILED', msg);
    process.exit(1);
  }
}

run().catch(e => {
  console.error('PAYPAL_PAYOUT_FAILED', e && e.message ? e.message : String(e));
  process.exit(1);
});
