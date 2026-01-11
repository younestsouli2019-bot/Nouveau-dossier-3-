import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import { binanceClient } from '../src/crypto/binance-client.mjs';
import 'dotenv/config';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------

const TARGET_WALLET = {
  address: process.env.OWNER_CRYPTO_BEP20,
  network: 'BSC', // BEP20
  coin: 'USDT'
};

if (!TARGET_WALLET.address) {
  throw new Error("OWNER_CRYPTO_BEP20 not set in environment. Please set OWNER_CRYPTO_BEP20 in your .env or CREDS.txt");
}

const BATCH_ID = process.argv[2];
const RECEIPTS_DIR = path.resolve('exports/receipts');
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const PROVIDER_HIERARCHY = ['binance', 'bybit', 'bitget'];

// ... (rest of the configuration)

// ------------------------------------------------------------------
// EXCHANGE API (CCXT IMPLEMENTATION)
// ------------------------------------------------------------------

async function getExchange(provider) {
  const apiKey = process.env[`${provider.toUpperCase()}_API_KEY`];
  const secret = process.env[`${provider.toUpperCase()}_API_SECRET`];
  const passphrase = process.env[`${provider.toUpperCase()}_PASSPHRASE`]; // For exchanges like Bitget

  if (!apiKey || !secret) {
    // This is not a fatal error, just a missing configuration for one provider
    return null;
  }

  const exchangeClass = ccxt[provider.toLowerCase()];
  if (!exchangeClass) throw new Error(`Unsupported provider: ${provider}`);

  const exchange = new exchangeClass({
    apiKey: apiKey,
    secret: secret,
    password: passphrase, // CCXT uses 'password' for API passphrase
    options: { adjustForTimeDifference: true }
  });

  return exchange;
}

async function attemptWithdrawal({ address, amount, coin = 'USDT', network = 'BSC' }) {
  // 1) Try Binance first (low-level client – proven auth)
  if (binanceClient) {
    try {
      console.log('\nAttempting withdrawal with [binance] (low-level client)...');
      await binanceClient.ensureTimeOffset();
      const res = await binanceClient.withdrawUSDTBEP20({ address, amount });
      console.log('✅ Binance withdrawal submitted:', res);
      return { provider: 'binance', id: res.id };
    } catch (e) {
      console.warn('⚠️  Binance failed:', e.message);
    }
  } else {
    console.log('- Binance skipped: keys missing');
  }

  // 2) Fallback to CCXT exchanges if needed
  const ccxtProviders = ['bybit', 'bitget'];
  for (const p of ccxtProviders) {
    const Exchange = (await import('ccxt'))[p];   // dynamic import
    if (!Exchange) continue;
    const apiKey = process.env[`${p.toUpperCase()}_API_KEY`];
    const secret = process.env[`${p.toUpperCase()}_API_SECRET`];
    const passphrase = process.env[`${p.toUpperCase()}_PASSPHRASE`];
    if (!apiKey || !secret) { console.log(`- ${p} skipped: keys missing`); continue; }
    const exchange = new Exchange({ apiKey, secret, password: passphrase, options: { adjustForTimeDifference: true } });
    try {
      console.log(`\nAttempting withdrawal with [${p}] (CCXT)...`);
      const params = p === 'bybit' ? { chain: network } : { network };
      const r = await exchange.withdraw(coin, amount, address, undefined, params);
      console.log(`✅ ${p} withdrawal submitted:`, r);
      return { provider: p, id: r.id || r.withdrawId };
    } catch (e) {
      console.warn(`⚠️  ${p} failed:`, e.message);
    }
  }

  // FINAL FALLBACK: Generate manual instructions
  const outDir = path.resolve('settlements/crypto');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filename = `manual_withdrawal_${BATCH_ID || Date.now()}.json`;
  const filePath = path.join(outDir, filename);
  const instruction = {
    action: 'withdraw',
    amount,
    coin,
    address,
    network,
    reason: 'ALL_API_PROVIDERS_FAILED',
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(filePath, JSON.stringify(instruction, null, 2));
  console.log(`\n🚨 ALL PROVIDERS FAILED. Manual instruction file generated at: ${filePath}`);
  
  throw new Error('WITHDRAWAL_FAILED_ALL_PROVIDERS');
}

// ------------------------------------------------------------------
// MAIN EXECUTION FLOW
// ------------------------------------------------------------------


const LEDGER_PATH = path.resolve('data/financial/settlement_ledger.json');

function loadLedger() {
  if (fs.existsSync(LEDGER_PATH)) {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  }
  return { transactions: [] };
}

function updateLedger(ledger) {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

async function run() {
  console.log(`\n💰 EXECUTING AUTONOMOUS CRYPTO SETTLEMENT (BATCH: ${BATCH_ID || 'AUTO'})`);
  console.log('🔒 SECURITY MODE: PROOF-OF-SETTLEMENT (NO PRIVATE KEYS)');

  const enable = String(process.env.CRYPTO_WITHDRAW_ENABLE || '').toLowerCase() === 'true';
  if (!enable) {
    console.error("❌ CRYPTO_WITHDRAW_ENABLE not set to true. Aborting.");
    process.exit(1);
  }

  const ledger = loadLedger();
  let transactionsToProcess = [];

  if (BATCH_ID) {
    const tx = ledger.transactions.find(t => t.id === BATCH_ID);
    if (tx) transactionsToProcess.push(tx);
    else console.warn(`⚠️ Batch ID ${BATCH_ID} not found in ledger.`);
  } else {
    transactionsToProcess = ledger.transactions.filter(t => 
      ['BINANCE_API', 'BYBIT_API'].includes(t.channel) && 
      ['prepared', 'INSTRUCTIONS_READY'].includes(t.status)
    );
  }

  if (transactionsToProcess.length === 0) {
    console.log("ℹ️  No pending crypto settlements found.");
    return;
  }

  console.log(`\n📋 Found ${transactionsToProcess.length} pending transactions.`);

  for (const tx of transactionsToProcess) {
    console.log(`\n🔄 Processing Transaction: ${tx.id} (${tx.channel})`);
    
    try {
      // Determine withdrawal details from the transaction
      let amount, address, network;
      if (tx.channel === 'BYBIT_API' && tx.details.filePath && fs.existsSync(tx.details.filePath)) {
        const instruction = JSON.parse(fs.readFileSync(tx.details.filePath, 'utf8'));
        amount = instruction.amount;
        address = instruction.address;
        network = instruction.network === 'ERC20' ? 'ETH' : (instruction.network === 'BEP20' ? 'BSC' : instruction.network);
      } else {
        amount = tx.details.transactions?.[0]?.amount || tx.amount;
        address = tx.details.transactions?.[0]?.destination || tx.details.destination;
        network = tx.details.network || 'BSC';
      }

      if (!amount || !address) {
        throw new Error("Missing amount or address for withdrawal.");
      }

      console.log(`\nInitiating withdrawal of ${amount} USDT to ${address} on ${network}`);
      const result = await attemptWithdrawal({ address, amount, network });
      
      // Update Ledger Status to PENDING/SUBMITTED
      tx.status = 'SUBMITTED';
      tx.details.withdrawId = result.id;
      tx.details.submitted_at = new Date().toISOString();
      tx.details.submitted_via = result.provider; // Track which provider was successful
      updateLedger(ledger);

      // Create Receipt
      const receiptPath = path.join(RECEIPTS_DIR, `crypto_settlement_${tx.id}_submitted.json`);
      const receipt = {
        timestamp: new Date().toISOString(),
        batch_id: tx.id,
        amount: amount,
        currency: 'USDT',
        network: network,
        destination: address,
        withdraw_id: result.id,
        status: 'SUBMITTED',
        method: result.provider.toUpperCase() + '_API'
      };
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
      console.log(`📝 Submission recorded: ${receiptPath}`);

    } catch (e) {
      console.error(`❌ TRANSACTION FAILED: ${e.message}`);
      // Don't exit, try next transaction
    }
  }
}

run();

