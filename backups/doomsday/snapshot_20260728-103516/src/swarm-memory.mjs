import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_STORE_PATH = path.join(process.cwd(), '.swarm', 'memory-store.json');

class SwarmMemory {
  #store = new Map();
  #storePath;
  #version = 0;
  #dirty = false;
  #writeQueue = [];
  #writing = false;

  constructor(storePath = DEFAULT_STORE_PATH) {
    this.#storePath = storePath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.#storePath), { recursive: true });

    if (existsSync(this.#storePath)) {
      try {
        const raw = await fs.readFile(this.#storePath, 'utf-8');
        const persisted = JSON.parse(raw);
        this.#version = persisted._version || 0;
        for (const [key, entry] of Object.entries(persisted.entries || {})) {
          if (entry.ttl && Date.now() - entry.writtenAt > entry.ttl) {
            continue;
          }
          this.#store.set(key, entry);
        }
        this.#dirty = false;
      } catch {
        this.#store.clear();
        this.#version = 0;
      }
    }
    return this;
  }

  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (entry.ttl && Date.now() - entry.writtenAt > entry.ttl) {
      this.#store.delete(key);
      this.#dirty = true;
      return undefined;
    }
    return structuredClone(entry.value);
  }

  set(key, value, opts = {}) {
    const existing = this.#store.get(key);
    const entry = {
      value: structuredClone(value),
      writtenAt: Date.now(),
      version: (existing?.version || 0) + 1,
      ttl: opts.ttl || null,
      namespace: opts.namespace || null,
    };
    this.#store.set(key, entry);
    this.#dirty = true;
    return this.#enqueueWrite();
  }

  delete(key) {
    const existed = this.#store.has(key);
    this.#store.delete(key);
    if (existed) this.#dirty = true;
    return this.#enqueueWrite();
  }

  has(key) {
    const entry = this.#store.get(key);
    if (!entry) return false;
    if (entry.ttl && Date.now() - entry.writtenAt > entry.ttl) {
      this.#store.delete(key);
      return false;
    }
    return true;
  }

  keys(namespace) {
    const result = [];
    for (const [key, entry] of this.#store) {
      if (entry.ttl && Date.now() - entry.writtenAt > entry.ttl) {
        this.#store.delete(key);
        continue;
      }
      if (!namespace || entry.namespace === namespace) {
        result.push(key);
      }
    }
    return result;
  }

  entries(namespace) {
    const result = {};
    for (const [key, entry] of this.#store) {
      if (entry.ttl && Date.now() - entry.writtenAt > entry.ttl) {
        this.#store.delete(key);
        continue;
      }
      if (!namespace || entry.namespace === namespace) {
        result[key] = structuredClone(entry.value);
      }
    }
    return result;
  }

  snapshot() {
    const snap = {};
    for (const [key, entry] of this.#store) {
      if (entry.ttl && Date.now() - entry.writtenAt > entry.ttl) continue;
      snap[key] = {
        value: entry.value,
        writtenAt: entry.writtenAt,
        version: entry.version,
        namespace: entry.namespace,
      };
    }
    return {
      _version: this.#version,
      _createdAt: new Date().toISOString(),
      _entryCount: Object.keys(snap).length,
      entries: snap,
    };
  }

  checksum() {
    const snap = this.snapshot();
    return crypto.createHash('sha256')
      .update(JSON.stringify(snap.entries))
      .digest('hex');
  }

  async flush() {
    if (!this.#dirty) return;
    return this.#writeToDisk();
  }

  async #enqueueWrite() {
    return new Promise((resolve, reject) => {
      this.#writeQueue.push({ resolve, reject });
      this.#drainQueue();
    });
  }

  async #drainQueue() {
    if (this.#writing || this.#writeQueue.length === 0) return;
    this.#writing = true;
    while (this.#writeQueue.length > 0) {
      const job = this.#writeQueue.shift();
      try {
        await this.#writeToDisk();
        job.resolve();
      } catch (err) {
        job.reject(err);
      }
    }
    this.#writing = false;
  }

  async #writeToDisk() {
    const tmpPath = this.#storePath + '.tmp';
    const snapshot = this.snapshot();
    this.#version++;
    snapshot._version = this.#version;
    snapshot._lastWritten = new Date().toISOString();

    await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    await fs.rename(tmpPath, this.#storePath);
    this.#dirty = false;
  }
}

const swarmMemory = new SwarmMemory();
export default swarmMemory;
export { SwarmMemory };
