import { Spot } from '@binance/connector'
import https from 'node:https'
import crypto from 'node:crypto'
import 'dotenv/config'

/**
 * BinanceClient using official @binance/connector with server time offset
 * corrections to avoid -1021 (timestamp ahead) and -1022 (signature) issues.
 */
export class BinanceClient {
  constructor({
    apiKey = process.env.BINANCE_API_KEY,
    apiSecret = process.env.BINANCE_API_SECRET,
    baseURL = process.env.BINANCE_API_BASE || 'https://api.binance.com'
  } = {}) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseURL = baseURL;
    this.client = new Spot(apiKey, apiSecret, { baseURL });
    this._offsetReady = false;
    this._timeOffset = 0;
    this._lastSync = 0;
  }

  async ensureTimeOffset(force = false) {
    const now = Date.now();
    if (!force && this._offsetReady && now - this._lastSync < 180000) return;
    const { data } = await this.client.time();
    this._timeOffset = Number(data?.serverTime || now) - now;
    this._lastSync = now;
    this._offsetReady = true;
  }

  ms() {
    return Date.now() + (this._timeOffset || 0);
  }

  async withdrawUSDTBEP20({ address, amount, name = 'AutonomousSettlement' }) {
    return this.withdrawUsingServerTime({
      coin: 'USDT',
      address,
      amount,
      network: 'BSC',
      name
    });
  }

  async withdraw({ coin, address, amount, network, name }) {
    await this.ensureTimeOffset();
    const params = {
      coin: String(coin || 'USDT'),
      address: String(address),
      amount: String(amount),
      network: String(network || 'BSC'),
      name: name ? String(name) : undefined,
      recvWindow: 60000,
      timestamp: this.ms()
    };
    try {
      const r = await this._robustPost('/sapi/v1/capital/withdraw/apply', params);
      return r;
    } catch (e) {
      throw e;
    }
  }

  _signQuery(params) {
    const qs = new URLSearchParams(params).toString();
    const sig = crypto.createHmac('sha256', String(this.apiSecret || '')).update(qs).digest('hex');
    return { qs, sig };
  }

  async withdrawUsingServerTime({ coin, address, amount, network, name }) {
    await this.ensureTimeOffset(true);
    const params = {
      coin: String(coin || 'USDT'),
      address: String(address),
      amount: String(amount),
      network: String(network || 'BSC'),
      name: name ? String(name) : undefined,
      recvWindow: 60000,
      timestamp: this.ms()
    };
    return this._robustPost('/sapi/v1/capital/withdraw/apply', params);
  }

  async fetchWithdrawalsUsingServerTime(coin = 'USDT', startTime = null) {
    await this.ensureTimeOffset(true);
    const params = { coin: String(coin || 'USDT'), timestamp: this.ms(), recvWindow: 60000 };
    if (startTime != null) params.startTime = Number(startTime);
    return this._robustGet('/sapi/v1/capital/withdraw/history', params);
  }

  async fetchWithdrawals(coin = 'USDT', since = null) {
    try {
      await this.ensureTimeOffset();
      const params = { coin: String(coin || 'USDT'), timestamp: this.ms(), recvWindow: 60000 };
      if (since) params.startTime = Number(since);
      const out = await this._robustGet('/sapi/v1/capital/withdraw/history', params);
      return Array.isArray(out) ? out : [];
    } catch {
      return [];
    }
  }

  _signQuery(params) {
    const qs = new URLSearchParams(params).toString();
    const sig = crypto.createHmac('sha256', String(this.apiSecret || '')).update(qs).digest('hex');
    return { qs, sig };
  }

  async _robustPost(path, params) {
    const p1 = { ...params, timestamp: this.ms(), recvWindow: Number(params.recvWindow || 60000) };
    const { qs, sig } = this._signQuery(p1);
    const body = `${qs}&signature=${sig}`;
    const options = {
      hostname: this.baseURL.replace('https://', ''),
      port: 443,
      path,
      method: 'POST',
      headers: { 'X-MBX-APIKEY': String(this.apiKey || ''), 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const res1 = await this._request(options, body);
    const msg = String(res1?.msg || res1?.message || '');
    if (msg.includes('-1021')) {
      await this.ensureTimeOffset(true);
      const p2 = { ...params, timestamp: this.ms(), recvWindow: Number(params.recvWindow || 60000) };
      const s2 = this._signQuery(p2);
      const b2 = `${s2.qs}&signature=${s2.sig}`;
      return this._request({ ...options, headers: { ...options.headers, 'Content-Length': Buffer.byteLength(b2) } }, b2);
    }
    if (msg.includes('-1022')) {
      const p3 = { ...params, timestamp: this.ms(), recvWindow: Number(params.recvWindow || 60000) };
      const s3 = this._signQuery(p3);
      const b3 = `${s3.qs}&signature=${s3.sig}`;
      return this._request({ ...options, headers: { ...options.headers, 'Content-Length': Buffer.byteLength(b3) } }, b3);
    }
    return res1;
  }

  async _robustGet(path, params) {
    const p1 = { ...params, timestamp: this.ms(), recvWindow: Number(params.recvWindow || 60000) };
    const { qs, sig } = this._signQuery(p1);
    const options = {
      hostname: this.baseURL.replace('https://', ''),
      port: 443,
      path: `${path}?${qs}&signature=${sig}`,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': String(this.apiKey || '') }
    };
    const res1 = await this._request(options);
    const msg = String(res1?.msg || res1?.message || '');
    if (msg.includes('-1021')) {
      await this.ensureTimeOffset(true);
      const p2 = { ...params, timestamp: this.ms(), recvWindow: Number(params.recvWindow || 60000) };
      const s2 = this._signQuery(p2);
      return this._request({ ...options, path: `${path}?${s2.qs}&signature=${s2.sig}` });
    }
    if (msg.includes('-1022')) {
      const p3 = { ...params, timestamp: this.ms(), recvWindow: Number(params.recvWindow || 60000) };
      const s3 = this._signQuery(p3);
      return this._request({ ...options, path: `${path}?${s3.qs}&signature=${s3.sig}` });
    }
    return res1;
  }

  _request(options, body = null) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(String(data || '{}'));
            resolve(j);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

export const binanceClient = new BinanceClient()

