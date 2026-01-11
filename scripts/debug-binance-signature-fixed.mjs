import crypto from 'crypto';
import https from 'https';
import 'dotenv/config';

async function getServerTime() {
  return new Promise((resolve, reject) => {
    https.get('https://api.binance.com/api/v3/time', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(String(data || '{}'));
          resolve(Number(j.serverTime || 0));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function binanceRequestFixed(endpoint, params = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const apiKey = (process.env.BINANCE_API_KEY || '').trim();
    const apiSecret = (process.env.BINANCE_API_SECRET || '').trim();

    if (!apiKey || !apiSecret) {
      return reject(new Error("MISSING_BINANCE_KEYS: Cannot execute withdrawal without API keys."));
    }

    // Use exact server timestamp
    const timestamp = params.timestamp || Date.now();
    
    // Create query string without signature first
    const queryParams = { ...params };
    delete queryParams.signature;
    
    const keys = Object.keys(queryParams).sort((a, b) => a.localeCompare(b));
    const queryString = keys.map(key => `${key}=${encodeURIComponent(queryParams[key])}`).join('&');
    
    console.log('DEBUG: Query string for signature:', queryString);
    
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex');

    const fullQuery = `${queryString}&signature=${signature}`;
    
    console.log('DEBUG: Full query with signature:', fullQuery);

    const options = {
      hostname: 'api.binance.com',
      port: 443,
      path: `${endpoint}?${fullQuery}`,
      method: method,
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };
    
    console.log('DEBUG: Request URL:', `https://${options.hostname}${options.path}`);

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('DEBUG: Response status:', res.statusCode);
        console.log('DEBUG: Response data:', data);
        try {
          const json = JSON.parse(data);
          if (json.code && json.code !== 200) {
            reject(new Error(`Binance Error ${json.code}: ${json.msg}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error("Invalid JSON response from Binance"));
        }
      });
    });

    req.on('error', e => reject(e));
    req.end();
  });
}

async function testFixedSignature() {
  console.log('Testing fixed Binance signature...');
  
  try {
    const serverTime = await getServerTime();
    console.log('DEBUG: Server time:', serverTime);
    
    const params = {
      coin: 'USDT',
      network: 'BSC',
      address: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
      amount: 850,
      timestamp: serverTime,
      name: 'AutonomousSettlement',
      recvWindow: 60000
    };
    
    console.log('\nTesting withdrawal request with fixed signature...');
    const result = await binanceRequestFixed('/sapi/v1/capital/withdraw/apply', params, 'POST');
    console.log('Success:', result);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testFixedSignature();