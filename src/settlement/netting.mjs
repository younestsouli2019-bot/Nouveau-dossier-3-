import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import sahlRail from './rails/sahl.mjs';
import charipayRail from './rails/charipay.mjs';
import payzoneRail from './rails/payzone.mjs';
import xs2aRail from './rails/xs2a.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SETTLEMENT_PATH = path.join(ROOT, 'data', 'settlement', 'settlements.json');

const SUPPORTED_RAILS = ['ach', 'sepa', 'swift', 'usdc', 'eurc', 'sahl', 'ma_openbanking', 'charipay', 'payzone', 'xs2a'];

const RAIL_ADAPTERS = {
  sahl: sahlRail,
  charipay: charipayRail,
  payzone: payzoneRail,
  xs2a: xs2aRail,
};

function isMoroccanOpenBankingRail(rail) {
  return rail === 'sahl' || rail === 'ma_openbanking' || rail === 'charipay' || rail === 'payzone';
}

function getRailAdapter(rail) {
  if (!isMoroccanOpenBankingRail(rail) && rail !== 'xs2a') return null;
  return RAIL_ADAPTERS[rail] || sahlRail;
}

class SettlementEngine {
  constructor() {
    this.settlements = null;
  }

  async init() {
    mkdirSync(path.dirname(SETTLEMENT_PATH), { recursive: true });
    if (!existsSync(SETTLEMENT_PATH)) {
      this.settlements = { version: 1, batches: [] };
      await this._persist();
    } else {
      this.settlements = JSON.parse(await fs.readFile(SETTLEMENT_PATH, 'utf-8'));
    }
    return this;
  }

  async _persist() {
    const tmp = SETTLEMENT_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.settlements, null, 2), 'utf-8');
    await fs.rename(tmp, SETTLEMENT_PATH);
  }

  net(transactions) {
    const nets = new Map();
    for (const tx of transactions) {
      const key = `${tx.counterparty}|${tx.currency}`;
      const cur = nets.get(key) || { counterparty: tx.counterparty, currency: tx.currency, grossIn: 0, grossOut: 0, count: 0, refs: [] };
      const n = Number(tx.amount) || 0;
      if (n >= 0) cur.grossIn += n; else cur.grossOut += -n;
      cur.count++;
      cur.refs.push(tx.txId || tx.reference);
      nets.set(key, cur);
    }
    const rows = [];
    for (const [, net] of nets) {
      rows.push({
        counterparty: net.counterparty,
        currency: net.currency,
        netAmount: Math.round((net.grossIn - net.grossOut) * 1e8) / 1e8,
        grossIn: net.grossIn,
        grossOut: net.grossOut,
        transactions: net.count,
        refs: net.refs,
      });
    }
    return rows;
  }

  settleNetRow(row, rail = 'ach') {
    if (!SUPPORTED_RAILS.includes(rail)) throw new Error(`Unsupported rail: ${rail} (${SUPPORTED_RAILS.join(', ')})`);
    if (row.netAmount <= 0) return { skipped: true, reason: 'zero_or_negative_net', row };
    return {
      batchId: crypto.randomUUID(),
      counterparty: row.counterparty,
      currency: row.currency,
      amount: row.netAmount,
      rail,
      transactions: row.transactions,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
  }

  async settle(transactions, rail = 'ach', opts = {}) {
    await this.init();
    const nets = this.net(transactions);
    const batches = [];
    for (const row of nets) {
      if (opts.onlyPositive !== false && row.netAmount <= 0) continue;
      const batch = this.settleNetRow(row, rail);
      batches.push(batch);
      this.settlements.batches.push(batch);
    }
    await this._persist();
    return { nets, batches };
  }

  async resolveDestination(destinationKey = 'ma_attijariwafa') {
    const truthPath = path.join(ROOT, 'owner-truth.json');
    if (!existsSync(truthPath)) return null;
    try {
      const truth = JSON.parse(await fs.readFile(truthPath, 'utf-8'));
      const account = truth?.paymentDestinations?.bankAccounts?.[destinationKey];
      if (!account) return null;
      return { key: destinationKey, iban: String(account.iban || '').replace(/\s+/g, ''), accountHolder: account.accountHolder, bankCode: account.ribBanque || '007', swift: account.swift, currency: account.currency };
    } catch { return null; }
  }

  async submitToRail(batchId, opts = {}) {
    await this.init();
    const batch = this.settlements.batches.find(b => b.batchId === batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    if (!isMoroccanOpenBankingRail(batch.rail) && batch.rail !== 'xs2a') throw new Error(`Batch rail ${batch.rail} has no open-banking adapter`);

    const iban = opts.iban || (opts.destinationAccount && opts.destinationAccount.iban) || this.resolveDestination(opts.destinationKey || 'ma_attijariwafa')?.iban;
    if (!iban) throw new Error('Missing destination IBAN for Moroccan open-banking rail (opts.iban)');

    const adapter = getRailAdapter(batch.rail);
    await adapter.init();
    const destination = opts.destinationAccount || this.resolveDestination(opts.destinationKey || 'ma_attijariwafa') || {};
    const result = await adapter.initiatePayment({
      amount: batch.amount,
      currency: batch.currency,
      iban,
      beneficiary: opts.beneficiary || destination.accountHolder || 'Younes Tsouli',
      bankCode: opts.bankCode || destination.bankCode || '007',
      purpose: opts.purpose || 'revenue_settlement',
      reference: batch.batchId,
    });

    if (result.status === 'SUBMITTED') {
      batch.status = 'EXECUTED';
      batch.gatewayRef = result.gatewayRef;
      batch.railRef = result.paymentId;
      batch.proof = result;
      batch.executedAt = new Date().toISOString();
    } else {
      batch.status = result.status === 'BLOCKED' ? 'BLOCKED' : result.status === 'DEFERRED' ? 'DEFERRED' : 'FAILED';
      batch.railRef = result.paymentId || null;
      batch.error = { status: result.status, reason: result.reason, httpStatus: result.httpStatus };
    }
    await this._persist();
    return { batch, railResult: result };
  }

  netReceivables(receivables = []) {
    const eligible = receivables.filter(r => r.klass === 'A' && r.status === 'ELIGIBLE');
    const blocked = receivables.filter(r => r.klass !== 'A' || r.status !== 'ELIGIBLE');
    const nets = new Map();
    for (const r of eligible) {
      const key = `${r.currency}`;
      const cur = nets.get(key) || { currency: r.currency, amount: 0, count: 0, receivableIds: [], missionIds: new Set() };
      cur.amount += Number(r.amount) || 0;
      cur.count++;
      cur.receivableIds.push(r.receivableId);
      cur.missionIds.add(r.missionId);
      nets.set(key, cur);
    }
    return {
      nets: Array.from(nets.values()).map(n => ({ currency: n.currency, amount: Math.round(n.amount * 1e8) / 1e8, count: n.count, receivableIds: n.receivableIds, missionIds: Array.from(n.missionIds).filter(Boolean) })),
      blocked,
    };
  }

  async settleReceivables(receivables = [], rail = 'charipay', opts = {}) {
    await this.init();
    const { nets, blocked } = this.netReceivables(receivables);
    const batches = [];
    for (const row of nets) {
      if (opts.onlyPositive !== false && row.amount <= 0) continue;
      const batch = this.settleNetRow({ counterparty: 'SWARM_REVENUE', currency: row.currency, netAmount: row.amount }, rail);
      batch.receivableIds = row.receivableIds;
      batch.missionIds = row.missionIds;
      batches.push(batch);
      this.settlements.batches.push(batch);
    }
    await this._persist();
    return { nets, blocked, batches };
  }

  async execute(batchId, result = {}, opts = {}) {
    await this.init();
    const batch = this.settlements.batches.find(b => b.batchId === batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    if ((isMoroccanOpenBankingRail(batch.rail) || batch.rail === 'xs2a') && !result.status) {
      return this.submitToRail(batchId, opts);
    }
    batch.status = result.status || 'EXECUTED';
    batch.gatewayRef = result.gatewayRef || null;
    batch.confirmedAt = new Date().toISOString();
    batch.proof = result.proof || null;
    await this._persist();
    return batch;
  }

  async status() {
    const byStatus = {};
    for (const b of this.settlements.batches) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    return { total: this.settlements.batches.length, byStatus };
  }
}

const settlementEngine = new SettlementEngine();
export default settlementEngine;
export { SettlementEngine, SUPPORTED_RAILS, isMoroccanOpenBankingRail, getRailAdapter, RAIL_ADAPTERS };
