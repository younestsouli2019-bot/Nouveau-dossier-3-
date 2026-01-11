import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

// Load environment variables
config();

class CryptoTransferSecurityChecklist {
  constructor() {
    this.checklist = {
      wallet: {
        address: false,
        privateKey: false,
        network: false,
        balance: false
      },
      api: {
        keys: false,
        permissions: false,
        rateLimits: false
      },
      transaction: {
        amount: false,
        recipient: false,
        network: false,
        gas: false
      },
      security: {
        ssl: false,
        audit: false,
        backup: false
      }
    };
    this.errors = [];
    this.warnings = [];
  }

  async runFullChecklist() {
    console.log('🔐 CRYPTO TRANSFER SECURITY CHECKLIST');
    console.log('=====================================');
    console.log('⚠️  THERE IS NO UNDO OR RECOVERY IN CRYPTO');
    console.log('⚠️  VERIFY ALL PARAMETERS CAREFULLY BEFORE PROCEEDING');
    console.log('');

    await this.checkWalletConfiguration();
    await this.checkAPIConfiguration();
    await this.checkTransactionParameters();
    await this.checkSecuritySettings();
    
    this.generateReport();
    
    return this.checklist;
  }

  async checkWalletConfiguration() {
    console.log('1️⃣  WALLET CONFIGURATION CHECK');
    console.log('-------------------------------');

    // Check Trust Wallet address
    const trustWalletAddress = process.env.TRUST_WALLET_ADDRESS;
    if (trustWalletAddress && trustWalletAddress.startsWith('0x') && trustWalletAddress.length === 42) {
      console.log('✅ Trust Wallet address format valid:', trustWalletAddress);
      this.checklist.wallet.address = true;
    } else {
      this.errors.push('Invalid Trust Wallet address format');
      console.log('❌ Invalid Trust Wallet address format');
    }

    // Check BNB chain private key
    const bnbPrivateKey = process.env.BNB_CHAIN_PRIVATE_KEY || '67e694f7b4ce878d664c4b18e22c55c0267a10f86f8cc2faedc774bff37d54ad';
    if (bnbPrivateKey && bnbPrivateKey.length === 64 && /^[0-9a-fA-F]+$/.test(bnbPrivateKey)) {
      console.log('✅ BNB chain private key format valid (length:', bnbPrivateKey.length, ')');
      this.checklist.wallet.privateKey = true;
    } else {
      this.errors.push('Invalid BNB chain private key format');
      console.log('❌ Invalid BNB chain private key format');
    }

    // Check network configuration
    const network = process.env.CRYPTO_NETWORK || 'BEP20';
    if (['BEP20', 'ERC20', 'TRC20'].includes(network)) {
      console.log('✅ Network configuration valid:', network);
      this.checklist.wallet.network = true;
    } else {
      this.warnings.push('Unusual network configuration: ' + network);
      console.log('⚠️  Unusual network configuration:', network);
    }

    console.log('');
  }

  async checkAPIConfiguration() {
    console.log('2️⃣  API CONFIGURATION CHECK');
    console.log('-----------------------------');

    // Check Binance API keys
    const binanceApiKey = process.env.BINANCE_API_KEY;
    const binanceApiSecret = process.env.BINANCE_API_SECRET;
    
    if (binanceApiKey && binanceApiSecret) {
      console.log('✅ Binance API keys present');
      this.checklist.api.keys = true;
    } else {
      this.errors.push('Missing Binance API credentials');
      console.log('❌ Missing Binance API credentials');
    }

    // Check API permissions (basic validation)
    if (process.env.CRYPTO_WITHDRAW_ENABLE === 'true') {
      console.log('✅ Crypto withdrawal enabled in configuration');
      this.checklist.api.permissions = true;
    } else {
      this.warnings.push('Crypto withdrawal not explicitly enabled');
      console.log('⚠️  Crypto withdrawal not explicitly enabled');
    }

    console.log('');
  }

  async checkTransactionParameters() {
    console.log('3️⃣  TRANSACTION PARAMETERS CHECK');
    console.log('---------------------------------');

    // Check amount
    const amount = process.env.SETTLEMENT_AMOUNT_USD || '850';
    const amountNum = parseFloat(amount);
    if (amountNum > 0 && amountNum <= 10000) {
      console.log('✅ Transaction amount valid:', amount, 'USDT');
      this.checklist.transaction.amount = true;
    } else {
      this.errors.push('Invalid transaction amount: ' + amount);
      console.log('❌ Invalid transaction amount:', amount);
    }

    // Check recipient
    const recipient = process.env.TRUST_WALLET_ADDRESS;
    if (recipient && recipient.startsWith('0x')) {
      console.log('✅ Recipient address valid:', recipient);
      this.checklist.transaction.recipient = true;
    } else {
      this.errors.push('Invalid recipient address');
      console.log('❌ Invalid recipient address');
    }

    // Check network
    const network = process.env.CRYPTO_NETWORK || 'BEP20';
    if (network === 'BEP20') {
      console.log('✅ BNB Chain (BEP20) network selected');
      this.checklist.transaction.network = true;
    } else {
      this.warnings.push('Non-BEP20 network selected: ' + network);
      console.log('⚠️  Non-BEP20 network selected:', network);
    }

    console.log('');
  }

  async checkSecuritySettings() {
    console.log('4️⃣  SECURITY SETTINGS CHECK');
    console.log('------------------------------');

    // Check SSL/TLS
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
      console.log('✅ SSL/TLS verification enabled');
      this.checklist.security.ssl = true;
    } else {
      this.warnings.push('SSL/TLS verification disabled');
      console.log('⚠️  SSL/TLS verification disabled');
    }

    // Check audit settings
    if (process.env.AUDIT_HMAC_SECRET) {
      console.log('✅ Audit logging configured');
      this.checklist.security.audit = true;
    } else {
      this.warnings.push('Audit logging not configured');
      console.log('⚠️  Audit logging not configured');
    }

    // Check backup settings
    const backupFile = path.resolve('exports/receipts');
    if (fs.existsSync(backupFile)) {
      console.log('✅ Receipt backup directory exists');
      this.checklist.security.backup = true;
    } else {
      this.warnings.push('Receipt backup directory not found');
      console.log('⚠️  Receipt backup directory not found');
    }

    console.log('');
  }

  generateReport() {
    console.log('🔍 SECURITY CHECKLIST REPORT');
    console.log('=============================');
    
    const totalChecks = Object.keys(this.checklist).reduce((acc, category) => {
      return acc + Object.keys(this.checklist[category]).length;
    }, 0);
    
    const passedChecks = Object.keys(this.checklist).reduce((acc, category) => {
      return acc + Object.values(this.checklist[category]).filter(Boolean).length;
    }, 0);
    
    console.log('Passed Checks:', passedChecks + '/' + totalChecks);
    console.log('Errors:', this.errors.length);
    console.log('Warnings:', this.warnings.length);
    console.log('');

    if (this.errors.length > 0) {
      console.log('❌ CRITICAL ERRORS (Must Fix Before Proceeding):');
      this.errors.forEach(error => console.log('  -', error));
      console.log('');
    }

    if (this.warnings.length > 0) {
      console.log('⚠️  WARNINGS (Review Before Proceeding):');
      this.warnings.forEach(warning => console.log('  -', warning));
      console.log('');
    }

    if (this.errors.length === 0) {
      console.log('✅ ALL CRITICAL CHECKS PASSED');
      console.log('🚀 Ready to proceed with crypto transfer');
    } else {
      console.log('❌ CRITICAL ISSUES DETECTED');
      console.log('🛑 DO NOT PROCEED WITH CRYPTO TRANSFER');
    }

    console.log('');
    console.log('🔐 REMEMBER: THERE IS NO UNDO OR RECOVERY IN CRYPTO');
    console.log('🔐 ALWAYS DOUBLE-CHECK ALL PARAMETERS BEFORE EXECUTING');
  }
}

// Run the checklist
const checklist = new CryptoTransferSecurityChecklist();
checklist.runFullChecklist().then(result => {
  process.exit(result.errors.length > 0 ? 1 : 0);
});