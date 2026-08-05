import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { X509Certificate } from 'crypto';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

function fingerprintOfDer(der) {
  return crypto.createHash('sha256').update(der).digest('hex');
}

class MutualTLS {
  #dir = null;
  #peersPath = null;
  #peers = new Map();
  #initialized = false;
  #devMode = false;

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'mtls');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#peersPath = path.join(this.#dir, 'peers.json');
    this.#devMode = opts.devMode != null ? opts.devMode : (process.env.SWARM_MTLS_DEV === '1');
    await this.#load();
    this.#initialized = true;
    return this;
  }

  async #load() {
    if (existsSync(this.#peersPath)) {
      try {
        const rec = JSON.parse(await fs.readFile(this.#peersPath, 'utf-8'));
        for (const p of rec.peers || []) {
          this.#peers.set(p.did, p);
        }
      } catch {
        this.#peers = new Map();
      }
    }
  }

  async #persist() {
    const peers = [...this.#peers.values()];
    await fs.writeFile(this.#peersPath, JSON.stringify({ peers }, null, 2), 'utf-8');
  }

  fingerprintOfPem(pem) {
    return fingerprintOfDer(new X509Certificate(pem).raw);
  }

  async registerPeer({ name, did, certPem = null, allowed = true }) {
    this.#ensureInit();
    if (!did) throw new Error('MutualTLS: did required');
    let fingerprint = null;
    let devCredential = null;
    if (certPem) {
      fingerprint = this.fingerprintOfPem(certPem);
    } else if (this.#devMode) {
      devCredential = this.generateDevCredential(name || did);
      fingerprint = devCredential.fingerprint;
    } else {
      throw new Error('MutualTLS: certPem required when SWARM_MTLS_DEV is off. Provision a real CA-signed client certificate.');
    }
    const peer = {
      name: name || did,
      did,
      fingerprint,
      certPem: certPem || null,
      allowed,
      devCredential: devCredential ? { fingerprint: devCredential.fingerprint } : null,
      registeredAt: new Date().toISOString(),
    };
    this.#peers.set(did, peer);
    await this.#persist();
    return { did, fingerprint, devCredential };
  }

  generateDevCredential(subject) {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    return { fingerprint: fingerprintOfDer(spki), subject };
  }

  async verifyPeer({ did = null, certPem = null, fingerprint = null } = {}) {
    this.#ensureInit();
    if (certPem) fingerprint = fingerprint || this.fingerprintOfPem(certPem);
    if (!fingerprint && did) {
      const p = this.#peers.get(did);
      if (p) fingerprint = p.fingerprint;
    }
    if (!fingerprint) return { verified: false, reason: 'no client certificate presented' };
    for (const peer of this.#peers.values()) {
      if (peer.allowed && peer.fingerprint === fingerprint) {
        return { verified: true, peer, fingerprint };
      }
    }
    return { verified: false, reason: 'client certificate not in trusted peers allowlist' };
  }

  async assertPeer(opts) {
    const r = await this.verifyPeer(opts);
    if (!r.verified) throw new Error(`mTLS HANDSHAKE BLOCKED: ${r.reason}`);
    return r;
  }

  verifyNodeRequest(req) {
    let cert = null;
    try {
      cert = req.socket && typeof req.socket.getPeerCertificate === 'function' ? req.socket.getPeerCertificate() : null;
    } catch {
      cert = null;
    }
    if (cert && cert.raw && cert.raw.length > 0) {
      const fp = fingerprintOfDer(cert.raw);
      const r = this.verifyPeer({ fingerprint: fp });
      if (r.verified) return r;
      return { verified: false, reason: `client certificate rejected: ${r.reason}`, fingerprint: fp };
    }
    if (this.#devMode && req.headers['x-mtls-fingerprint']) {
      const r = this.verifyPeer({ fingerprint: req.headers['x-mtls-fingerprint'] });
      if (r.verified) return r;
      return { verified: false, reason: `dev fingerprint rejected: ${r.reason}` };
    }
    return { verified: false, reason: 'mTLS required: no client certificate on TLS session' };
  }

  verifyProxyClientCert(headers = {}) {
    const verifyHeader = headers['x-ssl-client-verify'] || headers['x-client-cert-verified'];
    const certHeader = headers['x-ssl-client-cert'] || headers['x-client-cert'];
    const fpHeader = headers['x-mtls-fingerprint'];
    if (verifyHeader && verifyHeader.toLowerCase() !== 'success' && verifyHeader.toLowerCase() !== 'true') {
      return { verified: false, reason: `reverse proxy rejected client cert (${verifyHeader})` };
    }
    if (certHeader) {
      const b64 = certHeader.replace(/^-----BEGIN CERTIFICATE-----\s*/i, '').replace(/\s*-----END CERTIFICATE-----$/i, '').replace(/\\n/g, '\n').replace(/\s+/g, '\n').trim();
      const pem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`;
      try {
        return this.verifyPeer({ certPem: pem });
      } catch {
        return { verified: false, reason: 'client certificate header unparseable' };
      }
    }
    if (this.#devMode && fpHeader) {
      return this.verifyPeer({ fingerprint: fpHeader });
    }
    return { verified: false, reason: 'mTLS required: reverse proxy provided no client certificate' };
  }

  async peers() {
    this.#ensureInit();
    return [...this.#peers.values()].map(p => ({ name: p.name, did: p.did, fingerprint: p.fingerprint, allowed: p.allowed, hasCert: !!p.certPem }));
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('MutualTLS not initialized. Call init() first.');
  }
}

const mutualTLS = new MutualTLS();
export default mutualTLS;
export { MutualTLS };
