import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DID_DIR = path.join(ROOT, '.keys', 'dids');
const REGISTRY_PATH = path.join(ROOT, 'data', 'settlement', 'dids.json');

class DIDRegistry {
  constructor() {
    this.registry = null;
  }

  async init() {
    mkdirSync(DID_DIR, { recursive: true });
    mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    if (!existsSync(REGISTRY_PATH)) {
      this.registry = { version: 1, agents: {} };
      await this._persist();
    } else {
      this.registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf-8'));
    }
    return this;
  }

  async _persist() {
    const tmp = REGISTRY_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.registry, null, 2), 'utf-8');
    await fs.rename(tmp, REGISTRY_PATH);
  }

  async register(agentId, opts = {}) {
    await this.init();
    if (this.registry.agents[agentId]) return this.registry.agents[agentId];

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const did = `did:rwc:${opts.kind || 'agent'}:${Buffer.from(agentId).toString('base64url')}:${crypto.randomBytes(6).toString('hex')}`;

    const keyPath = path.join(DID_DIR, `${agentId}.pem`);
    await fs.writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    await fs.writeFile(keyPath + '.pub', publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });

    this.registry.agents[agentId] = {
      did,
      agentId,
      kind: opts.kind || 'agent',
      role: opts.role || 'revenue-agent',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      registeredAt: new Date().toISOString(),
      meta: opts.meta || {},
    };
    await this._persist();
    return this.registry.agents[agentId];
  }

  async resolve(did) {
    await this.init();
    const entry = Object.values(this.registry.agents).find(a => a.did === did);
    if (!entry) throw new Error(`DID not found: ${did}`);
    return entry;
  }

  async list() {
    await this.init();
    return Object.values(this.registry.agents);
  }

  async sign(agentId, message) {
    await this.init();
    const entry = this.registry.agents[agentId];
    if (!entry) throw new Error(`Unknown agent: ${agentId}`);
    const keyPath = path.join(DID_DIR, `${agentId}.pem`);
    const pem = await fs.readFile(keyPath, 'utf-8');
    const key = crypto.createPrivateKey(pem);
    return crypto.sign(null, Buffer.from(message, 'utf-8'), key).toString('base64');
  }

  async verify(did, message, signature) {
    const entry = await this.resolve(did);
    const key = crypto.createPublicKey(entry.publicKey);
    return crypto.verify(null, Buffer.from(message, 'utf-8'), key, Buffer.from(signature, 'base64'));
  }
}

const didRegistry = new DIDRegistry();
export default didRegistry;
export { DIDRegistry };
