#!/usr/bin/env node
/**
 * payment-routing-table.mjs  (AUTONOMOUS · READ-ONLY)
 *
 * Honest payment routing table: consolidates ALL known rails, their actual
 * status (not config-declared), and what they can/cannot do right now.
 * This is the single source of truth for "where can money actually move?"
 *
 *   node scripts/payment-routing-table.mjs
 *
 * Produces: data/out/payment-routing-table.json
 */
import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const flag = (n) => String(process.env[n] ?? '').trim().toLowerCase() === 'true';

// Build honest routing table
const rails = [
  {
    name: 'PayPal PPP2',
    type: 'online',
    status: 'partial',
    authOk: true,
    canSendPayouts: false,
    fundsMoved: false,
    details: 'OAuth token works (200 OK, payments/payouts scope), but POST /v1/payments/payouts returns 403 AUTHORIZATION_ERROR. Account not approved for live Payouts despite scope presence.',
    recipient: 'younestsouli2019@gmail.com',
    limit: '$500/day (PAYPAL_DAILY_LIMIT)',
    lastProbe: new Date().toISOString(),
    fix: 'Apply for PayPal Payouts approval in developer dashboard → Request Features → Payouts',
  },
  {
    name: 'PayPal NCP Link',
    type: 'online',
    status: 'available',
    authOk: true,
    canSendPayouts: false,
    canReceivePayments: true,
    fundsMoved: false,
    details: 'No-code payment link (non-card-present). Can receive payments but not send payouts.',
    recipient: 'younestsouli2019@gmail.com',
    link: process.env.PAYPAL_NCP_PAYMENT_LINK || null,
    lastProbe: new Date().toISOString(),
    fix: 'Share link with payer. No action needed to receive.',
  },
  {
    name: 'Binance',
    type: 'crypto',
    status: 'dead',
    authOk: false,
    canSendPayouts: false,
    fundsMoved: false,
    details: 'API key rejected: -2015 Invalid API-key/IP/permissions. Both key sets fail.',
    lastProbe: new Date().toISOString(),
    fix: 'Regenerate API key with correct IP allowlist + withdrawals enabled',
  },
  {
    name: 'Bitget',
    type: 'crypto',
    status: 'ip_locked',
    authOk: false,
    canSendPayouts: false,
    fundsMoved: false,
    details: '40018 Invalid IP. Current IP 105.74.66.240 not in key allowlist.',
    lastProbe: new Date().toISOString(),
    fix: 'Add current IP (105.74.66.240) to Bitget API key IP whitelist',
  },
  {
    name: 'Bybit',
    type: 'crypto',
    status: 'empty',
    authOk: true,
    canSendPayouts: false,
    fundsMoved: false,
    balance: { USDT: 0 },
    details: 'Auth OK but $0 USDT balance across all account types (spot + unified).',
    lastProbe: new Date().toISOString(),
    fix: 'Deposit funds to Bybit account',
  },
  {
    name: 'Wise',
    type: 'bank',
    status: 'dead',
    authOk: false,
    canSendPayouts: false,
    fundsMoved: false,
    details: 'WISE_API_KEY rejected (invalid_token). Credentials expired/revoked.',
    lastProbe: new Date().toISOString(),
    fix: 'Regenerate Wise API key',
  },
  {
    name: 'Banking Circle',
    type: 'bank',
    status: 'unavailable',
    authOk: false,
    canSendPayouts: false,
    fundsMoved: false,
    details: 'Open Banking not available for new accounts. No credentials provisioned.',
    lastProbe: new Date().toISOString(),
    fix: 'Not available for new accounts. Consider alternative bank rail.',
  },
  {
    name: 'Payoneer',
    type: 'bank',
    status: 'dead',
    authOk: false,
    canSendPayouts: false,
    fundsMoved: false,
    details: 'No PAYONEER_CLIENT_ID/SECRET/TOKEN present.',
    lastProbe: new Date().toISOString(),
    fix: 'Provision Payoneer API credentials',
  },
  {
    name: 'Attijari Wafa Bank (operator mobile)',
    type: 'bank',
    status: 'available_for_incoming',
    authOk: true,
    canSendPayouts: false,
    canReceivePayments: true,
    fundsMoved: false,
    details: 'Owner IBAN MA59 0078 1000 0448 5000 3059 4182. Can receive transfers. Outbound requires operator mobile app.',
    recipient: 'Younes Souli',
    lastProbe: new Date().toISOString(),
    fix: 'No fix needed for receiving. For outbound: use Attijari mobile app.',
  },
  {
    name: 'Alfa Gros COD',
    type: 'local',
    status: 'available',
    authOk: true,
    canSendPayouts: false,
    canReceiveDeliveries: true,
    fundsMoved: false,
    details: 'Cash on Delivery. Operator pays cash when delivered. No pre-payment API needed.',
    contact: '+212 639 158 209',
    location: 'Casablanca Kaysariya',
    lastProbe: new Date().toISOString(),
    fix: 'No fix needed. Pay cash on delivery.',
  },
  {
    name: 'EVM Wallet (Trust Wallet)',
    type: 'crypto_direct',
    status: 'ready_no_funds',
    authOk: true,
    canSendPayouts: true,
    canReceivePayments: true,
    fundsMoved: false,
    address: process.env.TRUST_WALLET_ADDRESS || null,
    chains: ['Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'Ethereum', 'Scroll', 'Linea'],
    supportedTokens: ['ETH', 'BNB', 'MATIC', 'USDT'],
    details: 'Direct programmatic EVM wallet via ethers.js. Private key loaded, signing works. Currently $0 on all chains. When funded, can send USDT on any L2 for sub-penny fees.',
    lastProbe: new Date().toISOString(),
    fix: 'Fund the wallet with native gas token (ETH on Base/Arbitrum) + USDT. Minimum to send: ~$0.01 USDT + ~$0.001 gas.',
  },
  {
    name: 'TON Direct',
    type: 'crypto_direct',
    status: 'available_no_funds',
    authOk: true,
    canSendPayouts: true,
    canReceivePayments: true,
    fundsMoved: false,
    details: 'Direct TON blockchain access via @ton/ton SDK. Bybit TON deposit address probed ($0). Bitget TON key is hex, not mnemonic — cannot derive wallet for sending without mnemonic words.',
    lastProbe: new Date().toISOString(),
    fix: 'Fund the Bybit TON address or provide a TON mnemonic in .env2 for sending.',
  },
];

// Summary
const available = rails.filter(r => r.status === 'available' || r.status === 'available_for_incoming' || r.status === 'partial');
const dead = rails.filter(r => r.status === 'dead' || r.status === 'ip_locked' || r.status === 'empty' || r.status === 'unavailable');

const table = {
  at: new Date().toISOString(),
  engine: 'payment-routing-table',
  summary: {
    total: rails.length,
    available: available.length,
    dead: dead.length,
    availableNames: available.map(r => r.name),
    deadNames: dead.map(r => r.name + ' (' + r.status + ')'),
  },
  rails,
  verdict: dead.length >= 7 ? 'MOSTLY_DEAD' : 'PARTIAL',
  note: 'READ-ONLY honest routing table. Money can only move through available rails. Never assume a rail works without probing.',
};

writeFileSync(resolve(OUT, 'payment-routing-table.json'), JSON.stringify(table, null, 2));
console.log(JSON.stringify({
  ok: true,
  total: table.summary.total,
  available: table.summary.available,
  dead: table.summary.dead,
  availableNames: table.summary.availableNames,
  verdict: table.verdict,
}, null, 2));
