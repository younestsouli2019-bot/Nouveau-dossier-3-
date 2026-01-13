
import { getPayPalBalance } from '../paypal-api.mjs';
import { PayPalGateway } from '../financial/gateways/PayPalGateway.mjs';
import { CryptoGateway } from '../financial/gateways/CryptoGateway.mjs';
import { BankWireGateway } from '../financial/gateways/BankWireGateway.mjs';
import { PayoneerGateway } from '../financial/gateways/PayoneerGateway.mjs';
import { StripeGateway } from '../financial/gateways/StripeGateway.mjs';
import { TronGateway } from '../financial/gateways/TronGateway.mjs';
import { InstructionGateway } from '../financial/gateways/InstructionGateway.mjs';
import { shouldAvoidPayPal } from '../policy/geopolicy.mjs';
import { getEffectiveRoutes } from '../policy/route-optimizer.mjs';
import { broadcastCrypto } from '../financial/broadcast/CryptoBroadcaster.mjs';
import { prepareBankWire } from '../financial/broadcast/BankWireBroadcaster.mjs';
import { broadcastPayoneer } from '../financial/broadcast/PayoneerBroadcaster.mjs';
import { broadcastStripe } from '../financial/broadcast/StripeBroadcaster.mjs';
import { withRetry } from '../core/retry.mjs';
import { enforceOwnerSettlementForRoute } from '../security/constitution-enforcer.mjs';
import { PrivacyMasker } from '../util/privacy-masker.mjs';
import { getPayoutBatchDetails } from '../paypal-api.mjs';
import fs from 'fs';
import path from 'path';

const PLATFORMS = [
  { id: 'bybit', name: 'Bybit' },
  { id: 'bitget', name: 'Bitget' },
  { id: 'mexc', name: 'MEXC' },
  { id: 'paypal', name: 'PayPal' },
  { id: 'payoneer', name: 'Payoneer' },
  { id: 'bank', name: 'Bank Wire' },
  { id: 'stripe', name: 'Stripe' },
  { id: 'tron', name: 'Tron' }
];
function getPlatform(id) {
  const k = String(id || '').toLowerCase();
  return PLATFORMS.find(p => p.id === k) || null;
}
function listPlatforms() {
  return PLATFORMS.slice();
}

export class ExternalGatewayManager {
  constructor(storage, auditLogger, executor) {
    this.storage = storage;
    this.audit = auditLogger;
    this.executor = executor;
    this.paypalGateway = new PayPalGateway();
    this.cryptoGateway = new CryptoGateway();
    this.bankGateway = new BankWireGateway();
    this.payoneerGateway = new PayoneerGateway();
    this.stripeGateway = new StripeGateway();
    this.tronGateway = new TronGateway();
    this.platformGateway = new InstructionGateway();
    // Route failover manager is loaded lazily to avoid import cycles
    this._routeManager = null;
  }

  /**
   * 1. Initiate PayPal Payout
   * Wraps the PayPalGateway to send money, enforcing idempotency and audit logging.
   */
  async initiatePayPalPayout(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    // 1. Idempotency Check
    const context = { action: 'INITIATE_PAYPAL_PAYOUT', actor, payoutBatchId };
    
    return this.executor.execute(idempotencyKey, async () => {
      console.log(`💸 [GATEWAY] Initiating PayPal Payout Batch: ${payoutBatchId}`);

      // 2. Validation
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error("No recipient items provided for payout.");
      }

      if (shouldAvoidPayPal()) {
        const cryptoTx = recipientItems.map(item => ({
          amount: Number(item.amount),
          currency: item.currency || 'USD',
          destination: item.crypto_address || item.recipient_address || item.recipient_email,
          reference: item.note || `Batch ${payoutBatchId}`
        }));
        const cryptoResult = await this.cryptoGateway.executeTransfer(cryptoTx);
        this.audit.log('CRYPTO_TRANSFER_PREPARED', payoutBatchId, null, cryptoResult, actor);
        return {
          status: cryptoResult.status === 'prepared' ? 'processing' : 'processing',
          gateway_response: cryptoResult,
          payout_batch_id: payoutBatchId,
          processed_at: new Date().toISOString()
        };
      }

      const transactions = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));

      // 4. Execute via Gateway
      // This handles the mode check (PAYOUT vs BILLING/INVOICE) internally
      const result = await this.paypalGateway.executePayout(transactions);

      // 5. Log Result
      const masked = transactions.map(t => ({
        amount: t.amount,
        currency: t.currency,
        masked_destination: PrivacyMasker.maskEmail(t.destination)
      }));
      this.audit.log('PAYPAL_PAYOUT_EXECUTED', payoutBatchId, null, result, actor, { masked_recipients: masked, reassurance: PrivacyMasker.reassurance('paypal') });

      return {
        status: result.status === 'IN_TRANSIT' ? 'success' : 'processing', // Map to agent's expected status
        gateway_response: result,
        payout_batch_id: payoutBatchId,
        processed_at: new Date().toISOString()
      };
    }, context);
  }

  /**
   * 2. Update External Payout Status
   * Allows agents to report back status updates or manually intervene.
   */
  async updateExternalPayoutStatus(payoutItemId, newStatus, externalTransactionId = null, errorMessage = null, processedAt = null, actor = 'System') {
    // This typically updates the 'events' or 'payouts' record in storage
    // We'll search for the event/item by ID.
    
    // Try to load from events first (assuming Payout Items are stored as events or linked)
    // For this implementation, we'll assume we are updating an 'Event' which represents the payout item.
    let record = this.storage.load('events', payoutItemId);
    let type = 'events';

    if (!record) {
      // Try payouts (schedules) - unlikely but possible
      record = this.storage.load('payouts', payoutItemId);
      type = 'payouts';
    }

    if (!record) {
      throw new Error(`Payout Item ${payoutItemId} not found in storage.`);
    }

    const oldState = { ...record };
    
    // Update fields
    record.status = newStatus; // processing, success, failed, refunded, unclaimed
    record.updated_at = new Date().toISOString();
    
    if (externalTransactionId) {
      record.metadata = record.metadata || {};
      record.metadata.external_transaction_id = externalTransactionId;
      record.metadata.paypal_transaction_id = externalTransactionId; // Legacy compat
    }
    
    if (errorMessage) {
      record.metadata = record.metadata || {};
      record.metadata.last_error = errorMessage;
      record.error_message = errorMessage;
    }

    if (processedAt) {
      record.metadata = record.metadata || {};
      record.metadata.processed_at = processedAt;
    }

    // Save
    const saved = this.storage.save(type, payoutItemId, record);
    
    // Audit
    this.audit.log('UPDATE_PAYOUT_STATUS', payoutItemId, oldState, saved, actor, { newStatus, externalTransactionId });
    
    return saved;
  }

  /**
   * 3. Get PayPal Balance
   * Direct fetch from PayPal API.
   */
  async getPayPalBalance(actor = 'System') {
    console.log(`💰 [GATEWAY] Fetching PayPal Balance...`);
    try {
      if (shouldAvoidPayPal()) {
        const skipped = { disabled: true, reason: 'restricted_region' };
        this.audit.log('PAYPAL_BALANCE_SKIPPED', 'PAYPAL_ACCOUNT', null, skipped, actor);
        return skipped;
      }
      const balanceData = await getPayPalBalance();
      this.audit.log('FETCH_PAYPAL_BALANCE', 'PAYPAL_ACCOUNT', null, balanceData, actor);
      return balanceData;
    } catch (error) {
      console.error(`❌ Failed to fetch PayPal balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * 4. Initiate Bank Wire Transfer (Explicit Rail)
   */
  async initiateBankWireTransfer(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_BANK_WIRE', actor, payoutBatchId };
    return this.executor.execute(idempotencyKey, async () => {
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const tx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_address || item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));
      const result = await withRetry(() => this.bankGateway.executeTransfer(tx));
      const masked = tx.map(t => ({
        amount: t.amount,
        currency: t.currency,
        masked_destination: PrivacyMasker.maskIBAN(t.destination)
      }));
      this.audit.log('BANK_WIRE_PREPARED', payoutBatchId, null, result, actor, { masked_recipients: masked, reassurance: PrivacyMasker.reassurance('bank_wire') });
      return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: 'bank_transfer' };
    }, context);
  }

  /**
   * 5. Initiate Crypto Transfer (Explicit Rail)
   */
  async initiateCryptoTransfer(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_CRYPTO_TRANSFER', actor, payoutBatchId };
    return this.executor.execute(idempotencyKey, async () => {
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const tx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_address || item.crypto_address || item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));
      const result = await withRetry(() => this.cryptoGateway.executeTransfer(tx));
      const masked = tx.map(t => ({
        amount: t.amount,
        currency: t.currency,
        masked_destination: PrivacyMasker.maskCryptoAddress(t.destination)
      }));
      this.audit.log('CRYPTO_TRANSFER_PREPARED', payoutBatchId, null, result, actor, { masked_recipients: masked, reassurance: PrivacyMasker.reassurance('crypto') });
      return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: 'crypto' };
    }, context);
  }
  
  async initiateBinanceCryptoBoxTransfer(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_BINANCE_CRYPTOBOX', actor, payoutBatchId };
    return this.executor.execute(idempotencyKey, async () => {
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const tx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_address || item.crypto_address || item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));
      const result = await withRetry(() => this.cryptoGateway.executeTransfer(tx, { provider: 'binance_cryptobox' }));
      const masked = tx.map(t => ({
        amount: t.amount,
        currency: t.currency,
        masked_destination: PrivacyMasker.maskCryptoAddress(t.destination)
      }));
      this.audit.log('CRYPTOBOX_PREPARED', payoutBatchId, null, result, actor, { masked_recipients: masked, reassurance: PrivacyMasker.reassurance('crypto') });
      return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: 'binance_cryptobox' };
    }, context);
  }

  /**
   * 6. Initiate Payoneer Transfer (Explicit Rail)
   */
  async initiatePayoneerTransfer(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_PAYONEER_TRANSFER', actor, payoutBatchId };
    return this.executor.execute(idempotencyKey, async () => {
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const tx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));
      const result = await withRetry(() => this.payoneerGateway.executeTransfer(tx));
      const masked = tx.map(t => ({
        amount: t.amount,
        currency: t.currency,
        masked_destination: PrivacyMasker.maskEmail(t.destination)
      }));
      this.audit.log('PAYONEER_TRANSFER_PREPARED', payoutBatchId, null, result, actor, { masked_recipients: masked, reassurance: PrivacyMasker.reassurance('payoneer') });
      return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: 'payoneer' };
    }, context);
  }

  /**
   * 7. Initiate Stripe Transfer (Explicit Rail)
   */
  async initiateStripeTransfer(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_STRIPE_TRANSFER', actor, payoutBatchId };
    return this.executor.execute(idempotencyKey, async () => {
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const tx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_address || item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));
      const result = await withRetry(() => this.stripeGateway.executeTransfer(tx));
      const masked = tx.map(t => ({
        amount: t.amount,
        currency: t.currency,
        masked_destination: PrivacyMasker.maskUnknown(t.destination)
      }));
      this.audit.log('STRIPE_TRANSFER_PREPARED', payoutBatchId, null, result, actor, { masked_recipients: masked, reassurance: PrivacyMasker.reassurance('stripe') });
      return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: 'stripe' };
    }, context);
  }

  async initiateTronTransfer(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_TRON_TRANSFER', actor, payoutBatchId };
    return this.executor.execute(idempotencyKey, async () => {
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const tx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USDT',
        destination: item.recipient_address || item.crypto_address || process.env.OWNER_TRON_USDT_ADDRESS,
        reference: item.note || `Batch ${payoutBatchId}`
      }));
      const result = await this.tronGateway.generateInstructions(tx);
      this.audit.log('TRON_INSTRUCTIONS_READY', payoutBatchId, null, result, actor);
      return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: 'tron' };
    }, context);
  }

  async initiateAutoSettlement(payoutBatchId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_AUTO_SETTLEMENT', actor, payoutBatchId };
    return this.executor.execute(idempotencyKey, async () => {
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const amount0 = recipientItems[0]?.amount;
      const currency0 = recipientItems[0]?.currency || 'USD';
      const routes = getEffectiveRoutes(amount0, currency0);
      const baseTx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_address || item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));

      if (!this._routeManager) {
        // Lazy load to avoid top-level import cycle
        const { RouteManager } = await import('../util/RouteManager.mjs');
        this._routeManager = new RouteManager({ routes });
      }

      const attempt = async ({ route }) => {
        let result = null;
        if (route === 'bank_transfer') {
          const tx = enforceOwnerSettlementForRoute(route, baseTx);
          result = await withRetry(() => this.bankGateway.executeTransfer(tx));
          this.audit.log('BANK_WIRE_PREPARED', payoutBatchId, null, result, actor, { reassurance: PrivacyMasker.reassurance('bank_wire') });
          return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: route };
        }
        if (route === 'crypto') {
          const tx = enforceOwnerSettlementForRoute(route, baseTx);
          result = await withRetry(() => this.cryptoGateway.executeTransfer(tx));
          this.audit.log('CRYPTO_TRANSFER_PREPARED', payoutBatchId, null, result, actor, { reassurance: PrivacyMasker.reassurance('crypto') });
          return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: route };
        }
        if (route === 'payoneer') {
          const tx = enforceOwnerSettlementForRoute(route, baseTx);
          result = await withRetry(() => this.payoneerGateway.executeTransfer(tx));
          this.audit.log('PAYONEER_TRANSFER_PREPARED', payoutBatchId, null, result, actor, { reassurance: PrivacyMasker.reassurance('payoneer') });
          return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: route };
        }
        if (route === 'payoneer_standard') {
          const tx = enforceOwnerSettlementForRoute('payoneer', baseTx);
          const instr = await withRetry(() => this.platformGateway.generate('payoneer', tx, 'Instruction for Payoneer Standard'));
          this.audit.log('PAYONEER_STANDARD_INSTRUCTIONS_READY', payoutBatchId, null, instr, actor, { reassurance: PrivacyMasker.reassurance('payoneer') });
          return { status: 'processing', gateway_response: instr, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: route };
        }
        if (route === 'stripe') {
          const tx = enforceOwnerSettlementForRoute(route, baseTx);
          result = await withRetry(() => this.stripeGateway.executeTransfer(tx));
          this.audit.log('STRIPE_TRANSFER_PREPARED', payoutBatchId, null, result, actor, { reassurance: PrivacyMasker.reassurance('stripe') });
          return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: route };
        }
        if (route === 'paypal') {
          if (shouldAvoidPayPal()) {
            throw new Error('paypal_disallowed_by_policy');
          }
          const tx = enforceOwnerSettlementForRoute(route, baseTx);
          const paypalTx = tx.map(t => ({ amount: t.amount, currency: t.currency, destination: t.destination, reference: t.reference }));
          const resultPayPal = await withRetry(() => this.paypalGateway.executePayout(paypalTx));
          const masked = paypalTx.map(t => ({ amount: t.amount, currency: t.currency, masked_destination: PrivacyMasker.maskEmail(t.destination) }));
          this.audit.log('PAYPAL_PAYOUT_EXECUTED', payoutBatchId, null, resultPayPal, actor, { masked_recipients: masked, reassurance: PrivacyMasker.reassurance('paypal') });
          return { status: resultPayPal.status === 'IN_TRANSIT' ? 'success' : 'processing', gateway_response: resultPayPal, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: route };
        }
        throw new Error(`unknown_route:${route}`);
      };

      const res = await this._routeManager.withFailover(attempt, {
        onAttempt: ({ route, attempt, remaining }) => {
          this.audit.log('ROUTE_ATTEMPT', payoutBatchId, null, { route, attempt, remaining }, actor);
        }
      });

      if (!res.ok) {
        this.audit.log('ALL_ROUTES_FAILED', payoutBatchId, null, { tried: res.tried, error: res.error }, actor);
        throw new Error(res.error || 'all routes failed');
      }
      return res.result;
    }, context);
  }

// Builder Notes:
// - initiateAutoSettlement now uses RouteManager failover. Order comes from policy/getEffectiveRoutes or env ROUTE_LIST.
// - Route health is persisted to data/locks/route-health.json to avoid flapping after restarts.
// - To tune behavior, set ROUTE_BACKOFF_BASE_MS, ROUTE_BACKOFF_MAX_MS, ROUTE_WEIGHTS_JSON.
// - If you need per-route capability/limit constraints, extend getEffectiveRoutes to filter routes before passing to RouteManager.

  async broadcastSettlement(route, prepared, transactions, actor = 'System') {
    if (route === 'bank_transfer') {
      const r = await withRetry(() => prepareBankWire(transactions));
      this.audit.log('BANK_WIRE_FILE_READY', prepared?.payout_batch_id || null, null, r, actor);
      return r;
    }
    if (route === 'crypto') {
      const r = await withRetry(() => broadcastCrypto(transactions));
      this.audit.log('CRYPTO_BROADCAST_RESULT', prepared?.payout_batch_id || null, null, r, actor);
      return r;
    }
    if (route === 'payoneer') {
      const r = await withRetry(() => broadcastPayoneer(transactions));
      this.audit.log('PAYONEER_BROADCAST_RESULT', prepared?.payout_batch_id || null, null, r, actor);
      return r;
    }
    if (route === 'stripe') {
      const r = await withRetry(() => broadcastStripe(transactions));
      this.audit.log('STRIPE_BROADCAST_RESULT', prepared?.payout_batch_id || null, null, r, actor);
      return r;
    }
    if (route === 'paypal') {
      return { status: 'prepared' };
    }
    return { status: 'unknown_route' };
  }

  async getPayPalPayoutBatchStatus(payoutBatchId, actor = 'System') {
    try {
      const res = await getPayoutBatchDetails(payoutBatchId);
      const header = res?.batch_header || {};
      const status = header?.batch_status || 'unknown';
      this.audit.log('QUERY_PAYPAL_PAYOUT_STATUS', payoutBatchId, null, header, actor);
      return {
        route: 'paypal',
        payout_batch_id: header?.payout_batch_id || payoutBatchId,
        status,
        raw: res
      };
    } catch (e) {
      this.audit.log('QUERY_PAYPAL_PAYOUT_STATUS_FAILED', payoutBatchId, null, { error: e?.message || String(e) }, actor);
      return { route: 'paypal', payout_batch_id: payoutBatchId, status: 'error', error: e?.message || String(e) };
    }
  }

  async getBankWireStatus(batchId, actor = 'System') {
    const dir = path.join(process.cwd(), 'settlements', 'bank_wires');
    try {
      if (!fs.existsSync(dir)) return { route: 'bank_transfer', batch_id: batchId, status: 'not_found' };
      const files = fs.readdirSync(dir).filter(f => f.includes(batchId));
      const status = files.length > 0 ? 'INVOICES_GENERATED' : 'not_found';
      this.audit.log('QUERY_BANK_WIRE_STATUS', batchId, null, { files }, actor);
      return { route: 'bank_transfer', batch_id: batchId, status, files };
    } catch (e) {
      this.audit.log('QUERY_BANK_WIRE_STATUS_FAILED', batchId, null, { error: e?.message || String(e) }, actor);
      return { route: 'bank_transfer', batch_id: batchId, status: 'error', error: e?.message || String(e) };
    }
  }

  async getCryptoStatus({ address, amount, provider = 'binance' }, actor = 'System') {
    try {
      const r = await this.cryptoGateway.getWithdrawalStatus({ provider, address, amount });
      this.audit.log('QUERY_CRYPTO_STATUS', address || 'UNKNOWN', null, r, actor);
      return { route: 'crypto', provider, status: r.status, txId: r.txId || null, raw: r };
    } catch (e) {
      this.audit.log('QUERY_CRYPTO_STATUS_FAILED', address || 'UNKNOWN', null, { error: e?.message || String(e) }, actor);
      return { route: 'crypto', provider, status: 'error', error: e?.message || String(e) };
    }
  }

  async getPayoneerStatus(batchId, actor = 'System') {
    // Placeholder: Implement Payoneer status query via API when credentials available
    this.audit.log('QUERY_PAYONEER_STATUS', batchId, null, { note: 'not_implemented' }, actor);
    return { route: 'payoneer', batch_id: batchId, status: 'unknown' };
  }

  async getStripeStatus(batchId, actor = 'System') {
    // Placeholder: Implement Stripe status query via API when credentials available
    this.audit.log('QUERY_STRIPE_STATUS', batchId, null, { note: 'not_implemented' }, actor);
    return { route: 'stripe', batch_id: batchId, status: 'unknown' };
  }

  async getSettlementStatus(route, ref, actor = 'System') {
    const r = String(route || '').toLowerCase();
    if (r === 'paypal') return this.getPayPalPayoutBatchStatus(ref, actor);
    if (r === 'bank_transfer') return this.getBankWireStatus(ref, actor);
    if (r === 'crypto') {
      const addr = typeof ref === 'object' ? ref.address : ref;
      const amt = typeof ref === 'object' ? ref.amount : null;
      return this.getCryptoStatus({ address: addr, amount: amt }, actor);
    }
    if (r === 'payoneer') return this.getPayoneerStatus(ref, actor);
    if (r === 'stripe') return this.getStripeStatus(ref, actor);
    if (r === 'tron') {
      const addr = typeof ref === 'object' ? ref.address : ref;
      const amt = typeof ref === 'object' ? ref.amount : null;
      try {
        const res = await this.tronGateway.checkIncoming({ address: addr, minAmount: amt || 0 });
        this.audit.log('QUERY_TRON_STATUS', addr || 'UNKNOWN', null, res, actor);
        if (res.status === 'RECEIVED') {
          const outDir = path.join(process.cwd(), 'exports', 'receipts');
          fs.mkdirSync(outDir, { recursive: true });
          const file = path.join(outDir, `crypto_tron_received_${Date.now()}.json`);
          const receipt = {
            network: 'TRON',
            type: 'USDT_TRC20_RECEIVE',
            tx_id: res.txId,
            amount: res.amount,
            to_masked: PrivacyMasker.maskCryptoAddress(addr || ''),
            reassurance: PrivacyMasker.reassurance('tron'),
            status: 'confirmed',
            confirmed_at: new Date().toISOString()
          };
          fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
        }
        return { route: 'tron', status: res.status, txId: res.txId || null, raw: res };
      } catch (e) {
        this.audit.log('QUERY_TRON_STATUS_FAILED', addr || 'UNKNOWN', null, { error: e?.message || String(e) }, actor);
        return { route: 'tron', status: 'error', error: e?.message || String(e) };
      }
    }
    if (r === 'platform') {
      const id = typeof ref === 'object' ? ref.provider : ref;
      const res = await this.platformGateway.check(id);
      this.audit.log('QUERY_PLATFORM_STATUS', id || 'UNKNOWN', null, res, actor);
      return { route: 'platform', provider: id, status: res.status, raw: res };
    }
    return { route: r, status: 'unknown_route' };
  }

  async initiatePlatformInstruction(payoutBatchId, providerId, recipientItems, idempotencyKey, actor = 'System') {
    const context = { action: 'INITIATE_PLATFORM_INSTRUCTION', actor, payoutBatchId, providerId };
    return this.executor.execute(idempotencyKey, async () => {
      const p = getPlatform(providerId);
      if (!p) throw new Error(`Unknown platform: ${providerId}`);
      if (!recipientItems || recipientItems.length === 0) {
        throw new Error('No recipient items provided');
      }
      const tx = recipientItems.map(item => ({
        amount: Number(item.amount),
        currency: item.currency || 'USD',
        destination: item.recipient_address || item.recipient_email || item.email,
        reference: item.note || `Batch ${payoutBatchId}`
      }));
      const result = await this.platformGateway.generate(providerId, tx, `Instruction for ${p.name}`);
      this.audit.log('PLATFORM_INSTRUCTIONS_READY', payoutBatchId, null, result, actor);
      return { status: 'processing', gateway_response: result, payout_batch_id: payoutBatchId, processed_at: new Date().toISOString(), route_attempted: `platform:${providerId}` };
    }, context);
  }

  listSupportedPlatforms() {
    return listPlatforms();
  }

  subscribeSettlementStatus(route, ref, onUpdate, intervalMs = 2000) {
    const timer = setInterval(async () => {
      try {
        const s = await this.getSettlementStatus(route, ref, 'AgentSubscriber');
        if (typeof onUpdate === 'function') onUpdate(s);
      } catch {}
    }, Math.max(200, Number(intervalMs || 2000)));
    return { stop: () => clearInterval(timer) };
  }
}
