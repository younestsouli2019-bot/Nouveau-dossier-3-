import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

class AuditLog {
  #dir = null;
  #logPath = null;
  #manifestPath = null;
  #initialized = false;
  #state = { sealed: false, sealAt: null, sealActor: null, lastSeq: 0, lastHash: null };

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'audit');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#logPath = path.join(this.#dir, 'audit.log');
    this.#manifestPath = path.join(this.#dir, 'MANIFEST.json');
    await this.#loadState();
    this.#initialized = true;
    return this;
  }

  async #loadState() {
    if (existsSync(this.#manifestPath)) {
      try {
        this.#state = JSON.parse(await fs.readFile(this.#manifestPath, 'utf-8'));
      } catch {
        this.#state = { sealed: false, sealAt: null, sealActor: null, lastSeq: 0, lastHash: null };
      }
    }
    if (existsSync(this.#logPath)) {
      const content = await fs.readFile(this.#logPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]);
        this.#state.lastSeq = last.seq;
        this.#state.lastHash = last.hash;
      }
    }
  }

  async append(entry) {
    this.#ensureInit();
    if (this.#state.sealed) {
      throw new Error('AuditLog is SEALED (write-once-read-many). Unseal with owner token before appending.');
    }
    const now = new Date().toISOString();
    const seq = this.#state.lastSeq + 1;
    const rec = {
      seq,
      at: now,
      actor: entry.actor || 'unknown',
      action: entry.action || 'noop',
      resource: entry.resource || null,
      result: entry.result || null,
      detail: entry.detail || null,
      prevHash: this.#state.lastHash,
    };
    const recJson = JSON.stringify(rec);
    const hash = crypto.createHash('sha256').update(recJson).digest('hex');
    rec.hash = hash;
    const line = JSON.stringify(rec);
    await fs.appendFile(this.#logPath, line + '\n', 'utf-8');
    this.#state.lastSeq = seq;
    this.#state.lastHash = hash;
    await this.#saveState();
    return rec;
  }

  async seal({ actor = 'system' } = {}) {
    this.#ensureInit();
    if (this.#state.sealed) return this.#state;
    const lastSeq = this.#state.lastSeq;
    const lastHash = this.#state.lastHash;
    const sealAt = new Date().toISOString();
    const rec = {
      seq: lastSeq + 1,
      at: sealAt,
      actor,
      action: 'AUDIT_SEAL',
      resource: this.#logPath,
      result: { sealed: true },
      detail: null,
      prevHash: lastHash,
    };
    const recJson = JSON.stringify(rec);
    rec.hash = crypto.createHash('sha256').update(recJson).digest('hex');
    await fs.appendFile(this.#logPath, JSON.stringify(rec) + '\n', 'utf-8');
    this.#state = {
      sealed: true,
      sealAt,
      sealActor: actor,
      lastSeq: rec.seq,
      lastHash: rec.hash,
    };
    await this.#saveState();
    return this.#state;
  }

  async unseal({ actor, ownerToken } = {}) {
    this.#ensureInit();
    if (!this.#state.sealed) return this.#state;
    if (!ownerToken || ownerToken !== (process.env.AUDIT_UNSEAL_TOKEN || null)) {
      throw new Error('AuditLog: SEALED. unseal() requires matching AUDIT_UNSEAL_TOKEN.');
    }
    this.#state = { sealed: false, sealAt: null, sealActor: null, lastSeq: this.#state.lastSeq, lastHash: this.#state.lastHash };
    await this.#saveState();
    await this.append({ actor: actor || 'unknown', action: 'AUDIT_UNSEAL', resource: this.#logPath, result: { unsealed: true } });
    return this.#state;
  }

  async entries() {
    this.#ensureInit();
    if (!existsSync(this.#logPath)) return [];
    const content = await fs.readFile(this.#logPath, 'utf-8');
    return content.split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  async verify() {
    this.#ensureInit();
    const entries = await this.entries();
    let prevHash = null;
    let broken = null;
    for (const rec of entries) {
      const { hash, ...body } = rec;
      const rehash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
      if (rehash !== rec.hash) {
        broken = { seq: rec.seq, reason: 'hash_mismatch' };
        break;
      }
      if (rec.prevHash !== prevHash) {
        broken = { seq: rec.seq, reason: 'chain_break', expectedPrev: prevHash, actualPrev: rec.prevHash };
        break;
      }
      prevHash = rec.hash;
    }
    const manifestMatch = this.#state.lastHash === prevHash;
    return {
      verified: broken === null && manifestMatch,
      count: entries.length,
      broken,
      manifestMatch,
      sealed: this.#state.sealed,
    };
  }

  async status() {
    this.#ensureInit();
    const v = await this.verify();
    return {
      sealed: this.#state.sealed,
      sealAt: this.#state.sealAt,
      sealActor: this.#state.sealActor,
      lastSeq: this.#state.lastSeq,
      lastHash: this.#state.lastHash,
      verified: v.verified,
      count: v.count,
    };
  }

  async #saveState() {
    const tmp = this.#manifestPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.#state, null, 2), 'utf-8');
    await fs.rename(tmp, this.#manifestPath);
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('AuditLog not initialized. Call init() first.');
  }
}

const auditLog = new AuditLog();
export default auditLog;
export { AuditLog };
