import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync } from 'fs';

function resolveBaseDir(opts = {}) {
  return path.resolve(opts.baseDir || process.env.SWARM_PROCUREMENT_DIR || path.join(process.cwd(), 'data', 'procurement'));
}

class SupplierRegistry {
  #dir = null;
  #path = null;
  #suppliers = null;
  #initialized = false;

  async init(opts = {}) {
    this.#dir = resolveBaseDir(opts);
    await fs.mkdir(this.#dir, { recursive: true });
    this.#path = path.join(this.#dir, 'suppliers.json');
    if (existsSync(this.#path)) {
      try {
        this.#suppliers = JSON.parse(await fs.readFile(this.#path, 'utf-8'));
      } catch {
        this.#suppliers = { version: 1, suppliers: [] };
      }
    } else {
      this.#suppliers = { version: 1, suppliers: [] };
      await this.#persist();
    }
    this.#initialized = true;
    return this;
  }

  async #persist() {
    const tmp = this.#path + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.#suppliers, null, 2), 'utf-8');
    await fs.rename(tmp, this.#path);
  }

  async register({ name, category, rail, payoutDestination, reputation = 0.5, avgCost = 0, avgSpeedHours = 72, spendCapUSD = 1000, country = null, notes = null } = {}) {
    await this.#ensureInit();
    if (!name || !rail || !payoutDestination) {
      throw new Error('SupplierRegistry: name, rail and payoutDestination are required');
    }
    const supplier = {
      supplierId: `SUP_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      name,
      category: category || 'general',
      rail,
      payoutDestination,
      reputation: Number(reputation),
      avgCost: Number(avgCost),
      avgSpeedHours: Number(avgSpeedHours),
      spendCapUSD: Number(spendCapUSD),
      country,
      status: 'pending',
      notes,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
    };
    this.#suppliers.suppliers.push(supplier);
    await this.#persist();
    return supplier;
  }

  async approve(supplierId, ownerRef = null) {
    await this.#ensureInit();
    const s = this.#find(supplierId);
    if (!s) throw new Error(`SupplierRegistry: unknown supplier ${supplierId}`);
    s.status = 'approved';
    s.approvedAt = new Date().toISOString();
    s.approvedBy = ownerRef || 'owner';
    await this.#persist();
    return s;
  }

  async suspend(supplierId, reason = null) {
    await this.#ensureInit();
    const s = this.#find(supplierId);
    if (!s) throw new Error(`SupplierRegistry: unknown supplier ${supplierId}`);
    s.status = 'suspended';
    s.suspendedAt = new Date().toISOString();
    s.suspendedReason = reason;
    await this.#persist();
    return s;
  }

  async resolve(supplierId) {
    await this.#ensureInit();
    return this.#find(supplierId);
  }

  async list({ status = null } = {}) {
    await this.#ensureInit();
    let list = this.#suppliers.suppliers;
    if (status) list = list.filter(s => s.status === status);
    return list;
  }

  #find(supplierId) {
    return this.#suppliers.suppliers.find(s => s.supplierId === supplierId);
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('SupplierRegistry not initialized. Call init() first.');
  }
}

const supplierRegistry = new SupplierRegistry();
export default supplierRegistry;
export { SupplierRegistry };
