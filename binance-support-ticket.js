const crypto = require('crypto');
const fetch = require('node-fetch');

const apiKey = 'YOUR_API_KEY';
const apiSecret = 'YOUR_API_SECRET';
const baseUrl = 'https://api.binance.com';

async function syncServerTime() {
  const res = await fetch(`${baseUrl}/api/v3/time`);
  const j = await res.json();
  return Number(j.serverTime);
}

async function withdraw() {
  const endpoint = '/sapi/v1/capital/withdraw/apply';
  const method = 'POST';
  const params = {
    coin: 'USDT',
    network: 'BSC',
    address: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
    amount: '850',
  };

  const serverTime = await syncServerTime();
  const timestamp = serverTime;
  const recvWindow = 5000;
  const baseParams = { ...params, timestamp, recvWindow };

  const sorted = Object.keys(baseParams)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => [k, baseParams[k]]);

  const queryString = sorted
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

  const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

  const url = `${baseUrl}${endpoint}`;
  const body = `${queryString}&signature=${signature}`;
  const headers = {
    'X-MBX-APIKEY': apiKey,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  console.log('Request URL:', url);
  console.log('Request Body:', body);

  try {
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    console.log('Response:', text);
  } catch (error) {
    console.error('Error:', error);
  }
}

withdraw();
