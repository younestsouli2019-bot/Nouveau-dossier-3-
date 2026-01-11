import { Spot } from '@binance/connector'
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
            this.client = new Spot(apiKey, apiSecret, { baseURL });
            this.client.options = {};
            this._offsetReady = false;
          }

  async ensureTimeOffset() {
    if (this._offsetReady) return;
    const { data } = await this.client.time();
      this.client.timestamp = data.serverTime - 1000;
      this.client.recvWindow = 60000;
      this._offsetReady = true;
  }

  async withdrawUSDTBEP20({ address, amount, name = 'AutonomousSettlement' }) {
    await this.ensureTimeOffset();
    return this.withdraw({
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
      const opts = { network, name, recvWindow: 60000 };
      const res = await this.client.withdraw(coin, address, String(amount), opts);
      return res.data;
    } catch (e) {
      console.error('[BinanceClient] withdraw error:', e.response?.data || e.message);
      throw e;
    }
  }
}

export const binanceClient = new BinanceClient()

