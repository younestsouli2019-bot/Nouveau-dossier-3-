import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import didRegistry from './did-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LEDGER_DIR = path.join(ROOT, 'data', 'settlement', 'ledger');
const GENESIS_HASH = '0'.repeat(64);

class ImmutableLedger {
  constructor() {
    this.chain = [];
    this.tailHash = GENESIS_HASH;
  }

  async init() {
    mkdirSync(LEDGER_DIR, { recursive: true });
    const files = (await fs.readdir(LEDGER_DIR)).filter(f => f.endsWith('.json')).sort();
    for (const f of files) {
      const block = JSON.parse(await fs.readFile(path.join(LEDGER_DIR, f), 'utf-8'));
      this.chain.push(block);
    }
    if (this.chain.length > 0) {
      this.tailHash = this.chain[this.chain.length - 1].hash;
    }
    return this;
  }

  hashBlock(block) {
    return crypto.createHash('sha256')
      .update(JSON.stringify({ ...block, hash: undefined, signature: undefined }))
      .digest('hex');
  }

  async append(entry) {
    const index = this.chain.length;
    const prevHash = this.tailHash;
    const timestamp = entry.timestamp || new Date().toISOString();

    const block = {
      index,
      prevHash,
      timestamp,
      txId: entry.txId,
      kind: entry.kind,
      agent: entry.agent,
      did: entry.did,
      leg: entry.leg || 'single',
      account: entry.account,
      amount: entry.amount,
      currency: entry.currency,
      reference: entry.reference,
      payload: entry.payload || {},
    };

    if (entry.did) {
      const canonical = this.hashBlock(block);
      block.signature = await didRegistry.sign(entry.agent, canonical);
    }

    block.hash = this.hashBlock(block);
    this.chain.push(block);
    this.tailHash = block.hash;

    const file = path.join(LEDGER_DIR, `block-${String(index).padStart(8, '0')}.json`);
    await fs.writeFile(file, JSON.stringify(block, null, 2), 'utf-8');
    return block;
  }

  async record(txId, kind, entries, opts = {}) {
    const ledgerEntries = [];
    for (const e of entries) {
      ledgerEntries.push(await this.append({
        txId,
        kind,
        agent: opts.agent,
        did: opts.did,
        leg: e.leg,
        account: e.account,
        amount: e.amount,
        currency: e.currency,
        reference: e.reference,
        payload: e.payload || {},
      }));
    }
    return ledgerEntries;
  }

  async recordDualEntry(txId, kind, debit, credit, opts = {}) {
    if (Math.abs(debit.amount) !== Math.abs(credit.amount) || debit.currency !== credit.currency) {
      throw new Error(`DEBIT/CREDIT MISMATCH for ${txId}: ${debit.amount} ${debit.currency} vs ${credit.amount} ${credit.currency}`);
    }
    return this.record(txId, kind, [
      { ...debit, leg: 'debit' },
      { ...credit, leg: 'credit' },
    ], opts);
  }

  async verify() {
    const violations = [];
    let prev = GENESIS_HASH;
    for (const block of this.chain) {
      const recomputed = this.hashBlock(block);
      if (recomputed !== block.hash) {
        violations.push({ index: block.index, type: 'HASH_MISMATCH', txId: block.txId });
      }
      if (block.prevHash !== prev) {
        violations.push({ index: block.index, type: 'LINK_BROKEN', txId: block.txId });
      }
      if (block.did && block.signature) {
        const verified = await didRegistry.verify(block.did, recomputed, block.signature);
        if (!verified) {
          violations.push({ index: block.index, type: 'SIGNATURE_INVALID', txId: block.txId, did: block.did });
        }
      }
      prev = block.hash;
    }
    return { valid: violations.length === 0, blocks: this.chain.length, tailHash: this.tailHash, violations };
  }

  async entriesForTx(txId) {
    return this.chain.filter(b => b.txId === txId);
  }

  async summary() {
    return {
      blocks: this.chain.length,
      tailHash: this.tailHash,
      lastBlock: this.chain[this.chain.length - 1] || null,
    };
  }
}

const immutableLedger = new ImmutableLedger();
export default immutableLedger;
export { ImmutableLedger };
