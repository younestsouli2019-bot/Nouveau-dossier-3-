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
  }

  async ensureTimeOffset() {
    if (this._offsetReady) return;
    const { data } = await this.client.time();
    // Calculate offset: how much to add to local time to get server time
    this._timeOffset = data.serverTime - Date.now();
    console.log(`[BinanceClient] Time offset: ${this._timeOffset}ms`);
    this._offsetReady = true;
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
    try {
      await this.ensureTimeOffset();
      // Set correct timestamp for this request
      const ts = Date.now() + this._timeOffset - 2000; // subtract 2s buffer
      const opts = { network, name, recvWindow: 60000, timestamp: ts }; // pass timestamp explicitly
      const res = await this.client.withdraw(coin, address, String(amount), opts);
      return res.data;
    } catch (e) {
      console.error('[BinanceClient] withdraw error:', e.response?.data || e.message);
      throw e;
    }
  }

  _signQuery(params) {
    const qs = new URLSearchParams(params).toString();
    const sig = crypto.createHmac('sha256', String(this.apiSecret || '')).update(qs).digest('hex');
    return { qs, sig };
  }

  async withdrawUsingServerTime({ coin, address, amount, network, name }) {
    const { data: t } = await this.client.time();
    const timestamp = Number(t?.serverTime || Date.now());
    const params = {
      coin: String(coin || 'USDT'),
      address: String(address),
      amount: String(amount),
      network: String(network || 'BSC'),
      name: name ? String(name) : undefined,
      recvWindow: 60000,
      timestamp
    };
    const { qs, sig } = this._signQuery(params);
    const path = `/sapi/v1/capital/withdraw/apply`;
    const body = `${qs}&signature=${sig}`;
    const options = {
      hostname: this.baseURL.replace('https://', ''),
      port: 443,
      path,
      method: 'POST',
      headers: { 'X-MBX-APIKEY': String(this.apiKey || ''), 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(String(data || '{}'));
            if (j && j.code && j.code !== '000000' && j.code !== 200) {
              return reject(new Error(JSON.stringify(j)));
            }
            resolve(j);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async fetchWithdrawalsUsingServerTime(coin = 'USDT', startTime = null) {
    const { data: t } = await this.client.time();
    const timestamp = Number(t?.serverTime || Date.now());
    const params = { coin: String(coin || 'USDT'), timestamp, recvWindow: 60000 };
    if (startTime != null) params.startTime = Number(startTime);
    const { qs, sig } = this._signQuery(params);
    const path = `/sapi/v1/capital/withdraw/history?${qs}&signature=${sig}`;
    const options = {
      hostname: this.baseURL.replace('https://', ''),
      port: 443,
      path,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': String(this.apiKey || '') }
    };
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(String(data || '[]'));
            resolve(Array.isArray(j) ? j : []);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async fetchWithdrawals(coin = 'USDT', since = null) {
    try {
      await this.ensureTimeOffset();
      this.client.timestamp = Date.now() + this._timeOffset - 2000;
      const params = { coin };
      if (since) params.startTime = since;
      const res = await this.client.capital().withdrawHistory(params);
      return res.data || [];
    } catch (e) {
      console.error('[BinanceClient] fetchWithdrawals error:', e.response?.data || e.message);
      return [];
    }
  }
}

export const binanceClient = new BinanceClient()

