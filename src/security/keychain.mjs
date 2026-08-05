import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

function providerFromEnv() {
  return (process.env.SWARM_KEY_PROVIDER || 'ephemeral').toLowerCase();
}

function nameToFile(name) {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return safe + '.json';
}

class Keychain {
  #baseDir = null;
  #keysDir = null;
  #masterKey = null;
  #provider = null;
  #signingKeys = null;
  #version = 1;
  #initialized = false;
  #adapters = new Map();
  #ephemeralWarning = null;

  async init(opts = {}) {
    this.#baseDir = opts.baseDir || resolveBaseDir();
    this.#keysDir = path.join(this.#baseDir, 'keys');
    await fs.mkdir(this.#keysDir, { recursive: true });
    this.#provider = opts.provider || providerFromEnv();
    await this.#loadOrCreateMasterKey();
    await this.#loadOrCreateSigningKey();
    this.#initialized = true;
    return this;
  }

  registerAdapter(name, adapter) {
    if (!adapter || typeof adapter.wrapKey !== 'function' || typeof adapter.unwrapKey !== 'function') {
      throw new Error(`Keychain: adapter "${name}" must implement wrapKey() and unwrapKey()`);
    }
    this.#adapters.set(name, adapter);
  }

  async #loadOrCreateMasterKey() {
    if (this.#provider === 'ephemeral') {
      this.#masterKey = crypto.randomBytes(32);
      return;
    }
    if (this.#provider === 'local') {
      const envKey = process.env.SWARM_MASTER_KEY;
      if (envKey && envKey.trim().length >= 32) {
        let raw = envKey.trim();
        if (raw.startsWith('base64:')) raw = Buffer.from(raw.slice(7), 'base64');
        else if (raw.startsWith('hex:')) raw = Buffer.from(raw.slice(4), 'hex');
        else raw = Buffer.from(raw, 'base64');
        if (raw.length >= 32) {
          this.#masterKey = raw.subarray(0, 32);
          this.#version = 1;
          return;
        }
      }
      this.#masterKey = crypto.randomBytes(32);
      this.#ephemeralWarning = 'SWARM_MASTER_KEY missing or too short — generated ephemeral master key';
      return;
    }
    const adapter = this.#adapters.get(this.#provider);
    if (!adapter) {
      throw new Error(
        `Keychain: provider "${this.#provider}" is not configured. ` +
        `registerAdapter("${this.#provider}", {wrapKey, unwrapKey}) or set SWARM_KEY_PROVIDER=local/ephemeral. ` +
        `Production: point the adapter at your HSM or cloud KMS.`
      );
    }
    const stored = await this.#readStoredMaster();
    if (stored) {
      this.#masterKey = await adapter.unwrapKey(stored.wrapped, stored.metadata);
      this.#version = stored.version || 1;
    } else {
      this.#masterKey = crypto.randomBytes(32);
      const { wrapped, metadata } = await adapter.wrapKey(this.#masterKey);
      await this.#writeStoredMaster(wrapped, metadata, 1);
    }
  }

  async #readStoredMaster() {
    const p = path.join(this.#keysDir, 'master-key.json');
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(await fs.readFile(p, 'utf-8'));
    } catch {
      return null;
    }
  }

  async #writeStoredMaster(wrapped, metadata, version) {
    const p = path.join(this.#keysDir, 'master-key.json');
    await fs.writeFile(p, JSON.stringify({ wrapped, metadata, version }, null, 2), 'utf-8');
  }

  async #loadOrCreateSigningKey() {
    const p = path.join(this.#keysDir, 'signing-key.json');
    if (existsSync(p)) {
      try {
        const rec = JSON.parse(await fs.readFile(p, 'utf-8'));
        const priv = this.#decrypt(rec.sealed, rec.version);
        this.#signingKeys = crypto.createPrivateKey({ key: priv, type: 'pkcs8', format: 'der' });
        this.#version = rec.version;
        return;
      } catch {
        this.#signingKeys = null;
      }
    }
    if (this.#signingKeys) return;
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    this.#signingKeys = privateKey;
    const der = privateKey.export({ type: 'pkcs8', format: 'der' });
    const sealed = this.#encrypt(der, this.#version);
    await fs.writeFile(p, JSON.stringify({ sealed, version: this.#version }, null, 2), 'utf-8');
  }

  #encrypt(data, version) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.#masterKey, iv);
    const ct = Buffer.concat([cipher.update(data), cipher.final()]);
    return { v: version, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }

  #decrypt(sealed, version) {
    const iv = Buffer.from(sealed.iv, 'base64');
    const ct = Buffer.from(sealed.ct, 'base64');
    const tag = Buffer.from(sealed.tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.#masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  hasMasterKey() {
    this.#ensureInit();
    return this.#masterKey != null;
  }

  async wrapSecret(name, value) {
    this.#ensureInit();
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf-8');
    const sealed = this.#encrypt(data, this.#version);
    const p = path.join(this.#keysDir, 'wrapped', nameToFile(name));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(sealed, null, 2), 'utf-8');
    return { name, wrapped: true, version: this.#version };
  }

  async unwrapSecret(name) {
    this.#ensureInit();
    const p = path.join(this.#keysDir, 'wrapped', nameToFile(name));
    if (!existsSync(p)) return null;
    const sealed = JSON.parse(await fs.readFile(p, 'utf-8'));
    return this.#decrypt(sealed, sealed.v).toString('utf-8');
  }

  encryptBuffer(data) {
    this.#ensureInit();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
    return this.#encrypt(buf, this.#version);
  }

  decryptBuffer(sealed) {
    this.#ensureInit();
    return this.#decrypt(sealed, sealed.v);
  }

  async listSecrets() {
    this.#ensureInit();
    const dir = path.join(this.#keysDir, 'wrapped');
    if (!existsSync(dir)) return [];
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  }

  async sign(data) {
    this.#ensureInit();
    return crypto.sign(null, Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8'), this.#signingKeys);
  }

  verify(data, signature, publicKey) {
    this.#ensureInit();
    const pub = publicKey || this.publicKey();
    return crypto.verify(null, Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8'), pub, signature);
  }

  publicKey() {
    this.#ensureInit();
    return crypto.createPublicKey(this.#signingKeys);
  }

  publicKeyDer() {
    return this.publicKey().export({ type: 'spki', format: 'der' });
  }

  publicKeyFingerprint() {
    return crypto.createHash('sha256').update(this.publicKeyDer()).digest('hex');
  }

  async rotateMasterKey() {
    this.#ensureInit();
    const oldKey = this.#masterKey;
    const oldVersion = this.#version;
    const newKey = crypto.randomBytes(32);
    const newVersion = oldVersion + 1;
    this.#masterKey = newKey;
    this.#version = newVersion;
    try {
      const wrappedDir = path.join(this.#keysDir, 'wrapped');
      const files = existsSync(wrappedDir) ? await fs.readdir(wrappedDir) : [];
      for (const f of files) {
        const p = path.join(wrappedDir, f);
        const rec = JSON.parse(await fs.readFile(p, 'utf-8'));
        const plain = this.#decryptWith(oldKey, rec);
        const reSealed = this.#encrypt(plain, newVersion);
        await fs.writeFile(p, JSON.stringify(reSealed, null, 2), 'utf-8');
      }
      const sp = path.join(this.#keysDir, 'signing-key.json');
      if (existsSync(sp)) {
        const rec = JSON.parse(await fs.readFile(sp, 'utf-8'));
        const plain = this.#decryptWith(oldKey, rec.sealed);
        const reSealed = this.#encrypt(plain, newVersion);
        await fs.writeFile(sp, JSON.stringify({ sealed: reSealed, version: newVersion }, null, 2), 'utf-8');
      }
      if (this.#provider !== 'ephemeral' && this.#provider !== 'local') {
        const adapter = this.#adapters.get(this.#provider);
        const { wrapped, metadata } = await adapter.wrapKey(newKey);
        await this.#writeStoredMaster(wrapped, metadata, newVersion);
      }
    } catch (err) {
      this.#masterKey = oldKey;
      this.#version = oldVersion;
      throw new Error(`Keychain: rotation failed and was rolled back: ${err.message}`);
    }
    return { version: newVersion, provider: this.#provider };
  }

  #decryptWith(key, sealed) {
    const iv = Buffer.from(sealed.iv, 'base64');
    const ct = Buffer.from(sealed.ct, 'base64');
    const tag = Buffer.from(sealed.tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  async status() {
    this.#ensureInit();
    return {
      provider: this.#provider,
      version: this.#version,
      hasMasterKey: this.#masterKey != null,
      signingKeyFingerprint: this.publicKeyFingerprint(),
      wrappedSecrets: (await this.listSecrets()).length,
      ephemeralWarning: this.#ephemeralWarning || null,
    };
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('Keychain not initialized. Call init() first.');
  }
}

const keychain = new Keychain();
export default keychain;
export { Keychain };
