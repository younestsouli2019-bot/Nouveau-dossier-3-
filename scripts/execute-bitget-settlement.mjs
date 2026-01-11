import ccxt from 'ccxt';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

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
    const usdtBalance = balances.free['USDT'];
    log(`Available USDT balance: ${usdtBalance}`);

    if (!usdtBalance || usdtBalance < SETTLEMENT_AMOUNT_USD) {
      const errorMsg = `Insufficient USDT balance (${usdtBalance}) to perform settlement of ${SETTLEMENT_AMOUNT_USD} USDT.`;
      log(errorMsg);
      throw new Error(errorMsg);
    }

    // 2. Execute Withdrawal
    log(`Attempting to withdraw ${SETTLEMENT_AMOUNT_USD} ${TARGET_WALLET.coin} to ${TARGET_WALLET.address} on ${TARGET_WALLET.network}...`);
    
    const withdrawal = await bitget.withdraw(
      TARGET_WALLET.coin,
      SETTLEMENT_AMOUNT_USD,
      TARGET_WALLET.address,
      undefined, // tag/memo is not needed for this address
      {
        network: TARGET_WALLET.network
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
    throw error;
  }
}

executeBitgetWithdrawal();
