import ccxt from 'ccxt';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.resolve('logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const logFile = path.join(LOGS_DIR, 'bitget-balances.log');

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage);
}

async function checkBitgetBalances() {
  log('--- Checking Bitget Account Balances ---');

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

    // Fetch all balances
    log('Fetching account balances...');
    const balances = await bitget.fetchBalance();
    
    log('Available Balances (free):');
    for (const [currency, amount] of Object.entries(balances.free)) {
      if (amount > 0) {
        log(`  ${currency}: ${amount}`);
      }
    }

    log('Total Balances:');
    for (const [currency, amount] of Object.entries(balances.total)) {
      if (amount > 0) {
        log(`  ${currency}: ${amount}`);
      }
    }

    log('--- Balance Check Complete ---');
    
  } catch (error) {
    const errorMsg = `Balance check failed: ${error.message}`;
    log(errorMsg);
    console.error('❌ Balance check failed. See logs/bitget-balances.log for details.');
    throw error;
  }
}

checkBitgetBalances().catch(console.error);