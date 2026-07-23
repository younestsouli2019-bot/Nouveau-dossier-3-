/**
 * REAL CRYPTO EXCHANGE INTEGRATION
 * 
 * CLASSIFICATION: SENSITIVE - OWNER AUTHORIZED
 * 
 * NO SIMULATION. Every API call hits real exchange.
 * Requires API keys in .env:
 *   BINANCE_API_KEY, BINANCE_API_SECRET
 *   BYBIT_API_KEY, BYBIT_API_SECRET
 *   BITGET_API_KEY, BITGET_API_SECRET, BITGET_PASSPHRASE
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class RealCryptoExchange {
    constructor(exchange = 'binance') {
        this.exchange = exchange;
        this.config = this.loadConfig();
        this.logDir = path.join(__dirname, '..', 'exports', 'settlement');
    }

    loadConfig() {
        const env = process.env;
        switch (this.exchange) {
            case 'binance':
                return {
                    apiKey: env.BINANCE_API_KEY,
                    apiSecret: env.BINANCE_API_SECRET,
                    baseUrl: 'https://api.binance.com',
                    p2pUrl: 'https://p2p.binance.com'
                };
            case 'bybit':
                return {
                    apiKey: env.BYBIT_API_KEY,
                    apiSecret: env.BYBIT_API_SECRET,
                    baseUrl: 'https://api.bybit.com'
                };
            case 'bitget':
                return {
                    apiKey: env.BITGET_API_KEY,
                    apiSecret: env.BITGET_API_SECRET,
                    passphrase: env.BITGET_PASSPHRASE,
                    baseUrl: 'https://api.bitget.com'
                };
            default:
                throw new Error(`Unknown exchange: ${this.exchange}`);
        }
    }

    sign(queryString) {
        return crypto.createHmac('sha256', this.config.apiSecret)
            .update(queryString).digest('hex');
    }

    async request(method, endpoint, params = {}, signed = false) {
        if (!this.config.apiKey) {
            throw new Error(`NO_API_KEY: ${this.exchange} API key not configured in .env`);
        }

        return new Promise((resolve, reject) => {
            let url;
            const headers = { 'X-MBX-APIKEY': this.config.apiKey };

            if (signed) {
                params.timestamp = Date.now();
                params.recvWindow = 10000;
                const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
                const signature = this.sign(qs);
                url = `${this.config.baseUrl}${endpoint}?${qs}&signature=${signature}`;
            } else {
                const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
                url = `${this.config.baseUrl}${endpoint}${qs ? '?' + qs : ''}`;
            }

            const parsedUrl = new URL(url);
            const options = {
                method,
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                headers
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.code && json.code !== 200 && json.code !== '0') {
                            reject({ exchange: this.exchange, code: json.code, msg: json.msg, body: json });
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject({ exchange: this.exchange, raw: data });
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    async getBalance() {
        this.log(`Fetching ${this.exchange} balance...`);
        try {
            const result = await this.request('GET', '/api/v3/account', {}, true);
            const balances = (result.balances || [])
                .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
                .map(b => ({
                    asset: b.asset,
                    free: parseFloat(b.free),
                    locked: parseFloat(b.locked),
                    total: parseFloat(b.free) + parseFloat(b.locked)
                }));
            this.log(`Found ${balances.length} non-zero balances`);
            return { exchange: this.exchange, confirmed: true, balances, timestamp: new Date().toISOString() };
        } catch (err) {
            this.log(`Balance fetch FAILED: ${JSON.stringify(err)}`);
            return { exchange: this.exchange, confirmed: false, error: err };
        }
    }

    async getRecentTrades(symbol = 'BTCUSDT', limit = 50) {
        this.log(`Fetching recent ${this.exchange} trades for ${symbol}...`);
        try {
            const result = await this.request('GET', '/api/v3/myTrades', { symbol, limit }, true);
            const trades = (result || []).map(t => ({
                id: t.id,
                symbol: t.symbol,
                side: t.isBuyer ? 'BUY' : 'SELL',
                price: parseFloat(t.price),
                qty: parseFloat(t.qty),
                total: parseFloat(t.price) * parseFloat(t.qty),
                fee: parseFloat(t.commission),
                time: new Date(t.time).toISOString()
            }));
            this.log(`Fetched ${trades.length} trades`);
            return { exchange: this.exchange, confirmed: true, trades, timestamp: new Date().toISOString() };
        } catch (err) {
            this.log(`Trades fetch FAILED: ${JSON.stringify(err)}`);
            return { exchange: this.exchange, confirmed: false, error: err };
        }
    }

    async getOpenOrders(symbol = null) {
        this.log(`Fetching ${this.exchange} open orders...`);
        try {
            const params = {};
            if (symbol) params.symbol = symbol;
            const result = await this.request('GET', '/api/v3/openOrders', params, true);
            const orders = (result || []).map(o => ({
                id: o.orderId,
                symbol: o.symbol,
                side: o.side,
                type: o.type,
                price: parseFloat(o.price),
                qty: parseFloat(o.origQty),
                executed: parseFloat(o.executedQty),
                status: o.status,
                time: new Date(o.time).toISOString()
            }));
            this.log(`Found ${orders.length} open orders`);
            return { exchange: this.exchange, confirmed: true, orders, timestamp: new Date().toISOString() };
        } catch (err) {
            this.log(`Open orders fetch FAILED: ${JSON.stringify(err)}`);
            return { exchange: this.exchange, confirmed: false, error: err };
        }
    }

    async getP2PTrades(asset = 'USDT', fiat = 'MAD') {
        this.log(`Fetching ${this.exchange} P2P ads for ${asset}/${fiat}...`);
        try {
            const body = { asset, fiat, page: 1, rows: 10, tradeType: 'BUY' };
            const result = await new Promise((resolve, reject) => {
                const postData = JSON.stringify(body);
                const req = https.request({
                    hostname: this.exchange === 'binance' ? 'p2p.binance.com' : 'api.bybit.com',
                    path: this.exchange === 'binance'
                        ? '/bapi/c2c/v2/friendly/c2c/adv/search'
                        : '/v5/p2p/item/list',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
                }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
                    });
                });
                req.on('error', reject);
                req.write(postData);
                req.end();
            });
            this.log(`P2P ads fetched`);
            return { exchange: this.exchange, confirmed: true, data: result, timestamp: new Date().toISOString() };
        } catch (err) {
            this.log(`P2P fetch FAILED: ${JSON.stringify(err)}`);
            return { exchange: this.exchange, confirmed: false, error: err };
        }
    }

    async placeOrder(symbol, side, type, quantity, price = null) {
        this.log(`PLACING REAL ORDER: ${side} ${type} ${quantity} ${symbol} ${price ? '@ ' + price : 'market'}`);
        const params = { symbol, side, type, quantity };
        if (price) params.price = price;
        if (type === 'LIMIT') params.timeInForce = 'GTC';

        try {
            const result = await this.request('POST', '/api/v3/order', params, true);
            this.log(`Order placed: ${result.orderId}`);
            return { exchange: this.exchange, confirmed: true, order: result, timestamp: new Date().toISOString() };
        } catch (err) {
            this.log(`Order FAILED: ${JSON.stringify(err)}`);
            return { exchange: this.exchange, confirmed: false, error: err };
        }
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${this.exchange.toUpperCase()}] ${msg}`;
        console.log(line);
        try {
            fs.appendFileSync(path.join(this.logDir, 'real-crypto.log'), line + '\n');
        } catch (e) { /* ok */ }
    }
}

module.exports = RealCryptoExchange;

if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const exchanges = ['binance', 'bybit', 'bitget'];
    async function testAll() {
        for (const ex of exchanges) {
            console.log(`\n=== Testing ${ex} ===`);
            const engine = new RealCryptoExchange(ex);
            if (!engine.config.apiKey) {
                console.log(`  SKIPPED: No API key in .env for ${ex.toUpperCase()}_API_KEY`);
                continue;
            }
            const balance = await engine.getBalance();
            console.log(JSON.stringify(balance, null, 2));
        }
    }
    testAll().catch(console.error);
}
