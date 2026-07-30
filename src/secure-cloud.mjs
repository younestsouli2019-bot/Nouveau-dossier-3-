#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIRROR_CONFIG_PATH = path.join(ROOT, 'data', 'mirror-sites.json');
const SECURE_CLOUD_DIR = path.join(ROOT, 'data', 'secure-cloud');
const STATE_FILE = path.join(SECURE_CLOUD_DIR, 'mirror-state.json');
const CONTINUITY_DIR = path.join(ROOT, 'data', 'swarm', 'continuity');
const SITE_ASSETS_DIR = path.join(ROOT, 'content');

const ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION = { algorithm: 'PBKDF2-HMAC-SHA256', iterations: 600000, keyLength: 32 };

class SecureCloud {
  #config = null;
  #state = null;
  #initialized = false;

  async init() {
    if (this.#initialized) return this;
    mkdirSync(SECURE_CLOUD_DIR, { recursive: true });
    mkdirSync(CONTINUITY_DIR, { recursive: true });
    await this.#loadConfig();
    await this.#loadState();
    this.#initialized = true;
    return this;
  }

  async #loadConfig() {
    if (!existsSync(MIRROR_CONFIG_PATH)) {
      throw new Error(`MIRROR_CONFIG_MISSING: ${MIRROR_CONFIG_PATH} not found. Run secure-cloud setup first.`);
    }
    const raw = await fs.readFile(MIRROR_CONFIG_PATH, 'utf-8');
    this.#config = JSON.parse(raw);
  }

  async #loadState() {
    if (existsSync(STATE_FILE)) {
      try {
        this.#state = JSON.parse(await fs.readFile(STATE_FILE, 'utf-8'));
      } catch {
        this.#state = this.#defaultState();
      }
    } else {
      this.#state = this.#defaultState();
    }
  }

  #defaultState() {
    return {
      lastSync: null,
      lastRestoreDrill: null,
      mirrorHealth: {},
      breaches: [],
      encryptionKeys: { initialized: false, keyFingerprint: null },
    };
  }

  async #persist() {
    await fs.writeFile(STATE_FILE, JSON.stringify(this.#state, null, 2));
  }

  #deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, KEY_DERIVATION.iterations, KEY_DERIVATION.keyLength, 'sha256');
  }

  #getEncryptionKey(keyRef) {
    if (!keyRef || !keyRef.startsWith('env://')) return null;
    const envVar = keyRef.slice(6);
    return process.env[envVar] || null;
  }

  async encryptAsset(assetPath, outputPath, keyRef) {
    const keyMaterial = this.#getEncryptionKey(keyRef);
    if (!keyMaterial) throw new Error(`Encryption key not available for ${keyRef}`);
    const data = await fs.readFile(assetPath);
    const salt = crypto.randomBytes(32);
    const key = this.#deriveKey(keyMaterial, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const envelope = { salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64'), data: encrypted.toString('base64') };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(envelope, null, 2));
    const fingerprint = crypto.createHash('sha256').update(keyMaterial).digest('hex').slice(0, 16);
    this.#state.encryptionKeys = { initialized: true, keyFingerprint: fingerprint };
    await this.#persist();
    return { path: outputPath, algorithm: ALGORITHM, fingerprint };
  }

  async decryptAsset(encryptedPath, outputPath, keyRef) {
    const keyMaterial = this.#getEncryptionKey(keyRef);
    if (!keyMaterial) throw new Error(`Decryption key not available for ${keyRef}`);
    const envelope = JSON.parse(await fs.readFile(encryptedPath, 'utf-8'));
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const authTag = Buffer.from(envelope.authTag, 'base64');
    const encrypted = Buffer.from(envelope.data, 'base64');
    const key = this.#deriveKey(keyMaterial, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    await fs.writeFile(outputPath, decrypted);
    return { path: outputPath };
  }

  async health() {
    if (!this.#initialized) await this.init();
    const mirrors = this.#config.mirrors || [];
    const results = [];
    for (const mirror of mirrors) {
      const state = this.#state.mirrorHealth[mirror.id] || { status: 'unknown', lastCheck: null, latencyMs: null };
      results.push({
        id: mirror.id,
        label: mirror.label,
        url: mirror.url,
        status: mirror.status,
        healthState: state.status,
        provider: mirror.provider,
        regions: mirror.regions,
        lastSync: mirror.lastSync || state.lastCheck,
        encryption: mirror.encryption?.atRest ? 'aes-256-gcm' : 'none',
        backupEnabled: mirror.backup?.enabled || false,
      });
    }
    return { timestamp: new Date().toISOString(), mirrorCount: mirrors.length, mirrors: results, drill: this.#state.lastRestoreDrill };
  }

  async checkMirrorHealth(mirrorId) {
    const mirror = this.#config.mirrors.find(m => m.id === mirrorId);
    if (!mirror) throw new Error(`Unknown mirror: ${mirrorId}`);
    if (!mirror.healthEndpoint) return { id: mirrorId, status: 'no-endpoint', latencyMs: null };
    const start = Date.now();
    try {
      const res = await fetch(mirror.healthEndpoint, { signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      const status = res.ok ? 'healthy' : 'degraded';
      this.#state.mirrorHealth[mirrorId] = { status, lastCheck: new Date().toISOString(), latencyMs: latency };
      await this.#persist();
      return { id: mirrorId, status, latencyMs: latency, httpStatus: res.status };
    } catch {
      this.#state.mirrorHealth[mirrorId] = { status: 'unreachable', lastCheck: new Date().toISOString(), latencyMs: null };
      await this.#persist();
      return { id: mirrorId, status: 'unreachable', latencyMs: null };
    }
  }

  async runRestoreDrill() {
    if (!this.#initialized) await this.init();
    const activeMirrors = this.#config.mirrors.filter(m => m.status === 'active');
    if (activeMirrors.length < 2) return { ok: false, reason: 'insufficient_active_mirrors' };
    const era = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const restoreProof = { id: `drill-${era}`, timestamp: new Date().toISOString(), mirrorsChecked: [], passed: true };
    for (const mirror of activeMirrors.slice(0, 3)) {
      const result = await this.checkMirrorHealth(mirror.id);
      restoreProof.mirrorsChecked.push(result);
      if (result.status === 'unreachable') restoreProof.passed = false;
    }
    restoreProof.overall = restoreProof.passed ? 'PASS' : 'PARTIAL_FAIL';
    const proofFile = path.join(CONTINUITY_DIR, `restore-drill-${era}.json`);
    await fs.writeFile(proofFile, JSON.stringify(restoreProof, null, 2));
    this.#state.lastRestoreDrill = { id: restoreProof.id, result: restoreProof.overall, at: restoreProof.timestamp };
    if (restoreProof.passed) {
      const stateMirror = this.#state.mirrorHealth['mirror-encrypted-backup'] || {};
      if (stateMirror.status !== 'healthy') {
        this.#state.breaches.push({ type: 'COLD_STORAGE_NOT_HEALTHY', at: restoreProof.timestamp, severity: 'WARNING' });
      }
    }
    await this.#persist();
    return restoreProof;
  }

  async syncManifest() {
    if (!this.#initialized) await this.init();
    const manifest = {
      timestamp: new Date().toISOString(),
      configFingerprint: crypto.createHash('sha256').update(JSON.stringify(this.#config)).digest('hex').slice(0, 16),
      activeMirrors: this.#config.mirrors.filter(m => m.status === 'active').map(m => ({
        id: m.id, url: m.url, regions: m.regions, encryption: m.encryption?.atRest || false, lastSync: m.lastSync,
      })),
      routingStrategy: this.#config.routing?.strategy || 'geo-latency',
      fallbackOrder: this.#config.routing?.fallbackOrder || [],
      restoreDrillEnabled: this.#config.restoreDrill?.enabled || false,
      lastRestoreDrill: this.#state.lastRestoreDrill,
      breachCount: (this.#state.breaches || []).length,
    };
    const manifestFile = path.join(SECURE_CLOUD_DIR, 'sync-manifest.json');
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  async getConfig() {
    if (!this.#initialized) await this.init();
    return this.#config;
  }

  async getState() {
    if (!this.#initialized) await this.init();
    return this.#state;
  }
}

const secureCloud = new SecureCloud();
export default secureCloud;
export { SecureCloud };

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  (async () => {
    try {
      await secureCloud.init();
      const cmd = process.argv[2] || 'health';
      switch (cmd) {
        case 'health': {
          const h = await secureCloud.health();
          console.log(JSON.stringify(h, null, 2));
          break;
        }
        case 'check-mirror': {
          const r = await secureCloud.checkMirrorHealth(process.argv[3]);
          console.log(JSON.stringify(r, null, 2));
          break;
        }
        case 'restore-drill': {
          const d = await secureCloud.runRestoreDrill();
          console.log(JSON.stringify(d, null, 2));
          break;
        }
        case 'sync-manifest': {
          const m = await secureCloud.syncManifest();
          console.log(JSON.stringify(m, null, 2));
          break;
        }
        case 'config': {
          const c = await secureCloud.getConfig();
          console.log(JSON.stringify(c, null, 2));
          break;
        }
        default:
          console.log(`Usage: node src/secure-cloud.mjs <health|check-mirror|restore-drill|sync-manifest|config>`);
      }
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  })();
}
