import ccxt from 'ccxt';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { parseArgs } from '../src/utils/cli.mjs';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SETTLEMENT_AMOUNT_USD = 850;
const TARGET_WALLET = {
  address: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
  network: 'BEP20', // BSC in ccxt terms
  coin: 'USDT'
};

const LOGS_DIR = path.resolve('logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const logFile = path.join(LOGS_DIR, 'bitget-settlement.log');
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage);
}

// ============================================================================
// BITGET API (REAL EXECUTION VIA CCXT)
// ============================================================================

async function executeBitgetWithdrawal() {
  log('--- Starting Bitget Settlement Execution ---');
  const args = parseArgs(process.argv);

  const apiKey = process.env.BITGET_API_KEY;
  const secret = process.env.BITGET_API_SECRET;
  const password = process.env.BITGET_PASSPHRASE;

  if (!apiKey || !secret || !password) {
    const errorMsg = "CRITICAL: Missing Bitget API credentials in .env file. Cannot proceed.";
    log(errorMsg);
    throw new Error(errorMsg);
  }

  const bitget = new ccxt.bitget({
    apiKey,
    secret,
    password,
    enableRateLimit: true,
  });

  try {
    // Sync time with the server to prevent timestamp errors
    log('Syncing time with Bitget server...');
    await bitget.loadTimeDifference();
    log('Time synced successfully.');

    // 1. Check Balance
    log('Fetching account balances...');
    const balances = await bitget.fetchBalance();
    const coin = String(args.coin || TARGET_WALLET.coin).toUpperCase();
    const network = String(args.network || TARGET_WALLET.network).toUpperCase();
    const address = String(args.address || TARGET_WALLET.address);
    const amount = args.amount ? Number(args.amount) : (coin === 'USDT' ? SETTLEMENT_AMOUNT_USD : 0.1);
    const available = balances.free[coin];
    log(`Available ${coin} balance: ${available}`);

    if (!available || available < amount) {
      const errorMsg = `Insufficient ${coin} balance (${available}) to perform settlement of ${amount} ${coin}.`;
      log(errorMsg);
      throw new Error(errorMsg);
    }

    // 2. Execute Withdrawal
    log(`Attempting to withdraw ${amount} ${coin} to ${address} on ${network}...`);
    
    const withdrawal = await bitget.withdraw(
      coin,
      amount,
      address,
      undefined, // tag/memo is not needed for this address
      {
        network
      }
    );

    log('Withdrawal request successful!');
    log(`  - Transaction ID: ${withdrawal.id}`);
    log(`  - Amount: ${withdrawal.amount}`);
    log(`  - Address: ${withdrawal.address}`);
    log('--- Bitget Settlement Execution Finished ---');
    
    console.log('✅ Bitget withdrawal initiated successfully. See logs/bitget-settlement.log for details.');
    console.log(JSON.stringify(withdrawal, null, 2));


  } catch (error) {
    const errorMsg = `Bitget settlement failed: ${error.message}`;
    log(errorMsg);
    console.error('❌ Bitget settlement failed. See logs/bitget-settlement.log for details.');
    try {
      const args = parseArgs(process.argv);
      const coin = String(args.coin || TARGET_WALLET.coin).toUpperCase();
      const network = String(args.network || TARGET_WALLET.network).toUpperCase();
      const address = String(args.address || TARGET_WALLET.address);
      const amount = args.amount ? Number(args.amount) : (coin === 'USDT' ? SETTLEMENT_AMOUNT_USD : 0.1);
      const outDir = path.resolve('settlements/crypto');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, `bitget_instruction_${Date.now()}.json`);
      const payload = {
        provider: 'bitget',
        action: 'withdraw',
        coin,
        network,
        address,
        amount,
        status: 'WAITING_MANUAL_EXECUTION',
        creds_present: !!(process.env.BITGET_API_KEY && process.env.BITGET_API_SECRET && process.env.BITGET_PASSPHRASE),
        origin: 'in_house'
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
      log(`Manual instruction queued at: ${filePath}`);
    } catch {}
    throw error;
  }
}

executeBitgetWithdrawal();
