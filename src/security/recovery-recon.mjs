import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import ownerGuard from './owner-guard.mjs';
import auditLog from './audit.mjs';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

function rootPath() {
  return process.env.SWARM_ROOT || process.cwd();
}

async function readJson(relPath) {
  const p = path.join(rootPath(), relPath);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch {
    return null;
  }
}

const STUCK_TRANSIT_MS = 72 * 3600 * 1000;

class RecoveryRecon {
  #dir = null;
  #ledgerPath = null;
  #items = new Map();
  #initialized = false;
  #ownerGuard = null;
  #auditLog = null;

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'recovery');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#ledgerPath = path.join(this.#dir, 'recovery-ledger.json');
    await this.#load();
    this.#ownerGuard = opts.ownerGuard || ownerGuard;
    this.#auditLog = opts.auditLog || auditLog;
    this.#initialized = true;
    return this;
  }

  async #load() {
    if (existsSync(this.#ledgerPath)) {
      try {
        const rec = JSON.parse(await fs.readFile(this.#ledgerPath, 'utf-8'));
        for (const item of rec.items || []) {
          this.#items.set(item.id, item);
        }
      } catch {
        this.#items = new Map();
      }
    }
  }

  async #persist() {
    await fs.mkdir(this.#dir, { recursive: true });
    const rec = { schema: 'recovery-ledger-v1', generatedAt: new Date().toISOString(), items: [...this.#items.values()] };
    const tmp = this.#ledgerPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(rec, null, 2), 'utf-8');
    await fs.rename(tmp, this.#ledgerPath);
  }

  async scan({ actor = 'system' } = {}) {
    this.#ensureInit();
    const found = new Map();

    const ledger = await readJson('data/financial/settlement_ledger.json');
    if (ledger && Array.isArray(ledger.transactions)) {
      for (const tx of ledger.transactions) {
        if (!tx.id) continue;
        if (tx.status === 'IN_TRANSIT') {
          const ts = Date.parse(tx.timestamp) || Date.now();
          if (Date.now() - ts > STUCK_TRANSIT_MS) {
            const dest = tx.details?.destination || null;
            const ownerSafe = dest ? this.#ownerGuard.isOwnerEmail(dest) || this.#ownerGuard.isOwnerName(dest) : true;
            found.set(`stuck:${tx.id}`, this.#item(`stuck:${tx.id}`, 'stuck_transit', tx.amount, tx.currency || 'USD', tx.status, 'data/financial/settlement_ledger.json', { txId: tx.id, destination: dest, ownerSafe }));
          }
        }
        if (tx.status === 'RECONCILED_RECEIVING_READY') {
          const dest = tx.details?.destination || tx.legacy_reconciled?.destination || null;
          if (dest && !this.#ownerGuard.isOwnerEmail(dest)) {
            found.set(`misrouted:${tx.id}`, this.#item(`misrouted:${tx.id}`, 'non_owner_destination', tx.amount, tx.currency || 'USD', tx.status, 'data/financial/settlement_ledger.json', { txId: tx.id, destination: dest }));
          }
        }
      }
    }

    const batches = await readJson('data/base44_export/PayoutBatch.json');
    if (Array.isArray(batches)) {
      for (const b of batches) {
        const id = b.batch_id || b.id;
        if (!id) continue;
        if (b.status === 'pending_approval') {
          found.set(`batch:${id}`, this.#item(`batch:${id}`, 'pending_approval_batch', b.total_amount, b.currency || 'USD', b.status, 'data/base44_export/PayoutBatch.json', { batchId: id, notes: b.notes }));
        }
        if (b.status === 'submitted' || b.status === 'submitted_to_paypal') {
          if (b.paypal_batch_id == null) {
            found.set(`batch:${id}`, this.#item(`batch:${id}`, 'undisbursed_batch', b.total_amount, b.currency || 'USD', b.status, 'data/base44_export/PayoutBatch.json', { batchId: id, paypalBatchId: null, notes: b.notes }));
          }
        }
      }
    }

    const revEvents = await readJson('data/base44_export/RevenueEvent.json');
    if (Array.isArray(revEvents)) {
      for (const e of revEvents) {
        const id = e.event_id || e.id;
        if (!id) continue;
        const status = e.status || '';
        if ((status === 'earned' || status === 'confirmed') && !e.payout_batch_id) {
          found.set(`revenue:${id}`, this.#item(`revenue:${id}`, 'unbatched_revenue', e.amount, e.currency || 'USD', status, 'data/base44_export/RevenueEvent.json', { eventId: id, source: e.source, notes: e.notes }));
        }
        const ben = this.#ownerGuard.validateRevenueEventBeneficiary(e);
        if (!ben.ownerSafe) {
          const dest = e.metadata?.customer_email || e.destination || null;
          if (dest && !this.#ownerGuard.isOwnerEmail(dest)) {
            found.set(`beneficiary:${id}`, this.#item(`beneficiary:${id}`, 'non_owner_beneficiary', e.amount, e.currency || 'USD', status, 'data/base44_export/RevenueEvent.json', { eventId: id, problems: ben.problems }));
          }
        }
      }
    }

    const autoState = await readJson('.autonomous-state.json');
    if (autoState && autoState.exportedPayoneerBatches) {
      for (const [batchId, b] of Object.entries(autoState.exportedPayoneerBatches)) {
        if (b.status === 'completed' && !b.external_disbursed) {
          found.set(`payoneer:${batchId}`, this.#item(`payoneer:${batchId}`, 'payoneer_undisbursed', b.amount, b.currency || 'USD', b.status, '.autonomous-state.json', { batchId, metadata: b.metadata }));
        }
      }
    }

    for (const [id, fresh] of found) {
      const existing = this.#items.get(id);
      if (existing && (existing.state === 'approved' || existing.state === 'resolved')) {
        const merged = { ...fresh, state: existing.state, approvedBy: existing.approvedBy, approvedAt: existing.approvedAt, resolution: existing.resolution };
        this.#items.set(id, merged);
      } else {
        this.#items.set(id, fresh);
      }
    }

    for (const id of [...this.#items.keys()]) {
      if (!found.has(id) && this.#items.get(id).state !== 'resolved') {
        this.#items.delete(id);
      }
    }

    await this.#persist();
    await this.#auditLog.append({ actor, action: 'RECOVERY_SCAN', resource: 'recovery-ledger', result: { items: found.size } });
    return this.totals();
  }

  #item(id, category, amount, currency, status, source, evidence) {
    return {
      id,
      category,
      amount: typeof amount === 'number' ? amount : Number(amount) || 0,
      currency: currency || 'USD',
      status,
      source,
      evidence,
      state: 'detected',
      detectedAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null,
      resolution: null,
    };
  }

  async listItems({ state = null, category = null } = {}) {
    this.#ensureInit();
    let items = [...this.#items.values()];
    if (state) items = items.filter(i => i.state === state);
    if (category) items = items.filter(i => i.category === category);
    return items.sort((a, b) => b.amount - a.amount);
  }

  totals() {
    this.#ensureInit();
    const items = [...this.#items.values()];
    const byCategory = {};
    for (const i of items) {
      byCategory[i.category] = (byCategory[i.category] || 0) + i.amount;
    }
    return {
      total: round2(items.reduce((s, i) => s + (i.state === 'resolved' ? 0 : i.amount), 0)),
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round2(v)])),
      count: items.length,
      resolvedCount: items.filter(i => i.state === 'resolved').length,
      generatedAt: new Date().toISOString(),
      sources: ['data/financial/settlement_ledger.json', 'data/base44_export/PayoutBatch.json', 'data/base44_export/RevenueEvent.json', '.autonomous-state.json'],
    };
  }

  async approveItem({ id, ownerClaim, actor = 'owner' } = {}) {
    this.#ensureInit();
    const item = this.#items.get(id);
    if (!item) throw new Error(`RecoveryRecon: unknown item ${id}`);
    const v = this.#ownerGuard.assertBeneficiary({ ownerClaim });
    if (item.state === 'resolved') throw new Error(`RecoveryRecon: item ${id} already resolved`);
    item.state = 'approved';
    item.approvedBy = v.ownerId;
    item.approvedAt = new Date().toISOString();
    await this.#persist();
    await this.#auditLog.append({ actor, action: 'RECOVERY_APPROVE', resource: id, result: 'approved', detail: { amount: item.amount, currency: item.currency } });
    return item;
  }

  async resolveItem({ id, ownerClaim, reference, actor = 'owner' } = {}) {
    this.#ensureInit();
    const item = this.#items.get(id);
    if (!item) throw new Error(`RecoveryRecon: unknown item ${id}`);
    if (item.state !== 'approved') throw new Error(`RecoveryRecon: item ${id} must be approved before resolution`);
    const v = this.#ownerGuard.assertBeneficiary({ ownerClaim });
    if (!reference) throw new Error('RecoveryRecon: reference (settlement/external id) required');
    item.state = 'resolved';
    item.resolution = { reference, resolvedBy: v.ownerId, resolvedAt: new Date().toISOString() };
    await this.#persist();
    await this.#auditLog.append({ actor, action: 'RECOVERY_RESOLVE', resource: id, result: 'resolved', detail: { reference } });
    return item;
  }

  async resetItem({ id, actor = 'system' } = {}) {
    this.#ensureInit();
    const item = this.#items.get(id);
    if (!item) throw new Error(`RecoveryRecon: unknown item ${id}`);
    item.state = 'detected';
    item.approvedBy = null;
    item.approvedAt = null;
    item.resolution = null;
    await this.#persist();
    await this.#auditLog.append({ actor, action: 'RECOVERY_RESET', resource: id, result: 'reset' });
    return item;
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('RecoveryRecon not initialized. Call init() first.');
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const recoveryRecon = new RecoveryRecon();
export default recoveryRecon;
export { RecoveryRecon };
