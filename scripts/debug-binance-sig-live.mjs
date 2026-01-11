import { binanceClient } from '../src/crypto/binance-client.mjs';

console.log('🔍 BINANCE SIGNATURE DEBUG – LIVE WITHDRAWAL PARAMS');
console.log('');

// Same params we will use for the real 850 USDT withdrawal
const params = {
  coin: 'USDT',
  network: 'BSC',
  address: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
  amount: '850',
  name: 'AutonomousSettlement'
};

console.log('Parameters we are about to sign:');
console.log(JSON.stringify(params, null, 2));
console.log('');

try {
  // This will trigger the debug logs in _request()
  await binanceClient._request('/sapi/v1/capital/withdraw/apply', 'POST', params);
} catch (e) {
  // We expect this to fail with -1022, but we’ll see the exact query string
  console.error('Expected error (we are only debugging signature):', e.message);
}