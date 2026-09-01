// READ-ONLY probe of the live Attijariwafa PSD2 endpoint.
// Safety: only GET accounts/balances/transactions. NEVER initiates payments.
// Fail-closed: if LIVE_BANK_API missing, exits cleanly without calling out.
import 'dotenv/config';
import {
  getAllBalancesSummary,
  getTransactions,
} from '../src/lib/attijariwafa-psd2';

const HAD = process.env.LIVE_BANK_API || '';

if (!HAD) {
  console.log('[probe] LIVE_BANK_API not set - refusing to attempt live call (fail-closed).');
  process.exit(0);
}

const FROM = '2026-08-20';
const TO = new Date().toISOString().slice(0, 10);

(async () => {
  console.log('[probe] LIVE_BANK_API present (len=' + HAD.length + ') - attempting READ-ONLY live fetch.');
  console.log('[probe] window', FROM, '->', TO);

  const summary = await getAllBalancesSummary();
  console.log('[probe] isLive=' + summary.isLive + ' consentStatus=' + summary.consentStatus);
  console.log('[probe] totals  MAD=' + summary.totalMAD + ' EUR=' + summary.totalEUR + ' USD=' + summary.totalUSD);
  console.log('[probe] accounts=' + summary.accounts.length);
  for (const acct of summary.accounts) {
    console.log('  - acct ' + acct.accountType + ' ' + acct.currency + ' product=' + acct.product +
      ' balances=' + acct.balances.map((b: any) => b.balanceType + ':' + b.balanceAmount.amount + b.balanceAmount.currency + ':' + b.creditDebitIndicator).join(','));
  }

  for (const acct of summary.accounts) {
    try {
      const txs = await getTransactions(acct.accountId, FROM, TO);
      console.log('[probe] ' + acct.accountType + '/' + acct.accountId.slice(0, 8) + '... transactions=' + txs.length + ' in window');
      let creditTotal = 0;
      for (const t of txs) {
        const amt = parseFloat(t.amount.amount) || 0;
        if (t.creditDebitIndicator === 'CRDT' || t.creditDebitIndicator === 'CREDIT') creditTotal += amt;
        console.log('   tx ' + t.transactionId + ' ' + t.creditDebitIndicator + ' ' + amt + ' ' + t.amount.currency +
          ' status=' + t.status + ' book=' + (t.bookingDate || '') + ' ' + (t.remittanceInformationUnstructured || '').slice(0, 60));
      }
      console.log('[probe] credit receipts in window for ' + acct.accountType + ' ~ ' + creditTotal.toFixed(2));
    } catch (e: any) {
      console.log('[probe] tx fetch failed for ' + acct.accountType + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  console.log('[probe] done (read-only; no payments initiated).');
})().catch((e: any) => {
  console.log('[probe] fatal: ' + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
