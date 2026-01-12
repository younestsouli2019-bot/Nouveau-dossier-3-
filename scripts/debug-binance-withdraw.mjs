import { Spot } from '@binance/connector';
import 'dotenv/config';

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;

const client = new Spot(apiKey, apiSecret);

async function testWithdraw() {
  try {
    console.log('Attempting withdrawal with @binance/connector...');
    const result = await client.withdraw(
      'USDT',
      '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
      '0.01',
      {
        network: 'BSC',
      }
    );
    console.log('Withdrawal successful:', result.data);
  } catch (error) {
    console.error('Withdrawal failed:', error.response.data);
  }
}

testWithdraw();
