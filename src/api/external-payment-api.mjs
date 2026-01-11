import { AdvancedFinancialManager } from '../finance/AdvancedFinancialManager.mjs';
import { enforceOwnerDirective, preExecutionOwnerCheck } from '../owner-directive.mjs';
import { calculateUnitEconomics, enforceUnitEconomics } from '../unit-economics.mjs';
import { AppendOnlyHmacLogger } from '../audit/AppendOnlyHmacLogger.mjs';
import { enforceAuthorityProtocol } from '../authority.mjs';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

function getEnvBool(name, def = false) {
  const v = process.env[name];
  if (v == null) return def;
  return String(v).toLowerCase() === 'true';
}

function ensureLiveAndSafe(reason) {
  if (!getEnvBool('SWARM_LIVE', false)) {
    throw new Error(`LIVE_MODE_REQUIRED: SWARM_LIVE must be true (${reason})`);
  }
  if (getEnvBool('BASE44_OFFLINE', false) || getEnvBool('BASE44_OFFLINE_MODE', false)) {
    throw new Error(`OFFLINE_ACTIVE: External transfers disabled (${reason})`);
  }
  const paypalMode = String(process.env.PAYPAL_MODE ?? 'live').toLowerCase();
  const paypalBase = String(process.env.PAYPAL_API_BASE_URL ?? '').toLowerCase();
  if (paypalMode === 'sandbox' || paypalBase.includes('sandbox.paypal.com')) {
    throw new Error(`SANDBOX_BLOCKED: PayPal sandbox configured (${reason})`);
  }
  enforceAuthorityProtocol({ action: reason, requireLive: true });
}

function estimateEconomicsForItems(items, rail = 'paypal') {
  const gross = items.reduce((s, i) => s + Number(i.amount || 0), 0);
  const cogs = 0;
  const econ = calculateUnitEconomics(gross, cogs, rail, 0);
  enforceUnitEconomics(econ);
  return econ;
}

export class ExternalPaymentAPI {
  constructor() {
    this.fm = new AdvancedFinancialManager();
    this.audit = new AppendOnlyHmacLogger();
  }
  async initialize() {
    await this.fm.initialize();
  }
  async requestAutoSettlement({ payoutBatchId, items, idempotencyKey = crypto.randomUUID(), actor = 'SwarmAgent' }) {
    ensureLiveAndSafe('request_auto_settlement');
    if (!Array.isArray(items) || items.length === 0) throw new Error('INVALID_ITEMS');
    await preExecutionOwnerCheck({ batch: { items } });
    enforceOwnerDirective({ payout: { beneficiary: items[0]?.receiver || items[0]?.recipient_email || items[0]?.recipient_address } });
    estimateEconomicsForItems(items, 'bank_wire');
    const res = await this.fm.gateway.initiateAutoSettlement(payoutBatchId, items, idempotencyKey, actor);
    await this.audit.write({ id: `SETL_${payoutBatchId}`, timestamp: new Date().toISOString(), action: 'REQUEST_AUTO_SETTLEMENT', entity_id: payoutBatchId, actor, changes: { before: null, after: res }, context: { items_count: items.length } });
    return res;
  }
  async requestPayPalPayout({ payoutBatchId, items, idempotencyKey = crypto.randomUUID(), actor = 'SwarmAgent' }) {
    ensureLiveAndSafe('request_paypal_payout');
    if (!Array.isArray(items) || items.length === 0) throw new Error('INVALID_ITEMS');
    estimateEconomicsForItems(items, 'paypal');
    const res = await this.fm.gateway.initiatePayPalPayout(payoutBatchId, items, idempotencyKey, actor);
    await this.audit.write({ id: `PPY_${payoutBatchId}`, timestamp: new Date().toISOString(), action: 'REQUEST_PAYPAL_PAYOUT', entity_id: payoutBatchId, actor, changes: { before: null, after: res }, context: { items_count: items.length } });
    return res;
  }
  async updatePayoutStatus({ itemId, newStatus, txId = null, errorMessage = null, processedAt = null, actor = 'SwarmAgent' }) {
    const saved = await this.fm.gateway.updateExternalPayoutStatus(itemId, newStatus, txId, errorMessage, processedAt, actor);
    await this.audit.write({ id: `UPD_${itemId}`, timestamp: new Date().toISOString(), action: 'UPDATE_PAYOUT_STATUS', entity_id: itemId, actor, changes: { before: null, after: saved }, context: { newStatus, txId } });
    return saved;
  }
  async getGatewayBalance({ provider = 'paypal', actor = 'SwarmAgent' }) {
    ensureLiveAndSafe('get_gateway_balance');
    if (provider === 'paypal') {
      const b = await this.fm.gateway.getPayPalBalance(actor);
      await this.audit.write({ id: `BAL_${provider}_${Date.now()}`, timestamp: new Date().toISOString(), action: 'GET_BALANCE', entity_id: provider, actor, changes: { before: null, after: b }, context: {} });
      return b;
    }
    return { error: 'unsupported_provider' };
  }
  async requestBankWireTransfer({ payoutBatchId, items, idempotencyKey = crypto.randomUUID(), actor = 'SwarmAgent' }) {
    ensureLiveAndSafe('request_bank_wire_transfer');
    if (!Array.isArray(items) || items.length === 0) throw new Error('INVALID_ITEMS');
    await preExecutionOwnerCheck({ batch: { items } });
    enforceOwnerDirective({ payout: { beneficiary: items[0]?.receiver || items[0]?.recipient_email || items[0]?.recipient_address } });
    estimateEconomicsForItems(items, 'bank_wire');
    const res = await this.fm.gateway.initiateBankWireTransfer(payoutBatchId, items, idempotencyKey, actor);
    await this.audit.write({ id: `BW_${payoutBatchId}`, timestamp: new Date().toISOString(), action: 'REQUEST_BANK_WIRE', entity_id: payoutBatchId, actor, changes: { before: null, after: res }, context: { items_count: items.length } });
    return res;
  }
  async requestCryptoTransfer({ payoutBatchId, items, idempotencyKey = crypto.randomUUID(), actor = 'SwarmAgent' }) {
    ensureLiveAndSafe('request_crypto_transfer');
    if (!Array.isArray(items) || items.length === 0) throw new Error('INVALID_ITEMS');
    await preExecutionOwnerCheck({ batch: { items } });
    enforceOwnerDirective({ payout: { beneficiary: items[0]?.receiver || items[0]?.recipient_email || items[0]?.recipient_address } });
    estimateEconomicsForItems(items, 'crypto');
    const res = await this.fm.gateway.initiateCryptoTransfer(payoutBatchId, items, idempotencyKey, actor);
    await this.audit.write({ id: `CR_${payoutBatchId}`, timestamp: new Date().toISOString(), action: 'REQUEST_CRYPTO_TRANSFER', entity_id: payoutBatchId, actor, changes: { before: null, after: res }, context: { items_count: items.length } });
    return res;
  }

  async requestPayoneerTransfer({ payoutBatchId, items, idempotencyKey = crypto.randomUUID(), actor = 'SwarmAgent' }) {
    ensureLiveAndSafe('request_payoneer_transfer');
    if (!Array.isArray(items) || items.length === 0) throw new Error('INVALID_ITEMS');
    await preExecutionOwnerCheck({ batch: { items } });
    enforceOwnerDirective({ payout: { beneficiary: items[0]?.receiver || items[0]?.recipient_email || items[0]?.recipient_address } });
    estimateEconomicsForItems(items, 'payoneer');
    const res = await this.fm.gateway.initiatePayoneerTransfer(payoutBatchId, items, idempotencyKey, actor);
    await this.audit.write({ id: `PO_${payoutBatchId}`, timestamp: new Date().toISOString(), action: 'REQUEST_PAYONEER_TRANSFER', entity_id: payoutBatchId, actor, changes: { before: null, after: res }, context: { items_count: items.length } });
    return res;
  }
}
