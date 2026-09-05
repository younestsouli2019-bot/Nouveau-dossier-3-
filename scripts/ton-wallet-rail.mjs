#!/usr/bin/env node
/**
 * ton-wallet-rail.mjs  (AUTONOMOUS · non-custodial · direct TON)
 *
 * Direct TON blockchain access — bypasses Bybit/Bitget entirely.
 * Uses @ton/ton SDK to derive wallet from private key and send TON/USDT.
 *
 *   node scripts/ton-wallet-rail.mjs --action balance
 *   node scripts/ton-wallet-rail.mjs --action send --amount 0.5 --to UQDIrl...
 *
 * Supported wallets: v4R2 (most common). Falls back gracefully if key doesn't match.
 * Fail-closed: never sends without --confirm AND an I8 CAP_SEND_CRYPTO capability grant; never fabricates tx hashes.
 */
import 'dotenv/config';
import { TonClient, WalletContractV4, internal, toNano, fromNano, beginCell } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { assertCapability } from '../src/finance/capabilities.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };

// ── Config ───────────────────────────────────────────────────────────────
const TONCENTER_API = 'https://toncenter.com/api/v2';
const TONAPI_BASE = 'https://tonapi.io/v2';

// Known TON wallets from env
const WALLET_ADDRS = {
  bybit_ton: process.env.BYBIT_USDT_TON || null,
};

// TON USDT Jetton master (mainnet)
const USDT_TON_MASTER = 'EQAlO-lYt1VqzZMkEqc4a0bPQuBTHolWi8AsLKtR4MlWnQcJ';

// ── Helpers ──────────────────────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return r.json();
}

async function checkTonBalance(address) {
  try {
    const r = await apiFetch(`${TONCENTER_API}/getAccountBalance?address=${encodeURIComponent(address)}`);
    if (r.ok && r.result) {
      const nano = BigInt(r.result.balance || '0');
      return { address, balanceNano: nano.toString(), balanceTon: fromNano(nano).toString(), status: 'ok' };
    }
    return { address, balanceNano: '0', balanceTon: '0', status: r.error?.message || 'unknown_error' };
  } catch (e) {
    return { address, balanceNano: '0', balanceTon: '0', status: 'fetch_error: ' + e.message.slice(0, 100) };
  }
}

// ── Actions ──────────────────────────────────────────────────────────────
async function checkBalances() {
  console.log('TON Wallet Balance Check');
  console.log('='.repeat(50));

  // Check all known TON addresses
  for (const [name, addr] of Object.entries(WALLET_ADDRS)) {
    if (!addr) continue;
    const bal = await checkTonBalance(addr);
    console.log(`${name}: ${bal.balanceTon} TON (raw: ${bal.balanceNano})`);
    console.log(`  address: ${addr}`);
    console.log(`  status: ${bal.status}`);
  }

  // Also try to derive from Bitget TON key if available
  const pk = process.env.BITGET_WALLET_TON_PRIVATE_KEY;
  if (pk) {
    console.log('\nBitget TON key:');
    console.log('  PK length: ' + pk.length + ' chars');
    console.log('  Note: Need mnemonic (word list) to derive address. Raw hex key alone may not work.');
  }
}

async function sendTon() {
  const amount = Number(arg('amount', '0'));
  const to = arg('to', '');

  if (!(amount > 0)) { console.error('--amount required (>0)'); process.exit(1); }
  if (!to) { console.error('--to required (TON address)'); process.exit(1); }

  const pk = process.env.BITGET_WALLET_TON_PRIVATE_KEY;
  if (!pk) { console.error('BITGET_WALLET_TON_PRIVATE_KEY not set'); process.exit(2); }

  const mnemonicWords = pk.split(' ');
  const isMnemonic = mnemonicWords.length >= 12;

  if (!isMnemonic) {
    console.log(JSON.stringify({
      ok: false,
      error: 'TON key is not a mnemonic phrase',
      hint: 'The BITGET_WALLET_TON_PRIVATE_KEY appears to be a hex key, not a 12/24 word mnemonic. TON SDK requires mnemonic words to derive wallet. If you have the mnemonic, set it in .env2.',
      pkLength: pk.length,
    }));
    process.exit(1);
  }

  try {
    const key = await mnemonicToWalletKey(mnemonicWords);
    const wallet = WalletContractV4.create({ publicKey: key.publicKey });
    const address = wallet.address;

    console.log(JSON.stringify({
      chain: 'TON',
      walletAddress: address.toString(),
      to,
      amount: amount + ' TON',
      dryRun: !process.argv.includes('--confirm'),
    }));

    if (!process.argv.includes('--confirm')) {
      console.log('Add --confirm to send.');
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

    // Connect to mainnet via toncenter
    const client = new TonClient({
      endpoint: TONCENTER_API,
    });

    const contract = client.open(wallet);
    const seqno = await contract.getSeqno();

    if (seqno === 0) {
      console.log(JSON.stringify({ ok: false, error: 'wallet_not_initialized', hint: 'This wallet has never received TON. It cannot send until it has been funded and initialized.' }));
      process.exit(1);
    }

    await contract.sendTransfer({
      seqno,
      secretKey: key.secretKey,
      messages: [
        internal({
          to,
          value: toNano(String(amount)),
        }),
      ],
    });

    console.log(JSON.stringify({
      ok: true,
      chain: 'TON',
      from: address.toString(),
      to,
      amount: amount + ' TON',
      status: 'TX_SENT',
      note: 'Wait a few seconds for confirmation on TON network.',
    }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message?.slice(0, 500) }));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
const action = arg('action', 'balance');
if (action === 'balance') await checkBalances();
else if (action === 'send') await sendTon();
else { console.error('actions: balance, send'); process.exit(1); }
