const crypto = require('crypto');
const https = require('https');

// ============================================
// SWARM BANK WIRE TRANSFER SYSTEM
// ============================================

const BINANCE = {
  apiKey: '3UPgbXT7qUPW9N28aMU73kz7XzMRkytWeCMrBUKtjyKz2vYCTQ4oikbNbdfLYDai',
  secret: 'lLVoL5E6ucEQ3WRegA7pvRwCo6XVlIGBUFXnaH5M0HATVVz9LSTqRFGS7raCIRFs'
};

const BITGET = {
  apiKey: 'bg_9b4337d8e33d7f6537584aef3a929520',
  secret: '97e04c50342a31dfa497420bbe9acd08527e5929676ec261420f6584161c61d9',
  passphrase: '0x67e694f7b4ce878d664c4b18e22c55'
};

// Recipient RIB Details
const RIB = {
  bank: 'Attijariwafa Bank',
  branch: 'RABAT AGDAL FAL OULD OUMEIR',
  address: '83, AV. FAL OULD OUMEIR',
  holder: 'M TSOULI YOUNES',
  codeBanque: '007',
  codeVille: '810',
  numeroSerie: '0004485000305941',
  cleRIB: '82',
  swift: 'BCMAMAMC',
  fullRIB: '007 810 0004485000305941 82'
};

// Binance API signature
function signBinance(queryString) {
  return crypto.createHmac('sha256', BINANCE.secret).update(queryString).digest('hex');
}

// Bitget API signature
function signBitget(timestamp, method, path, body) {
  const message = timestamp + method.toUpperCase() + path + (body || '');
  return crypto.createHmac('sha256', BITGET.secret).update(message).digest('base64');
}

// HTTP request helper
function request(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Check Binance balance
async function checkBinanceBalance() {
  console.log('\n📊 BINANCE BALANCE CHECK');
  console.log('━'.repeat(40));
  
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}&recvWindow=10000`;
  const signature = signBinance(queryString);
  
  const options = {
    hostname: 'api.binance.com',
    path: `/sapi/v3/asset/getUserAsset?${queryString}&signature=${signature}`,
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': BINANCE.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };
  
  try {
    const result = await request(options);
    
    if (Array.isArray(result)) {
      const nonZero = result.filter(b => parseFloat(b.free) > 0);
      
      if (nonZero.length === 0) {
        console.log('No non-zero balances found');
        return 0;
      }
      
      let totalUSDT = 0;
      
      nonZero.forEach(b => {
        console.log(`  ${b.asset}: Free=${b.free}, Locked=${b.locked}`);
        if (b.asset === 'USDT') totalUSDT += parseFloat(b.free);
        if (b.asset === 'BTC') totalUSDT += parseFloat(b.free) * 65000; // approx
        if (b.asset === 'ETH') totalUSDT += parseFloat(b.free) * 3500; // approx
      });
      
      console.log(`\n  💰 Estimated Total: ~${totalUSDT.toFixed(2)} USDT`);
      return totalUSDT;
    } else {
      console.log('  Response:', JSON.stringify(result).substring(0, 200));
      return 0;
    }
  } catch (err) {
    console.log('  Error:', err.message);
    return 0;
  }
}

// Check Bitget balance
async function checkBitgetBalance() {
  console.log('\n📊 BITGET BALANCE CHECK');
  console.log('━'.repeat(40));
  
  const timestamp = Date.now();
  const method = 'GET';
  const path = '/api/spot/v1/account/assets';
  const signature = signBitget(timestamp, method, path, '');
  
  const options = {
    hostname: 'api.bitget.com',
    path: path,
    method: 'GET',
    headers: {
      'ACCESS-KEY': BITGET.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp.toString(),
      'ACCESS-PASSPHRASE': BITGET.passphrase,
      'Content-Type': 'application/json'
    }
  };
  
  try {
    const result = await request(options);
    
    if (result.code === '00000' && result.data) {
      let totalUSDT = 0;
      
      result.data.forEach(b => {
        if (parseFloat(b.available) > 0) {
          console.log(`  ${b.currency}: Available=${b.available}, Frozen=${b.frozen}`);
          if (b.currency === 'USDT') totalUSDT += parseFloat(b.available);
          if (b.currency === 'BTC') totalUSDT += parseFloat(b.available) * 65000;
          if (b.currency === 'ETH') totalUSDT += parseFloat(b.available) * 3500;
        }
      });
      
      console.log(`\n  💰 Estimated Total: ~${totalUSDT.toFixed(2)} USDT`);
      return totalUSDT;
    } else {
      console.log('  Response:', JSON.stringify(result).substring(0, 200));
      return 0;
    }
  } catch (err) {
    console.log('  Error:', err.message);
    return 0;
  }
}

// Get Binance P2P MAD price
async function getBinanceP2PPrice() {
  console.log('\n📈 BINANCE P2P USDT/MAD PRICE');
  console.log('━'.repeat(40));
  
  const options = {
    hostname: 'p2p.binance.com',
    path: '/bapi/c2c/v2/friendly/c2c/adv/search',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  const body = JSON.stringify({
    asset: 'USDT',
    fiat: 'MAD',
    tradeType: 'SELL',
    rows: 10,
    page: 1
  });
  
  try {
    const result = await request({ ...options, body });
    
    if (result.data) {
      const prices = result.data.map(ad => ({
        price: ad.adVO?.tradePrice,
        merchant: ad.adVO?.nickName,
        minAmount: ad.adVO?.minSingleTransAmount,
        maxAmount: ad.adVO?.maxSingleTransAmount
      }));
      
      prices.slice(0, 5).forEach((p, i) => {
        console.log(`  ${i+1}. ${p.price} MAD/USDT - ${p.merchant} (${p.minAmount}-${p.maxAmount} MAD)`);
      });
      
      if (prices.length > 0) {
        const avgPrice = prices.reduce((a, b) => a + parseFloat(b.price), 0) / prices.length;
        console.log(`\n  📊 Average Price: ${avgPrice.toFixed(2)} MAD/USDT`);
        return avgPrice;
      }
    }
    
    console.log('  No prices found');
    return 0;
  } catch (err) {
    console.log('  Error:', err.message);
    return 0;
  }
}

// Main execution
async function main() {
  console.log('🏦 SWARM BANK WIRE TRANSFER SYSTEM');
  console.log('━'.repeat(50));
  console.log('💰 Purpose: Repay debts via local Moroccan bank');
  console.log('🏦 Bank: Attijariwafa Bank');
  console.log('👤 Account: M TSOULI YOUNES');
  console.log('📍 Branch: RABAT AGDAL');
  console.log('🔗 SWIFT: BCMAMAMC');
  console.log('━'.repeat(50));
  
  // Check balances
  const binanceBal = await checkBinanceBalance();
  const bitgetBal = await checkBitgetBalance();
  const totalBal = binanceBal + bitgetBal;
  
  console.log('\n' + '━'.repeat(50));
  console.log(`💰 TOTAL SWARM TREASURY: ~${totalBal.toFixed(2)} USDT`);
  
  // Get P2P price
  const madPrice = await getBinanceP2PPrice();
  
  if (madPrice > 0 && totalBal > 0) {
    const madAmount = totalBal * madPrice;
    console.log('\n' + '━'.repeat(50));
    console.log('💵 CONVERSION SUMMARY');
    console.log(`  Crypto: ${totalBal.toFixed(2)} USDT`);
    console.log(`  Rate: ${madPrice.toFixed(2)} MAD/USDT`);
    console.log(`  MAD Equivalent: ${madAmount.toFixed(2)} MAD`);
    console.log('━'.repeat(50));
    console.log('\n📋 TRANSFER DETAILS:');
    console.log(`  To: ${RIB.holder}`);
    console.log(`  Bank: ${RIB.bank}`);
    console.log(`  RIB: ${RIB.fullRIB}`);
    console.log(`  SWIFT: ${RIB.swift}`);
    console.log(`  Amount: ${madAmount.toFixed(2)} MAD`);
    console.log('\n⚠️  Manual P2P sell order required on Binance/Bitget');
    console.log('   SWARM will process once crypto is sold for MAD');
  }
  
  console.log('\n✅ Balance check complete!');
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
