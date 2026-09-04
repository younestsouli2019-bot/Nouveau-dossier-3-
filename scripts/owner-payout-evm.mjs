#!/usr/bin/env node
/**
 * owner-payout-evm.mjs  (AUTONOMOUS · non-custodial · fail-closed)
 *
 * Direct EVM wallet payout to the owner via L2 USDT.
 * Uses the Trust Wallet private key to sign and send USDT on the cheapest
 * available chain. Falls through to dry-run if wallet has no gas or no USDT.
 *
 *   node scripts/owner-payout-evm.mjs --amount 3.70 --to 0xA46225a9...
 *   node scripts/owner-payout-evm.mjs --amount 3.70 --to 0xA46225a9... --confirm
 *
 * Fail-closed: without --confirm, emits a dry-run plan. Never sends with
 * amount=0. Never fabricates tx hashes.
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'settlements', 'evm');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PK = process.env.TRUST_WALLET_PRIVATE_KEY;
const FROM = process.env.TRUST_WALLET_ADDRESS;
if (!PK || !FROM) { console.error(JSON.stringify({ ok: false, error: 'TRUST_WALLET_PRIVATE_KEY or TRUST_WALLET_ADDRESS not set' })); process.exit(2); }

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const AMOUNT = Number(arg('amount', '0'));
const TO = arg('to', FROM); // default: self-transfer (sweep)
const CONFIRM = process.argv.includes('--confirm');
const CHAIN_KEY = arg('chain', 'auto');

if (!(AMOUNT > 0)) { console.error(JSON.stringify({ ok: false, error: 'amount_required' })); process.exit(1); }

// ── Chain config (same as evm-wallet-rail) ───────────────────────────────
const CHAINS = {
  base:     { name: 'Base',            chainId: 8453,   rpc: 'https://mainnet.base.org',             nativeSymbol: 'ETH',  usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', usdtDec: 6,  gasMult: 1.2, priority: 1 },
  arbitrum: { name: 'Arbitrum One',    chainId: 42161,  rpc: 'https://arb1.arbitrum.io/rpc',         nativeSymbol: 'ETH',  usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', usdtDec: 6,  gasMult: 1.2, priority: 2 },
  optimism: { name: 'Optimism',        chainId: 10,     rpc: 'https://mainnet.optimism.io',           nativeSymbol: 'ETH',  usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', usdtDec: 6,  gasMult: 1.2, priority: 3 },
  polygon:  { name: 'Polygon PoS',     chainId: 137,    rpc: 'https://polygon-bor-rpc.publicnode.com', nativeSymbol: 'MATIC', usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', usdtDec: 6,  gasMult: 1.5, priority: 4 },
  bsc:      { name: 'BNB Smart Chain', chainId: 56,     rpc: 'https://bsc-dataseed.binance.org',       nativeSymbol: 'BNB',  usdt: '0x55d398326f99059fF775485246999027B3197955', usdtDec: 18, gasMult: 1.3, priority: 5 },
};

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
];

// ── Auto-select cheapest chain with gas + USDT ───────────────────────────
async function selectChain() {
  if (CHAIN_KEY !== 'auto' && CHAINS[CHAIN_KEY]) return { key: CHAIN_KEY, ...CHAINS[CHAIN_KEY] };

  const candidates = Object.entries(CHAINS).sort((a, b) => a[1].priority - b[1].priority);
  for (const [key, chain] of candidates) {
    try {
      const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
      const native = await provider.getBalance(FROM);
      const nativeBal = Number(ethers.formatUnits(native, 18));
      const contract = new ethers.Contract(chain.usdt, ERC20_ABI, provider);
      const usdtBal = Number(ethers.formatUnits(await contract.balanceOf(FROM), chain.usdtDec));
      if (nativeBal > 0.0001 && usdtBal >= AMOUNT) {
        return { key, ...chain, nativeBal, usdtBal };
      }
    } catch {}
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────
const plan = { at: new Date().toISOString(), from: FROM, to: TO, amount: AMOUNT, token: 'USDT', confirm: CONFIRM, status: 'DRY_RUN' };

const selected = await selectChain();
if (!selected) {
  plan.status = 'NO_CHAIN_AVAILABLE';
  plan.error = 'Wallet has no gas + USDT on any supported L2. Fund the wallet to activate this rail.';
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

plan.chain = selected.key;
plan.chainName = selected.name;
plan.nativeBalance = selected.nativeBal;
plan.usdtBalance = selected.usdtBal;
plan.usdtContract = selected.usdt;

if (!CONFIRM) {
  plan.status = 'DRY_RUN';
  plan.gasEstimate = '~$0.001';
  plan.note = 'Add --confirm to execute. Wallet has gas + USDT on ' + selected.name + '.';
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

// ── Execute ──────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(selected.rpc, selected.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(PK, provider);
const contract = new ethers.Contract(selected.usdt, ERC20_ABI, wallet);
const value = ethers.parseUnits(String(AMOUNT), selected.usdtDec);

try {
  const gasEstimate = await contract.transfer.estimateGas(TO, value, { from: FROM });
  const feeData = await provider.getFeeData();
  const gasCost = gasEstimate * (feeData.gasPrice || 100000000n) * BigInt(Math.ceil(selected.gasMult * 100)) / 100n;
  plan.gasEstimateUnits = gasEstimate.toString();
  plan.gasCostWei = gasCost.toString();
  plan.gasCostEth = Number(ethers.formatUnits(gasCost, 18)).toFixed(6);

  const tx = await contract.transfer(TO, value);
  plan.txHash = tx.hash;
  plan.explorer = 'https://basescan.org/tx/' + tx.hash; // fallback
  plan.status = 'TX_SENT';

  console.log('TX: ' + tx.hash + ' — waiting for confirmation...');
  const receipt = await tx.wait();
  plan.blockNumber = receipt.blockNumber;
  plan.gasUsed = receipt.gasUsed.toString();
  plan.status = 'CONFIRMED';
  plan.fundsMoved = true;

  const outFile = resolve(OUT, `evm_payout_${tx.hash.slice(0, 10)}.json`);
  writeFileSync(outFile, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));
} catch (e) {
  plan.status = 'FAILED';
  plan.error = (e?.message || String(e)).slice(0, 500);
  plan.fundsMoved = false;
  console.log(JSON.stringify(plan, null, 2));
}
