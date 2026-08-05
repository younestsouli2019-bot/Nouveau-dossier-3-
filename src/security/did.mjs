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

class DIDRegistry {
  #dir = null;
  #path = null;
  #agents = new Map();
  #initialized = false;
  #keychain = null;

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'did');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#path = path.join(this.#dir, 'registry.json');
    await this.#load();
    this.#keychain = opts.keychain || keychain;
    this.#initialized = true;
    return this;
  }

  async #load() {
    if (existsSync(this.#path)) {
      try {
        const rec = JSON.parse(await fs.readFile(this.#path, 'utf-8'));
        for (const a of rec.agents || []) {
          this.#agents.set(a.did, a);
        }
      } catch {
        this.#agents = new Map();
      }
    }
  }

  async #persist() {
    await fs.writeFile(this.#path, JSON.stringify({ agents: [...this.#agents.values()] }, null, 2), 'utf-8');
  }

  async createAgent({ name, role = 'agent', tenancy = 'default', fingerprint = null, attributes = {} } = {}) {
    this.#ensureInit();
    if (!name) throw new Error('DIDRegistry: name required');
    const seed = `${name}:${role}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
    const did = `did:swarm:${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 40)}`;
    const agent = {
      did,
      name,
      role,
      tenancy,
      fingerprint: fingerprint || null,
      status: 'active',
      createdAt: new Date().toISOString(),
      attributes,
    };
    this.#agents.set(did, agent);
    await this.#persist();
    return agent;
  }

  async revokeAgent(did) {
    this.#ensureInit();
    const agent = this.#agents.get(did);
    if (!agent) throw new Error(`DIDRegistry: unknown did ${did}`);
    agent.status = 'revoked';
    agent.revokedAt = new Date().toISOString();
    await this.#persist();
    return agent;
  }

  async resolve(did) {
    this.#ensureInit();
    return this.#agents.get(did) || null;
  }

  async assertActive(did) {
    this.#ensureInit();
    const agent = this.#agents.get(did);
    if (!agent) throw new Error(`DID BLOCKED: unknown did ${did}`);
    if (agent.status !== 'active') throw new Error(`DID BLOCKED: agent ${agent.name} is ${agent.status}`);
    return agent;
  }

  async listAgents() {
    this.#ensureInit();
    return [...this.#agents.values()].map(a => ({ did: a.did, name: a.name, role: a.role, tenancy: a.tenancy, status: a.status }));
  }

  async issueCredential({ subjectDid, type = 'SwarmAgentCredential', claims = {}, expirationHours = 24 } = {}) {
    this.#ensureInit();
    const agent = await this.assertActive(subjectDid);
    const now = new Date().toISOString();
    const header = { alg: 'EdDSA', typ: 'JWT' };
    const payload = {
      iss: 'did:swarm:issuer',
      sub: subjectDid,
      vc: { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential', type], credentialSubject: { id: subjectDid, name: agent.name, role: agent.role, tenancy: agent.tenancy, ...claims } },
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expirationHours * 3600,
      jti: crypto.randomBytes(12).toString('hex'),
    };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const sig = await this.#keychain.sign(signingInput);
    return `${signingInput}.${sig.toString('base64url')}`;
  }

  async verifyCredential(jwt) {
    this.#ensureInit();
    const parts = String(jwt).split('.');
    if (parts.length !== 3) throw new Error('DIDRegistry: malformed credential');
    const [h, p, s] = parts;
    const ok = await this.#keychain.verify(`${h}.${p}`, fromB64url(s));
    if (!ok) throw new Error('DIDRegistry: credential signature invalid');
    const payload = JSON.parse(fromB64url(p).toString('utf-8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) throw new Error('DIDRegistry: credential expired');
    const agent = await this.resolve(payload.sub);
    if (!agent) throw new Error(`DIDRegistry: subject ${payload.sub} not in registry`);
    if (agent.status !== 'active') throw new Error(`DIDRegistry: subject ${payload.sub} is ${agent.status}`);
    return { did: payload.sub, agent, vc: payload.vc, claims: payload.vc.credentialSubject };
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('DIDRegistry not initialized. Call init() first.');
  }
}

const didRegistry = new DIDRegistry();
export default didRegistry;
export { DIDRegistry };
