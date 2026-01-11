import { binanceClient } from '../src/crypto/binance-client.mjs';

console.log('🔍 BINANCE SIGNATURE DEBUG – OFFICIAL LIB + TIMESTAMP FIX');

const withdrawalParams = {
  address: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
  amount: '850',
};

console.log('Attempting withdrawal with params:', withdrawalParams);

try {
  const result = await binanceClient.withdrawUSDTBep20(withdrawalParams);
  console.log('Withdrawal successful:', result);
} catch (e) {
  console.error('Debug script caught an error:', e);
  if (e.response) {
      console.error('Response data:', e.response.data);
  }
}
