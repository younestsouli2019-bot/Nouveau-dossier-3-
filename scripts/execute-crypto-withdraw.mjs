const fs = require('fs');
const path = require('path');

const amount = process.argv.find(a => a.startsWith('--amount='))?.split('=')[1] || process.env.AMOUNT;
const network = process.env.CRYPTO_NETWORK || 'BEP20';
const address = process.env.TRUST_WALLET_ADDRESS || '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7';
const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;

if (!apiKey || !apiSecret) {
  const result = { status: 'SKIPPED', reason: 'BINANCE_API_KEY/SECRET not configured', network, address, amount };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync('out.json', JSON.stringify(result, null, 2));
  process.exit(0);
}

const result = { status: 'SIMULATED', network, address, amount, timestamp: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync('out.json', JSON.stringify(result, null, 2));
