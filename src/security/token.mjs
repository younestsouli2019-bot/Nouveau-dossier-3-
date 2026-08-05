import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import keychain from './keychain.mjs';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(input) {
  return Buffer.from(input, 'base64url');
}

function encode(obj) {
  return b64url(JSON.stringify(obj));
}

class TokenService {
  #dir = null;
  #usedPath = null;
  #epochPath = null;
  #used = new Set();
  #epoch = 0;
  #initialized = false;
  #keychain = null;

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'tokens');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#usedPath = path.join(this.#dir, 'used-jti.json');
    this.#epochPath = path.join(this.#dir, 'epoch.json');
    await this.#load();
    this.#keychain = opts.keychain || keychain;
    this.#initialized = true;
    return this;
  }

  async #load() {
    if (existsSync(this.#usedPath)) {
      try {
        const rec = JSON.parse(await fs.readFile(this.#usedPath, 'utf-8'));
        this.#used = new Set(rec.used || []);
      } catch {
        this.#used = new Set();
      }
    }
    if (existsSync(this.#epochPath)) {
      try {
        this.#epoch = JSON.parse(await fs.readFile(this.#epochPath, 'utf-8')).epoch || 0;
      } catch {
        this.#epoch = 0;
      }
    }
  }

  async #persist() {
    const used = [...this.#used].slice(-5000);
    await fs.writeFile(this.#usedPath, JSON.stringify({ used }, null, 2), 'utf-8');
    await fs.writeFile(this.#epochPath, JSON.stringify({ epoch: this.#epoch }, null, 2), 'utf-8');
  }

  async issue({ subject, audience = 'swarm', role = 'agent', ttlSeconds = 60, claims = {} } = {}) {
    this.#ensureInit();
    if (!subject) throw new Error('TokenService: subject required');
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomBytes(16).toString('hex');
    const header = { alg: 'EdDSA', typ: 'JWT' };
    const payload = {
      iss: 'swarm-security',
      sub: subject,
      aud: audience,
      jti,
      iat: now,
      nbf: now,
      exp: now + ttlSeconds,
      role,
      epoch: this.#epoch,
      claims,
    };
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const sig = await this.#keychain.sign(signingInput);
    return `${signingInput}.${sig.toString('base64url')}`;
  }

  async verify(token, { expectedAudience = null, allowReplay = false } = {}) {
    this.#ensureInit();
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('TokenService: malformed token');
    const [h, p, s] = parts;
    const signingInput = `${h}.${p}`;
    const valid = await this.#keychain.verify(signingInput, fromB64url(s));
    if (!valid) throw new Error('TokenService: invalid signature');
    const payload = JSON.parse(fromB64url(p).toString('utf-8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) throw new Error('TokenService: token expired');
    if (payload.nbf && now < payload.nbf) throw new Error('TokenService: token not yet valid');
    if (expectedAudience && payload.aud !== expectedAudience) {
      throw new Error(`TokenService: wrong audience ${payload.aud}`);
    }
    if (payload.epoch !== this.#epoch) throw new Error('TokenService: token generation revoked');
    if (!allowReplay) {
      if (this.#used.has(payload.jti)) throw new Error('TokenService: single-use token already consumed');
      this.#used.add(payload.jti);
      await this.#persist();
    }
    return payload;
  }

  async revokeForSubject(subject) {
    this.#ensureInit();
    this.#epoch += 1;
    await this.#persist();
    return { revoked: subject, epoch: this.#epoch };
  }

  async revokeAll() {
    this.#ensureInit();
    this.#epoch += 1;
    this.#used.clear();
    await this.#persist();
    return { revokedAll: true, epoch: this.#epoch };
  }

  async status() {
    this.#ensureInit();
    return { epoch: this.#epoch, usedJti: this.#used.size, provider: (await this.#keychain.status()).provider };
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('TokenService not initialized. Call init() first.');
  }
}

const tokenService = new TokenService();
export default tokenService;
export { TokenService };
