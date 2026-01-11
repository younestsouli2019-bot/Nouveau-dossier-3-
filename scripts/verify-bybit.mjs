import ccxt from 'ccxt';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function verifyBybit() {
  console.log('Verifying Bybit connection...');
  
  const bybit = new ccxt.bybit({
    apiKey: process.env.BYBIT_API_KEY,
    secret: process.env.BYBIT_API_SECRET,
    options: { 
        adjustForTimeDifference: true,
        recvWindow: 200000 
    },
  });

  try {
    // Explicitly load markets to trigger time sync?
    // Or just check time manually
    const serverTime = await bybit.fetchTime();
    console.log('Server Time:', serverTime);
    console.log('Local Time:', Date.now());
    const diff = Date.now() - serverTime;
    console.log('Diff:', diff);
    
    // Manually set time difference
    bybit.options['timeDifference'] = diff;
    console.log('Set timeDifference to:', diff);

    // Try to load markets
    await bybit.loadMarkets();

    const balance = await bybit.fetchBalance();
    console.log('✅ Bybit connection successful!');
    
    if (balance.USDT) {
      console.log('💰 USDT Balance:', balance.USDT);
    } else {
      console.log('ℹ️ No USDT balance found.');
    }

  } catch (e) {
    console.error('❌ Bybit verification failed:', e.message);
  }
}

verifyBybit();
