import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ESCROW_PATH = path.join(ROOT, 'data', 'settlement', 'escrow.json');

const DEFAULT_SIGNERS = ['owner', 'compliance', 'oracle'];
const DEFAULT_QUORUM = 2;
const DEFAULT_LOCK_HOURS = 24;

class EscrowEngine {
  constructor() {
    this.escrows = null;
    this._persistQueue = Promise.resolve();
  }

  async init() {
    mkdirSync(path.dirname(ESCROW_PATH), { recursive: true });
    if (!existsSync(ESCROW_PATH)) {
      this.escrows = { version: 1, accounts: [] };
      await this._persist();
    } else {
      this.escrows = JSON.parse(await fs.readFile(ESCROW_PATH, 'utf-8'));
    }
    return this;
  }

  _persist() {
    const tmp = ESCROW_PATH + '.tmp';
    this._persistQueue = this._persistQueue
      .then(() => fs.writeFile(tmp, JSON.stringify(this.escrows, null, 2), 'utf-8'))
      .then(() => fs.rename(tmp, ESCROW_PATH));
    return this._persistQueue;
  }

  async createEscrow({ txId, amount, currency, destination, sourceAccount, purpose, agent, signers = null, quorum = null, lockHours = null }) {
    await this.init();
    const existing = this.escrows.accounts.find(a => a.txId === txId);
    if (existing) return existing;

    const hours = Number(lockHours != null ? lockHours : DEFAULT_LOCK_HOURS);
    const escrow = {
      escrowId: crypto.randomUUID(),
      txId,
      amount: Number(amount),
      currency,
      destination,
      sourceAccount: sourceAccount || 'OPERATING_RESERVE',
      holdingAccount: `ESCROW_${currency}_${purpose || 'GENERAL'}`.toUpperCase(),
      purpose: purpose || 'settlement',
      agent,
      createdAt: new Date().toISOString(),
      unlockAt: hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : new Date().toISOString(),
      signers: signers || JSON.parse(process.env.ESCROW_SIGNERS || JSON.stringify(DEFAULT_SIGNERS)),
      quorum: Number(quorum || process.env.ESCROW_QUORUM || DEFAULT_QUORUM),
      signatures: [],
      oracleConfirmations: [],
      verifiedBy: [],
      status: 'LOCKED',
      directPayout: false,
    };
    this.escrows.accounts.push(escrow);
    await this._persist();
    return escrow;
  }

  sign(escrowId, signer, signature) {
    const escrow = this.escrows.accounts.find(a => a.escrowId === escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    if (!escrow.signers.includes(signer)) throw new Error(`Signer ${signer} not authorized for escrow ${escrowId}`);
    if (!escrow.signatures.some(s => s.signer === signer)) {
      escrow.signatures.push({ signer, signature, at: new Date().toISOString() });
    }
    return this._persist().then(() => escrow);
  }

  confirmByOracle(escrowId, oracle, payload = {}) {
    const escrow = this.escrows.accounts.find(a => a.escrowId === escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    escrow.oracleConfirmations.push({ oracle, payload, at: new Date().toISOString() });
    return this._persist().then(() => escrow);
  }

  verify(escrowId, verifier, result) {
    const escrow = this.escrows.accounts.find(a => a.escrowId === escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    escrow.verifiedBy.push({ verifier, result, at: new Date().toISOString() });
    return this._persist().then(() => escrow);
  }

  isUnlocked(escrow) {
    return Date.now() >= new Date(escrow.unlockAt).getTime();
  }

  canRelease(escrow) {
    const sigCount = new Set(escrow.signatures.map(s => s.signer)).size;
    const oracleOk = escrow.oracleConfirmations.length >= 1;
    const verificationOk = escrow.verifiedBy.every(v => v.result === true) && escrow.verifiedBy.length >= 1;
    return {
      unlocked: this.isUnlocked(escrow),
      quorumMet: sigCount >= escrow.quorum,
      oracleConfirmed: oracleOk,
      verified: verificationOk,
      signatures: sigCount,
    };
  }

  async release(escrowId) {
    const escrow = this.escrows.accounts.find(a => a.escrowId === escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    const gate = this.canRelease(escrow);
    if (!(gate.unlocked && gate.quorumMet && gate.oracleConfirmed && gate.verified)) {
      throw new Error(`ESCROW RELEASE DENIED: ${JSON.stringify(gate)}`);
    }
    if (escrow.status !== 'RELEASED') {
      escrow.status = 'RELEASED';
      escrow.releasedAt = new Date().toISOString();
      escrow.directPayout = false;
    }
    await this._persist();
    return escrow;
  }

  async status() {
    const counts = { LOCKED: 0, RELEASED: 0, DENIED: 0 };
    for (const a of this.escrows.accounts) counts[a.status] = (counts[a.status] || 0) + 1;
    return { total: this.escrows.accounts.length, ...counts };
  }
}

const escrowEngine = new EscrowEngine();
export default escrowEngine;
export { EscrowEngine };
