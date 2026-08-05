import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync } from 'fs';
import supplierRegistry from './supplier-registry.mjs';
import escrowEngine from '../settlement/escrow.mjs';
import immutableLedger from '../settlement/immutable-ledger.mjs';
import didRegistry from '../settlement/did-registry.mjs';
import abacEngine from '../security/abac.mjs';
import auditLog from '../security/audit.mjs';

function resolveOrdersDir(opts = {}) {
  return path.resolve(opts.baseDir || process.env.SWARM_PROCUREMENT_DIR || path.join(process.cwd(), 'data', 'procurement'));
}

class ProcurementAgent {
  #orders = null;
  #ordersPath = null;
  #dir = null;
  #initialized = false;
  #registry = null;
  #escrow = null;
  #ledger = null;
  #did = null;
  #abac = null;
  #audit = null;

  async init(opts = {}) {
    this.#dir = resolveOrdersDir(opts);
    await fs.mkdir(this.#dir, { recursive: true });
    this.#ordersPath = path.join(this.#dir, 'orders.json');
    if (existsSync(this.#ordersPath)) {
      try {
        this.#orders = JSON.parse(await fs.readFile(this.#ordersPath, 'utf-8'));
      } catch {
        this.#orders = { version: 1, orders: [] };
      }
    } else {
      this.#orders = { version: 1, orders: [] };
      await this.#persist();
    }
    this.#registry = opts.supplierRegistry || supplierRegistry;
    this.#escrow = opts.escrow || escrowEngine;
    this.#ledger = opts.ledger || immutableLedger;
    this.#did = opts.didRegistry || didRegistry;
    this.#abac = opts.abac || abacEngine;
    this.#audit = opts.audit || auditLog;
    this.#initialized = true;
    return this;
  }

  async #persist() {
    const tmp = this.#ordersPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.#orders, null, 2), 'utf-8');
    await fs.rename(tmp, this.#ordersPath);
  }

  autoMaxUSD() {
    return Number(process.env.PROCUREMENT_AUTO_MAX_USD || 1000);
  }

  async detectDeficit({ item = null, currentStock = 0, reorderPoint = 0, demand = 0, kind = 'inventory', agent = 'procurement-agent' } = {}) {
    await this.#ensureInit();
    const deficit = demand - currentStock;
    const triggered = currentStock <= reorderPoint;
    const signal = {
      signalId: `SIGNAL_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      item,
      kind,
      currentStock,
      reorderPoint,
      demand,
      deficit: Math.max(0, deficit),
      triggered,
      at: new Date().toISOString(),
      agent,
    };
    await this.#audit.append({ actor: agent, action: 'PROCUREMENT_SIGNAL', resource: item || 'unknown', result: triggered ? 'triggered' : 'ok', detail: { signalId: signal.signalId, deficit: signal.deficit } });
    return signal;
  }

  async requestQuotes({ item, category = 'general', suppliers = null, quantity = 1, currency = 'USD' } = {}) {
    await this.#ensureInit();
    let candidates = suppliers;
    if (!candidates) candidates = await this.#registry.list({ status: 'approved' });
    if (category) candidates = candidates.filter(s => s.category === category);
    const quotes = [];
    for (const s of candidates) {
      const base = s.avgCost || 1;
      const jitter = 0.9 + (crypto.randomBytes(1)[0] % 21) / 100;
      const price = Math.round(base * jitter * quantity * 100) / 100;
      quotes.push({
        supplierId: s.supplierId,
        name: s.name,
        rail: s.rail,
        price,
        currency,
        speedHours: s.avgSpeedHours,
        reputation: s.reputation,
        quantity,
        quotedAt: new Date().toISOString(),
      });
    }
    return quotes;
  }

  async selectBid(quotes = [], weights = { cost: 0.4, speed: 0.3, reputation: 0.3 }) {
    await this.#ensureInit();
    if (!quotes.length) return null;
    const maxSpeed = Math.max(...quotes.map(q => q.speedHours)) || 1;
    const maxCost = Math.max(...quotes.map(q => q.price)) || 1;
    const scored = quotes.map(q => {
      const costScore = 1 - q.price / maxCost;
      const speedScore = 1 - q.speedHours / maxSpeed;
      const repScore = q.reputation;
      const total = weights.cost * costScore + weights.speed * speedScore + weights.reputation * repScore;
      return { ...q, costScore, speedScore, repScore, score: Math.round(total * 10000) / 10000 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  async createOrder({ item, quantity, currency, rail, quote = null, supplierId = null, purpose = null, agent = 'procurement-agent', ownerClaim = null, forceApproval = false, sourceAccount = 'OPERATING_RESERVE' } = {}) {
    await this.#ensureInit();
    let selected = quote;
    if (!selected) {
      const suppliers = supplierId ? [await this.#registry.resolve(supplierId)] : null;
      selected = await this.selectBid(await this.requestQuotes({ item, quantity, currency, suppliers }));
    }
    if (!selected) throw new Error('Procurement: no quote selected');
    const supplier = await this.#registry.resolve(selected.supplierId);
    if (!supplier) throw new Error(`Procurement: supplier ${selected.supplierId} not in registry`);
    if (supplier.status !== 'approved') {
      throw new Error(`Procurement: supplier ${supplier.name} is not owner-approved (status=${supplier.status})`);
    }

    const amount = selected.price;
    const spendCap = supplier.spendCapUSD && supplier.spendCapUSD > 0 ? supplier.spendCapUSD : Infinity;
    const cap = Math.min(this.autoMaxUSD(), spendCap);
    const autoAllowed = !forceApproval && amount <= cap;

    let abac;
    try {
      abac = await this.#abac.evaluate({
        subject: { role: ownerClaim ? 'owner' : 'agent', ownerClaim },
        action: 'procurement.execute',
        resource: `order:${item}`,
        env: { liveMode: process.env.SWARM_LIVE === 'true' },
      });
    } catch {
      abac = { decision: 'hitl', reason: 'abac_unavailable_fail_closed' };
    }

    const order = {
      orderId: `ORDER_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      item,
      quantity,
      currency,
      rail,
      amount,
      supplierId: supplier.supplierId,
      supplierName: supplier.name,
      purpose: purpose || `procure:${item}`,
      agent,
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      abac,
    };

    if (!autoAllowed || abac.decision !== 'allow') {
      order.status = 'PENDING_APPROVAL';
      const approval = await this.#abac.requestApproval({
        action: 'procurement.execute',
        detail: { orderId: order.orderId, item, amount, supplier: supplier.name, rail },
        actor: agent,
      });
      order.approvalId = approval.approvalId;
      await this.#audit.append({ actor: agent, action: 'PROCUREMENT_ORDER_NEEDS_APPROVAL', resource: order.orderId, result: 'pending', detail: { amount, supplier: supplier.name, approvalId: approval.approvalId } });
    } else {
      order.status = 'ESCROWING';
      await this.#audit.append({ actor: agent, action: 'PROCUREMENT_ORDER_AUTO_APPROVED', resource: order.orderId, result: 'auto', detail: { amount, supplier: supplier.name, reason: 'within_auto_threshold' } });
    }

    this.#orders.orders.push(order);
    await this.#persist();
    return order;
  }

  async fundEscrow(orderId, opts = {}) {
    await this.#ensureInit();
    const order = this.#find(orderId);
    if (!order) throw new Error(`Procurement: order ${orderId} not found`);
    if (order.status === 'PENDING_APPROVAL') {
      if (!order.approvalId) throw new Error(`Procurement: order ${orderId} has no approval request`);
      const approvals = await this.#abac.listApprovals();
      const approval = approvals.find(a => a.id === order.approvalId);
      if (!approval || approval.status !== 'approved') {
        throw new Error(`Procurement: order ${orderId} not yet approved by owner (approvalId=${order.approvalId}, status=${approval ? approval.status : 'missing'})`);
      }
    }
    const escrow = await this.#escrow.createEscrow({
      txId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      destination: order.supplierId,
      sourceAccount: opts.sourceAccount || 'OPERATING_RESERVE',
      purpose: order.purpose,
      agent: order.agent,
      signers: opts.signers || ['owner', 'compliance', 'oracle', order.agent],
      quorum: opts.quorum != null ? opts.quorum : Number(process.env.PROCUREMENT_ESCROW_QUORUM || 1),
      lockHours: opts.lockHours != null ? opts.lockHours : Number(process.env.PROCUREMENT_ESCROW_LOCK_HOURS || 0),
    });
    order.escrowId = escrow.escrowId;
    order.status = 'ESCROWED';
    order.fundedAt = new Date().toISOString();

    await this.#ledger.record(order.orderId, 'procurement_escrow', [
      { leg: 'debit', account: 'OPERATING_RESERVE', amount: order.amount, currency: order.currency, reference: order.orderId, payload: { supplier: order.supplierName, escrowId: escrow.escrowId } },
    ], { agent: order.agent });
    await this.#audit.append({ actor: order.agent, action: 'PROCUREMENT_ESCROW_FUNDED', resource: order.orderId, result: 'escrowed', detail: { escrowId: escrow.escrowId, amount: order.amount, currency: order.currency } });
    await this.#persist();
    return { order, escrow };
  }

  async trackExecution(orderId, opts = {}) {
    await this.#ensureInit();
    const order = this.#find(orderId);
    if (!order) throw new Error(`Procurement: order ${orderId} not found`);
    order.status = 'IN_EXECUTION';
    order.execution = {
      startedAt: new Date().toISOString(),
      engine: opts.engine || 'execution-swarm',
      provider: opts.provider || null,
      tracking: opts.tracking || null,
    };
    await this.#audit.append({ actor: order.agent, action: 'PROCUREMENT_EXECUTION_STARTED', resource: order.orderId, result: 'in_execution', detail: order.execution });
    await this.#persist();
    return order;
  }

  async submitPoD(orderId, { proof = null, verifier = 'compliance', signature = null, quality = true } = {}) {
    await this.#ensureInit();
    const order = this.#find(orderId);
    if (!order) throw new Error(`Procurement: order ${orderId} not found`);
    if (!order.escrowId) throw new Error(`Procurement: order ${orderId} has no escrow to verify`);

    if (signature) {
      const ok = await this.#did.verify(signature.did, signature.message, signature.value);
      if (!ok) throw new Error('Procurement: PoD signature verification failed');
    }

    const escrow = await this.#escrow.verify(order.escrowId, verifier, quality);
    if (quality) {
      await this.#escrow.confirmByOracle(order.escrowId, verifier === 'oracle' ? verifier : 'oracle_gateway', { proof, orderId: order.orderId });
      await this.#did.register(order.agent);
      await this.#escrow.sign(order.escrowId, order.agent, await this.#did.sign(order.agent, order.orderId));
    }
    order.status = 'POD_VERIFIED';
    order.pod = { proof, verifier, quality, at: new Date().toISOString(), escrowId: order.escrowId, escrowStatus: escrow.status };

    await this.#ledger.record(order.orderId, 'procurement_pod', [
      { leg: 'credit', account: `SUPPLIER_${order.supplierId}`, amount: order.amount, currency: order.currency, reference: order.orderId, payload: { proof, verifier, quality } },
    ], { agent: order.agent });
    await this.#audit.append({ actor: order.agent, action: 'PROCUREMENT_POD_VERIFIED', resource: order.orderId, result: 'verified', detail: { verifier, quality } });
    await this.#persist();
    return order;
  }

  async settleOrder(orderId, opts = {}) {
    await this.#ensureInit();
    const order = this.#find(orderId);
    if (!order) throw new Error(`Procurement: order ${orderId} not found`);
    if (order.status !== 'POD_VERIFIED') throw new Error(`Procurement: order ${orderId} must be POD_VERIFIED before settlement`);

    const released = await this.#escrow.release(order.escrowId);
    order.status = 'SETTLED';
    order.settledAt = new Date().toISOString();
    order.settlement = {
      escrowId: order.escrowId,
      releasedAt: released.releasedAt,
      rail: order.rail,
      gatewayRef: opts.gatewayRef || null,
      destination: order.supplierId,
    };

    await this.#ledger.record(order.orderId, 'procurement_settled', [
      { leg: 'debit', account: `ESCROW_${order.currency}_PROCUREMENT`, amount: order.amount, currency: order.currency, reference: order.orderId, payload: { supplier: order.supplierName, rail: order.rail } },
      { leg: 'credit', account: `SUPPLIER_${order.supplierId}`, amount: order.amount, currency: order.currency, reference: order.orderId, payload: { gatewayRef: order.settlement.gatewayRef } },
    ], { agent: order.agent });
    await this.#audit.append({ actor: order.agent, action: 'PROCUREMENT_SETTLED', resource: order.orderId, result: 'settled', detail: { amount: order.amount, currency: order.currency, supplier: order.supplierName, escrowId: order.escrowId } });
    await this.#persist();
    return order;
  }

  async status() {
    await this.#ensureInit();
    const byStatus = {};
    let totalUSD = 0;
    for (const o of this.#orders.orders) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      if (o.status === 'SETTLED') totalUSD += o.amount;
    }
    return {
      orders: this.#orders.orders.length,
      byStatus,
      settledTotalUSD: Math.round(totalUSD * 100) / 100,
      autoMaxUSD: this.autoMaxUSD(),
      ordersList: this.#orders.orders.map(o => ({ orderId: o.orderId, item: o.item, amount: o.amount, currency: o.currency, supplier: o.supplierName, status: o.status, escrowId: o.escrowId || null, approvalId: o.approvalId || null })),
    };
  }

  listOrders() {
    this.#ensureInit();
    return this.#orders.orders;
  }

  getOrder(orderId) {
    this.#ensureInit();
    return this.#find(orderId);
  }

  #find(orderId) {
    return this.#orders.orders.find(o => o.orderId === orderId);
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('ProcurementAgent not initialized. Call init() first.');
  }
}

const procurementAgent = new ProcurementAgent();
export default procurementAgent;
export { ProcurementAgent };
