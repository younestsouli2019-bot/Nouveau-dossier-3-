import crypto from 'crypto';

const API_KEY = process.env.BYBIT_API_KEY || '';
const API_SECRET = process.env.BYBIT_API_SECRET || '';
const BASE_URL = process.env.BYBIT_API_BASE || 'https://api.bybit.com';
const COOLDOWN_MS = 65000;

let lastTradeTime = 0;

function sign(method, endpoint, params, timestamp, recvWindow = '5000') {
  if (method === 'POST') {
    const json = JSON.stringify(params);
    const preSign = `${timestamp}${API_KEY}${recvWindow}${json}`;
    const signature = crypto.createHmac('sha256', API_SECRET).update(preSign).digest('hex');
    return { signature, json };
  }
  const sorted = Object.keys(params).sort().map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const preSign = `${timestamp}${API_KEY}${recvWindow}${sorted}`;
  const signature = crypto.createHmac('sha256', API_SECRET).update(preSign).digest('hex');
  return { signature, queryString: sorted };
}

async function apiRequest(method, endpoint, params = {}) {
  await enforceCooldown();

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const { signature, queryString, json } = sign(method, endpoint, params, timestamp, recvWindow);

  const headers = {
    'X-BAPI-API-KEY': API_KEY,
    'X-BAPI-SIGN': signature,
    'X-BAPI-SIGN-TYPE': '2',
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': recvWindow,
  };
  if (method === 'POST' && json) headers['Content-Type'] = 'application/json';

  const url = `${BASE_URL}${endpoint}${method === 'GET' && queryString ? '?' + queryString : ''}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        ...(method === 'POST' && json ? { body: json } : {}),
      });

      if (res.status === 429) {
        console.warn(`Rate limited (attempt ${attempt}). Waiting ${COOLDOWN_MS / 1000}s...`);
        await sleep(COOLDOWN_MS);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const text = await res.text();
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response body');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`JSON parse error: ${parseErr.message}. Raw: ${text.substring(0, 200)}`);
      }

      if (data.retCode !== 0) {
        throw new Error(`Bybit error: ${data.retCode} - ${data.retMsg}`);
      }

      lastTradeTime = Date.now();
      return data;

    } catch (err) {
      if (attempt === 3) throw err;
      const backoff = attempt * 5000;
      console.warn(`Attempt ${attempt} failed: ${err.message}. Retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }
}

async function enforceCooldown() {
  const elapsed = Date.now() - lastTradeTime;
  if (elapsed < COOLDOWN_MS && lastTradeTime > 0) {
    const waitMs = COOLDOWN_MS - elapsed;
    console.log(`Cooldown: waiting ${(waitMs / 1000).toFixed(1)}s...`);
    await sleep(waitMs);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getWalletBalance() {
  return apiRequest('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
}

export async function getTicker(symbol) {
  return apiRequest('GET', '/v5/market/tickers', { category: 'linear', symbol });
}

export async function placeOrder(symbol, side, qty, price) {
  return apiRequest('POST', '/v5/order/create', {
    category: 'linear',
    symbol,
    side,
    orderType: 'Limit',
    qty: String(qty),
    price: String(price),
    timeInForce: 'GTC'
  });
}

export async function cancelOrder(symbol, orderId) {
  return apiRequest('POST', '/v5/order/cancel', {
    category: 'linear',
    symbol,
    orderId
  });
}

export async function getOpenOrders(symbol) {
  return apiRequest('GET', '/v5/order/realtime', { category: 'linear', symbol });
}

export async function healthCheck() {
  try {
    const res = await fetch(`${BASE_URL}/v5/market/time`);
    const text = await res.text();
    if (!text || !res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = JSON.parse(text);
    return { ok: data.retCode === 0, serverTime: data.time };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}