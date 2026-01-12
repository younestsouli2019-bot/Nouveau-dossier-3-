import { binanceClient } from '../src/crypto/binance-client.mjs';

async function test() {
  try {
    console.log('Testing Binance client...');

    // Check if client is initialized
    if (!binanceClient.client.apiKey) {
      console.log('❌ Binance API key not set');
      return;
    }

    console.log('API Key present, checking time...');

    // Check time difference
    const { data: timeData } = await binanceClient.client.time();
    const serverTime = timeData.serverTime;
    const localTime = Date.now();
    const diff = localTime - serverTime;

    console.log(`Server time: ${serverTime}`);
    console.log(`Local time: ${localTime}`);
    console.log(`Difference: ${diff}ms`);

    if (Math.abs(diff) > 1000) {
      console.log('⚠️  Time difference > 1000ms, this will cause issues');
    }

    console.log('Testing withdrawal...');

    // Test with a tiny amount to see response structure
    const result = await binanceClient.withdrawUSDTBEP20({
      address: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7', // test address
      amount: 0.01 // tiny amount
    });

    console.log('Response:', JSON.stringify(result, null, 2));
    console.log('ID field:', result.id);

  } catch (e) {
    console.error('Error:', e.message);
    if (e.response?.data) {
      console.error('Response data:', e.response.data);
    }
  }
}

test();