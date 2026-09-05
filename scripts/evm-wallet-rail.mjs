#!/usr/bin/env node
/**
 * evm-wallet-rail.mjs  (AUTONOMOUS · PROGRAMMATIC · non-custodial)
 *
 * Direct programmatic control of the Trust Wallet EVM address across
 * L2s and sidechains — bypasses all centralized exchanges. Uses ethers.js
 * v6 to sign and send transactions directly from the private key.
 *
 * Supported chains: Base, Arbitrum, Optimism, Polygon, BSC, Ethereum, Scroll, Linea
 * Supported tokens: Native ETH/BNB/MATIC + USDT (ERC20/BEP20)
 *
 *   node scripts/evm-wallet-rail.mjs --action balance
 *   node scripts/evm-wallet-rail.mjs --action send --chain base --token USDT --amount 3.70 --to 0x...
 *   node scripts/evm-wallet-rail.mjs --action send --chain arbitrum --token ETH --amount 0.001 --to 0x...
 *
 * Fail-closed: never sends without --action send, never fabricates tx hashes.
 * I8: even with --confirm, a CAP_SEND_CRYPTO capability grant is required before any send.
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { assertCapability } from '../src/finance/capabilities.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── Chain registry ───────────────────────────────────────────────────────
const CHAINS = {
  base: {
    name: 'Base',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://basescan.org',
    usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://arbiscan.io',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    rpc: 'https://mainnet.optimism.io',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://optimistic.etherscan.io',
    usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  polygon: {
    name: 'Polygon PoS',
    chainId: 137,
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    nativeSymbol: 'MATIC',
    nativeDecimals: 18,
    explorer: 'https://polygonscan.com',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    usdtDecimals: 6,
    gasMultiplier: 1.5,
  },
  bsc: {
    name: 'BNB Smart Chain',
    chainId: 56,
    rpc: 'https://bsc-dataseed.binance.org',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    explorer: 'https://bscscan.com',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
    usdtDecimals: 18,
    gasMultiplier: 1.3,
  },
  ethereum: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://etherscan.io',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    usdtDecimals: 6,
    gasMultiplier: 1.5,
  },
  scroll: {
    name: 'Scroll',
    chainId: 534352,
    rpc: 'https://rpc.scroll.io',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://scrollscan.com',
    usdt: null,
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
  linea: {
    name: 'Linea',
    chainId: 59144,
    rpc: 'https://rpc.linea.build',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorer: 'https://lineascan.build',
    usdt: null,
    usdtDecimals: 6,
    gasMultiplier: 1.2,
  },
};

// ── ERC20 ABI (balanceOf + transfer + decimals) ──────────────────────────
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// ── Helpers ──────────────────────────────────────────────────────────────
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const PK = process.env.TRUST_WALLET_PRIVATE_KEY;
const ADDR = process.env.TRUST_WALLET_ADDRESS;

if (!PK) { console.error('TRUST_WALLET_PRIVATE_KEY not set'); process.exit(2); }

// ── Actions ──────────────────────────────────────────────────────────────
async function checkBalances() {
  const balances = {};
  for (const [key, chain] of Object.entries(CHAINS)) {
    try {
      const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
      const wallet = new ethers.Wallet(PK, provider);
      const native = await provider.getBalance(ADDR);
      let usdtBal = 0n;
      if (chain.usdt) {
        const contract = new ethers.Contract(chain.usdt, ERC20_ABI, provider);
        usdtBal = await contract.balanceOf(ADDR);
      }
      const nativeFormatted = Number(ethers.formatUnits(native, chain.nativeDecimals));
      const usdtFormatted = Number(ethers.formatUnits(usdtBal, chain.usdtDecimals));
      balances[key] = {
        chain: chain.name,
        native: nativeFormatted,
        nativeSymbol: chain.nativeSymbol,
        usdt: usdtFormatted,
        totalUsd: usdtFormatted, // native price ignored for simplicity
        canSendUsdt: usdtFormatted > 0,
        canSendNative: nativeFormatted > 0,
        hasGas: nativeFormatted > 0,
      };
      if (usdtFormatted > 0 || nativeFormatted > 0) {
        console.log(`${chain.name}: ${chain.nativeSymbol}=${nativeFormatted.toFixed(6)} | USDT=${usdtFormatted.toFixed(2)} | can_send=${usdtFormatted > 0}`);
      }
    } catch (e) {
      balances[key] = { chain: chain.name, error: e.message.slice(0, 100) };
    }
  }
  const totalUsdt = Object.values(balances).reduce((a, b) => a + (b.usdt || 0), 0);
  const chainsWithFunds = Object.entries(balances).filter(([, b]) => (b.usdt || 0) > 0 || (b.native || 0) > 0);
  const chainsWithGas = Object.entries(balances).filter(([, b]) => b.hasGas);
  console.log(JSON.stringify({ totalUsdt, chainsWithFunds: chainsWithFunds.length, chainsWithGas: chainsWithGas.length, balances }, null, 2));
  return balances;
}

async function sendTransaction() {
  const chainKey = arg('chain', '');
  const token = (arg('token', 'USDT')).toUpperCase();
  const amount = Number(arg('amount', '0'));
  const to = arg('to', '');

  if (!chainKey || !CHAINS[chainKey]) {
    console.error('Valid chains: ' + Object.keys(CHAINS).join(', '));
    process.exit(1);
  }
  if (!(amount > 0)) { console.error('--amount required (>0)'); process.exit(1); }
  if (!to || !to.startsWith('0x')) { console.error('--to required (0x...)'); process.exit(1); }

  const chain = CHAINS[chainKey];
  const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(PK, provider);

  console.log(JSON.stringify({ chain: chain.name, token, amount, to, from: wallet.address, dryRun: !flag('confirm') }));

  if (!flag('confirm')) {
    console.log('Add --confirm to actually send. This is a dry run.');
    return;
  }

  // I8: explicit capability grant required for actual money movement.
  const cap = assertCapability('SEND_CRYPTO');
  if (!cap.ok) {
    console.log(JSON.stringify({
      ok: false,
      status: 'CAPABILITY_BLOCKED',
      error: cap.error,
      fundsMoved: false,
      note: 'Set the CAP_SEND_CRYPTO flag to the literal boolean true to authorize. Dry-run planning is always allowed.',
    }, null, 2));
    return;
  }

  let tx;
  if (token === chain.nativeSymbol || token === 'ETH' || token === 'BNB' || token === 'MATIC') {
    // Native token transfer
    const value = ethers.parseUnits(String(amount), chain.nativeDecimals);
    tx = await wallet.sendTransaction({ to, value });
  } else if (token === 'USDT' && chain.usdt) {
    // USDT transfer
    const contract = new ethers.Contract(chain.usdt, ERC20_ABI, wallet);
    const decimals = await contract.decimals();
    const value = ethers.parseUnits(String(amount), decimals);
    tx = await contract.transfer(to, value);
  } else {
    console.error(`Token ${token} not supported on ${chain.name}`);
    process.exit(1);
  }

  console.log('TX_SENT: ' + tx.hash);
  console.log('EXPLORER: ' + chain.explorer + '/tx/' + tx.hash);
  const receipt = await tx.wait();
  console.log('CONFIRMED in block ' + receipt.blockNumber + ' gasUsed=' + receipt.gasUsed.toString());

  const result = { at: new Date().toISOString(), chain: chain.name, token, amount, to, from: wallet.address, txHash: tx.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), explorer: chain.explorer + '/tx/' + tx.hash };
  writeFileSync(resolve(OUT, 'evm-tx-' + tx.hash.slice(0, 10) + '.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────
const action = arg('action', 'balance');
if (action === 'balance') await checkBalances();
else if (action === 'send') await sendTransaction();
else { console.error('actions: balance, send'); process.exit(1); }
