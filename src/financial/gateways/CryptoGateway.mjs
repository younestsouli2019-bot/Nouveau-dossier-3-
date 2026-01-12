import ccxt from 'ccxt';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { binanceClient } from '../../crypto/binance-client.mjs';

async function getBitgetServerTime() {
  return new Promise((resolve, reject) => {
    https.get('https://api.bitget.com/api/spot/v1/public/time', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(Number(j.data || 0));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function withdrawUSDTBEP20(address, amount) {
  try {
    const withdrawal = await binanceClient.withdrawUSDTBEP20({ address, amount });
    return withdrawal;
  } catch (e) {
    throw new Error(`Binance withdrawal failed: ${e.message}`);
  }
}

async function withdrawUSDTBybit(address, amount, network = 'ERC20') {
  const bybit = new ccxt.bybit({
    apiKey: process.env.BYBIT_API_KEY,
    secret: process.env.BYBIT_API_SECRET,
    options: { adjustForTimeDifference: true },
  });

  try {
    // Manually sync time if needed (local clock drift workaround)
    const serverTime = await bybit.fetchTime();
    const diff = Date.now() - serverTime;
    if (Math.abs(diff) > 5000) {
        bybit.options['timeDifference'] = diff;
    }

    // Bybit network parameter might need mapping, e.g., 'ETH', 'BSC', 'TRX'
    // CCXT usually handles standard network codes, but we should be careful.
    // Passing network in params is the standard CCXT way for many exchanges.
    const params = { network }; 
    const withdrawal = await bybit.withdraw('USDT', amount, address, undefined, params);
    return withdrawal;
  } catch (e) {
    throw new Error(`Bybit withdrawal failed: ${e.message}`);
  }
}

async function listWithdrawals(startTime) {
  const since = startTime != null ? Number(startTime) : undefined;
  try {
    const rows = await binanceClient.fetchWithdrawals('USDT', since);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    // If history fetch fails (e.g., creds/time), return empty array to avoid crashing polling loops
    return [];
  }
}

export class CryptoGateway {
  async executeTransfer(transactions, { provider = 'binance' } = {}) {
    const enabled = String(process.env.CRYPTO_WITHDRAW_ENABLE || '').toLowerCase() === 'true';
    const network = 'BEP20';
    const prepared_at = new Date().toISOString();
    const dest = transactions[0]?.destination;
    const amount = transactions[0]?.amount;
    if (!dest || !amount) return { status: 'invalid', reason: 'missing_destination_or_amount' };
    const bitgetCreds = { apiKey: process.env.BITGET_API_KEY, secret: process.env.BITGET_API_SECRET, passphrase: process.env.BITGET_PASSPHRASE };
    const bybitCreds = { apiKey: process.env.BYBIT_API_KEY, secret: process.env.BYBIT_API_SECRET };

    function mapBitgetChain(raw) {
      const v = String(raw || '').trim().toLowerCase();
      if (v === 'bep20' || v === 'bsc') return 'BSC';
      if (v === 'erc20' || v === 'eth') return 'ETH';
      if (v === 'trc20' || v === 'tron') return 'TRON';
      return raw || 'bep20';
    }

    async function bitgetRequest(method, requestPath, bodyObj, creds) {
      const base = 'api.bitget.com';
      const ts = String(Date.now());
      const body = bodyObj ? JSON.stringify(bodyObj) : '';
      const prehash = ts + method.toUpperCase() + requestPath + body;
      const sig = crypto.createHmac('sha256', String(creds.secret || '')).update(prehash).digest('base64');
      const options = {
        hostname: base,
        port: 443,
        path: requestPath,
        method,
        headers: {
          'ACCESS-KEY': String(creds.apiKey || ''),
          'ACCESS-SIGN': sig,
          'ACCESS-PASSPHRASE': String(creds.passphrase || ''),
          'ACCESS-TIMESTAMP': ts,
          'locale': 'en-US',
          'Content-Type': 'application/json'
        }
      };
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

    if (provider === 'binance') {
      if (!enabled) {
        return { status: 'prepared', provider, network, prepared_at, transactions };
      }
      const hasBinanceCreds = !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET);
      if (!hasBinanceCreds) {
        return { status: 'MISSING_CREDENTIALS', provider, network, prepared_at };
      }
      const r = await withdrawUSDTBEP20(dest, amount);
      const applyId = r.id || r.applyId || null;
      let txId = null;
      const startTime = Date.now() - 60 * 60 * 1000;
      for (let i = 0; i < 3 && !txId; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          const hist = await listWithdrawals(startTime);
          if (Array.isArray(hist)) {
            // Prefer matching by id if available
            let m = null;
            if (applyId) {
              m = hist.find((h) => String(h.id || h.applyId || '') === String(applyId));
            }
            if (!m) {
              const addrMatch = String(dest).toLowerCase();
              const tol = 1e-6;
              m = hist.find((h) => String(h.address || '').toLowerCase() === addrMatch && Math.abs(Number(h.amount) - Number(amount)) < tol);
            }
            if (m && (m.txid || m.txId)) txId = m.txid || m.txId;
          }
        } catch {}
      }
      if (!txId) return { status: 'submitted', applyId, provider, network, prepared_at };
      return { status: 'submitted_with_tx', applyId, txHash: txId, provider, network, prepared_at };
    }

    if (provider === 'bybit') {
      const hasCreds = !!(bybitCreds.apiKey && bybitCreds.secret);
      const network = transactions[0]?.network || 'ERC20'; // Try to get network from transaction, default to ERC20

      if (enabled && hasCreds) {
        try {
           const r = await withdrawUSDTBybit(dest, amount, network);
           return { 
             status: 'submitted', 
             applyId: r.id, 
             provider: 'bybit', 
             network, 
             prepared_at, 
             txHash: r.txid || null 
           };
        } catch (e) {
           console.error('Bybit withdrawal failed, falling back to manual:', e.message);
           // Fallback to manual
        }
      }

      const outDir = 'settlements/crypto';
      const filename = `bybit_instruction_${Date.now()}.json`;
      const filePath = path.join(process.cwd(), outDir, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ provider: 'bybit', action: 'withdraw', coin: 'USDT', network: (transactions[0]?.network || 'ERC20'), address: dest, amount, status: 'WAITING_MANUAL_EXECUTION', creds_present: !!(bybitCreds.apiKey && bybitCreds.secret), origin: 'in_house' }, null, 2)
      );
      return { status: 'INSTRUCTIONS_READY', provider: 'bybit', filePath, network: (transactions[0]?.network || 'ERC20'), prepared_at, creds_present: !!(bybitCreds.apiKey && bybitCreds.secret) };
    }

    if (provider === 'bitget') {
      const hasCreds = !!(bitgetCreds.apiKey && bitgetCreds.secret && bitgetCreds.passphrase);
      const preferredRaw = String(process.env.BITGET_CHAIN || 'bep20');
      const preferredChainApi = mapBitgetChain(preferredRaw);
      const preferredNetworkLabel = (preferredChainApi === 'BSC' ? 'BEP20' : preferredChainApi).toUpperCase();
      if (enabled && hasCreds) {
        const tryChains = Array.from(new Set([preferredChainApi, 'BSC', 'ETH', 'TRON']));
        for (const chain of tryChains) {
          const label = (chain === 'BSC' ? 'BEP20' : chain).toUpperCase();
          const payloadV2 = { coin: 'USDT', transferType: 'on_chain', address: dest, chain, size: String(amount) };
          try {
            const r2 = await bitgetRequest('POST', '/api/v2/spot/wallet/withdrawal', payloadV2, bitgetCreds);
            if (r2 && r2.code === '00000') {
              return { status: 'submitted', provider: 'bitget', network: label, prepared_at, applyId: r2?.data?.orderId || null };
            }
          } catch {}
          const payloadV1 = { coin: 'USDT', address: dest, chain, amount: String(amount) };
          try {
            const r1 = await bitgetRequest('POST', '/api/spot/v1/wallet/withdrawal', payloadV1, bitgetCreds);
            if (r1 && r1.code === '00000') {
              return { status: 'submitted', provider: 'bitget', network: label, prepared_at, applyId: r1?.data?.orderId || null };
            }
          } catch {}
        }
      }
      const outDir = 'settlements/crypto';
      const filename = `bitget_instruction_${Date.now()}.json`;
      const filePath = path.join(process.cwd(), outDir, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ provider: 'bitget', action: 'withdraw', coin: 'USDT', network: preferredNetworkLabel, address: dest, amount, status: 'WAITING_MANUAL_EXECUTION', creds_present: hasCreds, origin: 'in_house' }, null, 2)
      );
      return { status: 'INSTRUCTIONS_READY', provider: 'bitget', filePath, network: preferredNetworkLabel, prepared_at, creds_present: hasCreds };
    }

    if (provider === 'trust') {
      return { status: 'QUEUED', provider: 'trust', reason: 'NO_PRIVATE_KEYS_ALLOWED', network, prepared_at };
    }

    if (provider === 'mexc') {
      const creds = { apiKey: process.env.MEXC_API_KEY, secret: process.env.MEXC_API_SECRET };
      const hasCreds = !!(creds.apiKey && creds.secret);
      const nx = (transactions[0]?.network || 'ERC20').toUpperCase();
      const label = nx === 'BSC' ? 'BEP20' : nx;
      if (enabled && hasCreds) {
        try {
          const mexc = new ccxt.mexc({ apiKey: creds.apiKey, secret: creds.secret, options: { adjustForTimeDifference: true } });
          const params = { network: nx };
          const r = await mexc.withdraw('USDT', amount, dest, undefined, params);
          return { status: 'submitted', provider: 'mexc', network: label, prepared_at, applyId: r?.id || null, txHash: r?.txid || null };
        } catch (e) {}
      }
      const outDir = 'settlements/crypto';
      const filename = `mexc_instruction_${Date.now()}.json`;
      const filePath = path.join(process.cwd(), outDir, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ provider: 'mexc', action: 'withdraw', coin: 'USDT', network: nx, address: dest, amount, status: 'WAITING_MANUAL_EXECUTION', creds_present: hasCreds, origin: 'in_house' }, null, 2)
      );
      return { status: 'INSTRUCTIONS_READY', provider: 'mexc', filePath, network: nx, prepared_at, creds_present: hasCreds };
    }
    return { status: 'UNKNOWN_PROVIDER', provider, network, prepared_at };
  }
  async getWithdrawalStatus({ provider = 'binance', address, amount, startTime } = {}) {
    if (provider === 'binance') {
      try {
        const hist = await listWithdrawals(startTime ?? Date.now() - 7 * 24 * 60 * 60 * 1000);
        if (!Array.isArray(hist)) return { status: 'unknown', provider };
        const m = hist.find((h) => String(h.address || '').toLowerCase() === String(address || '').toLowerCase() && (amount == null || Number(h.amount) === Number(amount)));
        if (!m) return { status: 'not_found', provider };
        return {
          status: String(m.status || '').toLowerCase() || 'unknown',
          txId: m.txId || null,
          id: m.id || m.applyId || null,
          coin: m.coin || 'USDT',
          network: m.network || 'BEP20'
        };
      } catch (e) {
        return { status: 'error', error: e?.message || String(e), provider };
      }
    }
    return { status: 'unsupported_provider', provider };
  }
}
