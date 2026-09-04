#!/usr/bin/env node
/**
 * settlement-worklist.mjs  (AUTONOMOUS · READ-ONLY · no money movement)
 *
 * Generates a structured worklist of all unsettled owner settlements, mapped
 * to the Attijari Wafa Bank IBAN, ready for operator execution through their
 * own mobile banking app. This replaces the dead API-based payout path with
 * a human-in-the-loop execution model that's honest and auditable.
 *
 *   node scripts/settlement-worklist.mjs
 *
 * Produces: data/out/settlement-worklist.json
 * Never moves money. Never fabricates proof.
 */
import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';
import { ethers } from 'ethers';

// ── EVM wallet balance check (read-only) ─────────────────────────────────
const EVW_WALLET = process.env.TRUST_WALLET_ADDRESS;
const EVW_PK = process.env.TRUST_WALLET_PRIVATE_KEY;

const L2_CHAINS = [
  { key: 'base', rpc: 'https://mainnet.base.org', chainId: 8453, usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', dec: 6 },
  { key: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', chainId: 42161, usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', dec: 6 },
  { key: 'optimism', rpc: 'https://mainnet.optimism.io', chainId: 10, usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', dec: 6 },
  { key: 'polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', chainId: 137, usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', dec: 6 },
  { key: 'bsc', rpc: 'https://bsc-dataseed.binance.org', chainId: 56, usdt: '0x55d398326f99059fF775485246999027B3197955', dec: 18 },
];

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];

async function probeEvmWallet() {
  if (!EVW_PK || !EVW_WALLET) return { available: false, totalUsdt: 0, chains: {} };
  const chains = {};
  let totalUsdt = 0;
  let totalGas = 0;
  for (const c of L2_CHAINS) {
    try {
      const provider = new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true });
      const native = await provider.getBalance(EVW_WALLET);
      const nativeBal = Number(ethers.formatEther(native));
      const contract = new ethers.Contract(c.usdt, ERC20_ABI, provider);
      const usdtBal = Number(ethers.formatUnits(await contract.balanceOf(EVW_WALLET), c.dec));
      chains[c.key] = { native: nativeBal, usdt: usdtBal, canSend: nativeBal > 0.0001 && usdtBal > 0 };
      totalUsdt += usdtBal;
      if (nativeBal > 0.0001) totalGas += nativeBal;
    } catch { chains[c.key] = { native: 0, usdt: 0, canSend: false, error: true }; }
  }
  return { available: true, address: EVW_WALLET, totalUsdt, totalGasChains: Object.values(chains).filter(c => c.canSend).length, chains };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Owner bank details (pre-authed, real)
const OWNER_IBAN = 'MA59007810000448500030594182';
const OWNER_BANK = 'Attijari Wafa Bank';
const OWNER_NAME = 'Younes Souli';

// Known owner account labels (derived from earlier audit)
const ACCT_LABELS = {
  '01afb980-d04f-4e9a-87bb-e8caa25a516a': 'Younes Souli (primary)',
  'e6ce7a7c-b7cd-4f62-b8ed-c4aea9be3ab6': 'Younes Souli (salary)',
  'b8e59fe5-6ca8-45f5-ae10-23298b9300d7': 'Younes Souli (general)',
  '4ee28082-7b85-4290-b87f-0cc2d16e67f6': 'Younes Souli (vendor)',
  '3ac169ef-aefb-45ca-abc7-e87ff8fd5796': 'Younes Souli (crypto)',
};

try {
  await c.connect();

  // OwnerSettlements: all are needs_manual_proof (no API path succeeded)
  const settlements = (await c.query(
    `SELECT id, amount, status, "ownerAccountId", "sourceLabel", "destinationLabel",
            "externalRef", description, currency, direction, purpose
     FROM "OwnerSettlement"
     WHERE status = 'needs_manual_proof'
     ORDER BY amount DESC`
  )).rows;

  // Probe EVM wallet (read-only, no money movement)
  const evm = await probeEvmWallet();

  // RevenueEvents: the revenue side (what funds these settlements)
  const revenues = (await c.query(
    `SELECT id, source, amount, status, "proofHash", "proofType", currency
     FROM "RevenueEvent"
     WHERE status IN ('pending', 'PENDING_REASONING')
     ORDER BY amount DESC`
  )).rows;

  // PayoutBatches: the batch-level view
  const batches = (await c.query(
    `SELECT id, "batchNumber", "totalAmount", status, "paymentProvider", "providerBatchRef"
     FROM "PayoutBatch"
     WHERE status IN ('processing', 'needs_manual_proof')
     ORDER BY "totalAmount" DESC`
  )).rows;

  // Group settlements by owner account
  const byAccount = {};
  for (const s of settlements) {
    const acct = s.ownerAccountId || 'unknown';
    if (!byAccount[acct]) byAccount[acct] = { label: ACCT_LABELS[acct] || acct, entries: [], total: 0 };
    byAccount[acct].entries.push({
      id: s.id,
      amount: Number(s.amount),
      source: s.sourceLabel,
      destination: s.destinationLabel,
      purpose: s.purpose || s.description || s.sourceLabel,
      currency: s.currency || 'USD',
      externalRef: s.externalRef,
    });
    byAccount[acct].total += Number(s.amount);
  }

  // Build the worklist: each settlement is an "action item" for the operator
  const worklist = {
    at: new Date().toISOString(),
    engine: 'settlement-worklist',
    bank: { name: OWNER_BANK, iban: OWNER_IBAN, holder: OWNER_NAME },
    evmWallet: evm.available ? {
      address: evm.address,
      totalUsdt: evm.totalUsdt,
      readyChains: evm.totalGasChains,
      chains: evm.chains,
      routing: evm.totalUsdt > 0 ? 'EVM_AUTO' : 'EVM_UNFUNDED',
    } : { available: false, routing: 'NONE' },
    totalUnsettled: settlements.reduce((a, r) => a + Number(r.amount), 0),
    totalSettlements: settlements.length,
    totalRevenueUnsettled: revenues.reduce((a, r) => a + Number(r.amount), 0),
    totalBatchProcessing: batches.reduce((a, r) => a + Number(r.totalAmount), 0),
    accounts: byAccount,
    actions: settlements.map((s, i) => ({
      seq: i + 1,
      id: s.id,
      amount: Number(s.amount),
      currency: s.currency || 'USD',
      source: s.sourceLabel,
      purpose: s.purpose || s.description || s.sourceLabel,
      routing: evm.available && evm.totalUsdt >= Number(s.amount)
        ? { method: 'EVM_USDT', chain: 'auto', note: 'Execute via: node scripts/owner-payout-evm.mjs --amount ' + Number(s.amount).toFixed(2) + ' --to ' + EVW_WALLET }
        : { method: 'ATTIJARI_APP', note: 'Execute through Attijari mobile app. Record transaction ID.' },
      status: 'needs_operator_action',
      note: 'Execute through assigned routing. Record transaction ID when done.',
    })),
    batches: batches.map(b => ({
      batchNumber: b.batchNumber,
      totalAmount: Number(b.totalAmount),
      status: b.status,
      provider: b.paymentProvider,
      ref: b.providerBatchRef,
    })),
    revenueQueues: {
      pending: revenues.filter(r => r.status === 'pending'),
      pendingReasoning: revenues.filter(r => r.status === 'PENDING_REASONING'),
    },
    note: 'READ-ONLY worklist. Routing: EVM_USDT (when funded) or ATTijari mobile app. No fabrication.',
  };

  writeFileSync(resolve(OUT, 'settlement-worklist.json'), JSON.stringify(worklist, null, 2));
  console.log(JSON.stringify({
    ok: true,
    totalUnsettled: worklist.totalUnsettled,
    settlements: worklist.totalSettlements,
    revenuePending: worklist.totalRevenueUnsettled,
    batchesProcessing: worklist.totalBatchProcessing,
    accounts: Object.keys(byAccount).length,
  }, null, 2));
} finally {
  await c.end();
}
