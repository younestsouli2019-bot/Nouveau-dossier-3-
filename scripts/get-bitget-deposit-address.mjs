import ccxt from 'ccxt';
import 'dotenv/config';

async function getDepositAddress() {
  const bitget = new ccxt.bitget({
    apiKey: process.env.BITGET_API_KEY,
    secret: process.env.BITGET_API_SECRET,
    password: process.env.BITGET_PASSPHRASE,
  });

  try {
    // Sync time first
    await bitget.loadTimeDifference();
    
    console.log('Fetching USDT deposit address for Bitget API Account...');
    
    // Fetch deposit address for USDT
    // Note: Some exchanges require specifying the network
    const currency = 'USDT';
    
    // Try to fetch deposit address
    // Bitget might return multiple chains
    const addressInfo = await bitget.fetchDepositAddress(currency, { network: 'BEP20' });
    
    console.log('------------------------------------------------');
    console.log(`Successfully fetched ${currency} Deposit Address`);
    console.log('------------------------------------------------');
    console.log(`Address: ${addressInfo.address}`);
    if (addressInfo.tag) {
      console.log(`Tag/Memo: ${addressInfo.tag}`);
    }
    console.log(`Network: ${addressInfo.network || 'BEP20'}`);
    console.log('------------------------------------------------');
    console.log('PLEASE FEED THIS ADDRESS TO ENABLE SETTLEMENTS.');

  } catch (error) {
    console.error('Error fetching deposit address:', error.message);
    // Fallback: try fetching all addresses if specific network fails
    try {
        console.log('Attempting to fetch all deposit addresses for USDT...');
        const addresses = await bitget.fetchDepositAddresses('USDT');
        console.log(JSON.stringify(addresses, null, 2));
    } catch (e) {
        console.error('Fallback failed:', e.message);
    }
  }
}

getDepositAddress();
