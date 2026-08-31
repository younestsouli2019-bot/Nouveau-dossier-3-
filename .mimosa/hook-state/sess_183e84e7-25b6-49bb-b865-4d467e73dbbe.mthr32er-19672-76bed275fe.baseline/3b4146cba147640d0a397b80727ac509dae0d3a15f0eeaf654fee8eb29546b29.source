import 'dotenv/config';
import { resolveBestPayoutRoute } from '../src/lib/payout-resolver';

const currency = process.argv[2] || 'USD';
const res = await resolveBestPayoutRoute(currency);
console.log('=== RESOLVE BEST PAYOUT ROUTE:', currency, '===');
console.log('source:', res.source);
console.log('reason:', res.reason);
console.log('--- ranked routes ---');
for (const r of res.ranked) {
  console.log(`  [${r.rail}] ${r.label} | cur=${r.currency} | feeBps=${r.feeBps} fx=${r.fxSpreadBps} | ${r.requiresFxConversion ? 'FX-NEEDED' : 'NO-FX'} | pressure=${r.limitPressurePct}% | id=${r.identifier} | usable=${r.usableByIdentity}`);
}
console.log('BEST:', res.best ? JSON.stringify({ rail: res.best.rail, label: res.best.label, currency: res.best.currency }, null, 2) : 'NONE');
