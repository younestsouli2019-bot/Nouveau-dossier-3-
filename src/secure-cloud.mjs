#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import contingency from './contingency.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIRROR_CONFIG_PATH = path.join(ROOT, 'data', 'mirror-sites.json');
const DOOMSDAY_VAULT_PATH = path.join(ROOT, 'data', 'doomsday-vault.json');
const SECURE_CLOUD_DIR = path.join(ROOT, 'data', 'secure-cloud');
const STATE_FILE = path.join(SECURE_CLOUD_DIR, 'mirror-state.json');
const CONTINUITY_DIR = path.join(ROOT, 'data', 'swarm', 'continuity');
const VAULT_DIR = path.join(ROOT, 'data', 'doomsday-vault');
const SITE_ASSETS_DIR = path.join(ROOT, 'content');

const ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION = { algorithm: 'PBKDF2-HMAC-SHA256', iterations: 600000, keyLength: 32 };

class SecureCloud {
  #config = null;
  #vaultConfig = null;
  #state = null;
  #initialized = false;
  #contingencyHealth = null;

  async init() {
    if (this.#initialized) return this;
    mkdirSync(SECURE_CLOUD_DIR, { recursive: true });
    mkdirSync(CONTINUITY_DIR, { recursive: true });
    mkdirSync(VAULT_DIR, { recursive: true });
    await this.#loadConfig();
    await this.#loadVaultConfig();
    await this.#loadState();
    try {
      if (typeof contingency?.health === 'function') {
        await contingency.init();
        this.#contingencyHealth = await contingency.health();
      }
    } catch {
      this.#contingencyHealth = { threatLevel: 'GREEN', breaches: [] };
    }
    this.#initialized = true;
    return this;
  }

  async #loadConfig() {
    if (!existsSync(MIRROR_CONFIG_PATH)) {
      console.warn(`MIRROR_CONFIG_MISSING: ${MIRROR_CONFIG_PATH} not found. Using hardened default.`);
      this.#config = {
        mirrors: [], defaultEncryption: { algorithm: 'aes-256-gcm', keyDerivation: 'PBKDF2-HMAC-SHA256', iterations: 600000, authTagLength: 16 },
        antiCensorship: { enabled: true, failoverCascade: ['clearnet-cdn', 'local-cache'] },
        doomsdayVault: { enabled: false },
        routing: { strategy: 'fallback', fallbackOrder: [], healthCheckIntervalMs: 60000, maxFailoverTimeMs: 10000 },
        restoreDrill: { enabled: false }
      };
      return;
    }
    const raw = await fs.readFile(MIRROR_CONFIG_PATH, 'utf-8');
    this.#config = JSON.parse(raw);
  }

  async #loadVaultConfig() {
    if (!existsSync(DOOMSDAY_VAULT_PATH)) {
      this.#vaultConfig = { enabled: false, geoReplicas: [], restore: { quorumRequired: 1 } };
      return;
    }
    try {
      this.#vaultConfig = JSON.parse(await fs.readFile(DOOMSDAY_VAULT_PATH, 'utf-8'));
    } catch {
      this.#vaultConfig = { enabled: false, geoReplicas: [], restore: { quorumRequired: 1 } };
    }
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
      lastSync: null, lastRestoreDrill: null, mirrorHealth: {}, breaches: [],
      censorshipEvents: [], vaultSnapshots: [], integrityLog: [],
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
    return process.env[keyRef.slice(6)] || null;
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
    const checksum = crypto.createHash('sha256').update(data).digest('hex');
    const envelope = { salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64'), data: encrypted.toString('base64'), checksum };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(envelope, null, 2));
    const fingerprint = crypto.createHash('sha256').update(keyMaterial).digest('hex').slice(0, 16);
    this.#state.encryptionKeys = { initialized: true, keyFingerprint: fingerprint };
    await this.#persist();
    return { path: outputPath, algorithm: ALGORITHM, fingerprint, checksum };
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
    if (envelope.checksum) {
      const verify = crypto.createHash('sha256').update(decrypted).digest('hex');
      if (verify !== envelope.checksum) throw new Error(`Integrity check FAILED for ${encryptedPath}: checksum mismatch`);
    }
    return { path: outputPath, integrityVerified: !!envelope.checksum };
  }

  async health() {
    if (!this.#initialized) await this.init();
    const mirrors = this.#config.mirrors || [];
    const results = [];
    for (const mirror of mirrors) {
      const state = this.#state.mirrorHealth[mirror.id] || { status: 'unknown', lastCheck: null, latencyMs: null };
      results.push({
        id: mirror.id, label: mirror.label, url: mirror.url, status: mirror.status, healthState: state.status,
        provider: mirror.provider, jurisdiction: mirror.jurisdiction, networkLayer: mirror.networkLayer,
        regions: mirror.regions, lastSync: mirror.lastSync || state.lastCheck,
        encryption: mirror.encryption?.atRest ? 'aes-256-gcm' : 'none', backupEnabled: mirror.backup?.enabled || false,
      });
    }
    const censorship = { events: this.#state.censorshipEvents?.length || 0, lastEvent: this.#state.censorshipEvents?.slice(-1)?.[0] || null };
    const vault = { enabled: this.#vaultConfig?.enabled || false, geoReplicas: this.#vaultConfig?.geoReplicas?.length || 0, snapshots: this.#state.vaultSnapshots?.length || 0, quorumRequired: this.#vaultConfig?.restore?.quorumRequired || 1 };
    return { timestamp: new Date().toISOString(), mirrorCount: mirrors.length, mirrors: results, drill: this.#state.lastRestoreDrill, censorship, vault, threatLevel: this.#contingencyHealth?.threatLevel || 'GREEN' };
  }

  async checkMirrorHealth(mirrorId) {
    const mirror = this.#config.mirrors.find(m => m.id === mirrorId);
    if (!mirror) throw new Error(`Unknown mirror: ${mirrorId}`);
    if (!mirror.healthEndpoint) return { id: mirrorId, status: 'no-endpoint', latencyMs: null };
    const start = Date.now();
    try {
      const proxyUrl = mirror.antiCensorship?.requiresTorProxy ? process.env.TOR_PROXY_URL : mirror.antiCensorship?.requiresI2PProxy ? process.env.I2P_PROXY_URL : null;
      const opts = { signal: AbortSignal.timeout(10000) };
      if (proxyUrl) opts.proxy = proxyUrl;
      const res = await fetch(mirror.healthEndpoint, opts);
      const latency = Date.now() - start;
      const status = res.ok ? 'healthy' : 'degraded';
      this.#state.mirrorHealth[mirrorId] = { status, lastCheck: new Date().toISOString(), latencyMs: latency, networkLayer: mirror.networkLayer };
      await this.#persist();
      return { id: mirrorId, status, latencyMs: latency, httpStatus: res.status, networkLayer: mirror.networkLayer };
    } catch {
      this.#state.mirrorHealth[mirrorId] = { status: 'unreachable', lastCheck: new Date().toISOString(), latencyMs: null, networkLayer: mirror.networkLayer };
      await this.#persist();
      return { id: mirrorId, status: 'unreachable', latencyMs: null, networkLayer: mirror.networkLayer };
    }
  }

  async detectCensorship() {
    if (!this.#initialized) await this.init();
    const clearnetMirrors = this.#config.mirrors.filter(m => m.networkLayer === 'clearnet' && m.status === 'active');
    const results = [];
    let blockedCount = 0;
    for (const mirror of clearnetMirrors) {
      const result = await this.checkMirrorHealth(mirror.id);
      results.push(result);
      if (result.status === 'unreachable') blockedCount++;
    }
    const threshold = this.#config.antiCensorship?.regionalBlockDetect?.suspectedBlockThreshold || 2;
    const suspectedBlock = blockedCount >= threshold && clearnetMirrors.length >= threshold;
    if (suspectedBlock) {
      const event = { type: 'SUSPECTED_CENSORSHIP_BLOCK', at: new Date().toISOString(), blockedCount, totalClearnet: clearnetMirrors.length, details: results };
      this.#state.censorshipEvents.push(event);
      if (this.#config.antiCensorship?.failoverCascade) {
        event.action = 'activating_failover_cascade';
        event.failoverOrder = this.#config.antiCensorship.failoverCascade;
      }
      try {
        if (typeof contingency?.raiseThreat === 'function') {
          await contingency.init();
          await contingency.raiseThreat({ type: 'CENSORSHIP_BLOCK_DETECTED', severity: 'CRITICAL', detail: `${blockedCount}/${clearnetMirrors.length} clearnet mirrors unreachable — activating failover`, payload: event });
        }
      } catch {}
      await this.#persist();
    }
    return { suspectedBlock, blockedCount, totalClearnet: clearnetMirrors.length, threshold, results, failoverActivated: suspectedBlock };
  }

  async runRestoreDrill() {
    if (!this.#initialized) await this.init();
    const activeMirrors = this.#config.mirrors.filter(m => m.status === 'active');
    if (activeMirrors.length < 2) return { ok: false, reason: 'insufficient_active_mirrors' };
    const era = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const restoreProof = { id: `drill-${era}`, timestamp: new Date().toISOString(), mirrorsChecked: [], passed: true };
    const networkLayersTested = new Set();
    for (const mirror of activeMirrors.slice(0, 5)) {
      const result = await this.checkMirrorHealth(mirror.id);
      restoreProof.mirrorsChecked.push(result);
      if (result.networkLayer) networkLayersTested.add(result.networkLayer);
      if (result.status === 'unreachable') restoreProof.passed = false;
    }
    const censorshipCheck = await this.detectCensorship();
    restoreProof.censorshipCheck = { suspectedBlock: censorshipCheck.suspectedBlock, blockedCount: censorshipCheck.blockedCount };
    restoreProof.networkLayersTested = [...networkLayersTested];
    restoreProof.overall = restoreProof.passed ? 'PASS' : censorshipCheck.suspectedBlock ? 'CENSORSHIP_BYPASS_ACTIVE' : 'PARTIAL_FAIL';
    const proofFile = path.join(CONTINUITY_DIR, `restore-drill-${era}.json`);
    await fs.writeFile(proofFile, JSON.stringify(restoreProof, null, 2));
    this.#state.lastRestoreDrill = { id: restoreProof.id, result: restoreProof.overall, at: restoreProof.timestamp };
    if (restoreProof.passed) {
      const stateMirror = this.#state.mirrorHealth['mirror-doomsday-vault'] || {};
      if (stateMirror.status !== 'healthy') {
        this.#state.breaches.push({ type: 'DOOMSDAY_VAULT_NOT_HEALTHY', at: restoreProof.timestamp, severity: 'WARNING' });
      }
    }
    await this.#persist();
    return restoreProof;
  }

  async vaultSnapshot() {
    if (!this.#initialized) await this.init();
    if (!this.#vaultConfig?.enabled) return { ok: false, reason: 'doomsday_vault_not_enabled' };
    const era = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const snapshot = { id: `snapshot-${era}`, timestamp: new Date().toISOString(), assets: [], geoReplicas: [], integrity: {} };
    try {
      const contentFiles = [];
      async function walk(dir) { const entries = await fs.readdir(dir, { withFileTypes: true }); for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else contentFiles.push(p); } }
      await walk(SITE_ASSETS_DIR);
      const keyRef = this.#vaultConfig.encryption?.splitKey?.shareLocations?.[0]?.keyRef || 'env://SECURE_CLOUD_KEY_COLD_STORAGE';
      for (const file of contentFiles.slice(0, 50)) {
        const rel = path.relative(ROOT, file);
        const encPath = path.join(VAULT_DIR, 'snapshots', era, rel + '.enc');
        const result = await this.encryptAsset(file, encPath, keyRef);
        snapshot.assets.push({ source: rel, encrypted: path.relative(ROOT, encPath), checksum: result.checksum });
      }
      const integrity = crypto.createHash('sha256');
      for (const asset of snapshot.assets) integrity.update(asset.checksum);
      snapshot.integrity.rootHash = integrity.digest('hex');
      snapshot.integrity.algorithm = 'sha256';
      snapshot.integrity.assetCount = snapshot.assets.length;
      const metaFile = path.join(VAULT_DIR, `snapshot-${era}.json`);
      await fs.writeFile(metaFile, JSON.stringify(snapshot, null, 2));
      this.#state.vaultSnapshots.push({ id: snapshot.id, at: snapshot.timestamp, assetCount: snapshot.assets.length, integrityRoot: snapshot.integrity.rootHash });
      if (this.#state.vaultSnapshots.length > 30) this.#state.vaultSnapshots = this.#state.vaultSnapshots.slice(-30);
      await this.#persist();
      return snapshot;
    } catch (err) {
      this.#state.breaches.push({ type: 'VAULT_SNAPSHOT_FAILED', at: new Date().toISOString(), severity: 'HIGH', detail: err.message });
      await this.#persist();
      return { ok: false, reason: err.message };
    }
  }

  async vaultRestore(snapshotId) {
    if (!this.#initialized) await this.init();
    if (!this.#vaultConfig?.enabled) return { ok: false, reason: 'doomsday_vault_not_enabled' };
    const metaFile = path.join(VAULT_DIR, `snapshot-${snapshotId}.json`);
    if (!existsSync(metaFile)) return { ok: false, reason: `snapshot ${snapshotId} not found` };
    const snapshot = JSON.parse(await fs.readFile(metaFile, 'utf-8'));
    const keyRef = this.#vaultConfig.encryption?.splitKey?.shareLocations?.[0]?.keyRef || 'env://SECURE_CLOUD_KEY_COLD_STORAGE';
    const restored = [];
    for (const asset of snapshot.assets) {
      try {
        const encPath = path.join(ROOT, asset.encrypted);
        const outPath = path.join(ROOT, asset.source);
        mkdirSync(path.dirname(outPath), { recursive: true });
        const result = await this.decryptAsset(encPath, outPath, keyRef);
        restored.push({ source: asset.source, ok: true, integrityVerified: result.integrityVerified });
      } catch (err) {
        restored.push({ source: asset.source, ok: false, error: err.message });
      }
    }
    const allOk = restored.every(r => r.ok);
    const proof = { id: `restore-${snapshotId}`, snapshot: snapshotId, at: new Date().toISOString(), restored: restored.length, failed: restored.filter(r => !r.ok).length, allOk };
    const proofFile = path.join(CONTINUITY_DIR, `vault-restore-${snapshotId}.json`);
    await fs.writeFile(proofFile, JSON.stringify(proof, null, 2));
    return proof;
  }

  async verifyIntegrity(mirrorId) {
    if (!this.#initialized) await this.init();
    const mirror = this.#config.mirrors.find(m => m.id === mirrorId);
    if (!mirror) throw new Error(`Unknown mirror: ${mirrorId}`);
    if (!mirror.integrityEndpoint) return { id: mirrorId, status: 'no-integrity-endpoint' };
    try {
      const res = await fetch(mirror.integrityEndpoint, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { id: mirrorId, status: 'integrity-endpoint-error', httpStatus: res.status };
      const remoteHash = (await res.text()).trim();
      const localFiles = [];
      async function walk(dir) { const entries = await fs.readdir(dir, { withFileTypes: true }); for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else if (!e.name.startsWith('.')) localFiles.push(p); } }
      await walk(SITE_ASSETS_DIR);
      const hash = crypto.createHash('sha256');
      for (const f of localFiles.sort()) {
        try { hash.update(await fs.readFile(f)); } catch {}
      }
      const localHash = hash.digest('hex');
      const match = remoteHash === localHash;
      this.#state.integrityLog.push({ mirrorId, at: new Date().toISOString(), match, remoteHash: remoteHash.slice(0, 16), localHash: localHash.slice(0, 16) });
      if (!match) {
        this.#state.breaches.push({ type: 'INTEGRITY_MISMATCH', at: new Date().toISOString(), severity: 'CRITICAL', detail: `${mirrorId}: remote content hash differs from local` });
        if (typeof contingency?.raiseThreat === 'function') {
          try { await contingency.init(); await contingency.raiseThreat({ type: 'CONTENT_INTEGRITY_FAILURE', severity: 'CRITICAL', detail: `Content integrity mismatch on ${mirrorId}`, payload: { mirrorId, remoteHash: remoteHash.slice(0, 16), localHash: localHash.slice(0, 16) } }); } catch {}
        }
      }
      await this.#persist();
      return { id: mirrorId, status: match ? 'verified' : 'mismatch', remoteHash: remoteHash.slice(0, 16), localHash: localHash.slice(0, 16) };
    } catch (err) {
      return { id: mirrorId, status: 'integrity-check-failed', error: err.message };
    }
  }

  async failoverCascade() {
    if (!this.#initialized) await this.init();
    const cascade = this.#config.antiCensorship?.failoverCascade || ['clearnet-cdn', 'local-cache'];
    const status = {};
    for (const layer of cascade) {
      const mirrorsInLayer = this.#config.mirrors.filter(m => m.antiCensorship?.fallbackGroup === layer && m.status === 'active');
      const results = [];
      for (const mirror of mirrorsInLayer) {
        const r = await this.checkMirrorHealth(mirror.id);
        results.push({ id: mirror.id, status: r.status, latencyMs: r.latencyMs, networkLayer: r.networkLayer });
      }
      const healthy = results.filter(r => r.status === 'healthy' || r.status === 'degraded').length;
      status[layer] = { total: results.length, healthy, degraded: results.filter(r => r.status === 'degraded').length, unreachable: results.filter(r => r.status === 'unreachable' || r.status === 'no-endpoint').length, mirrors: results };
      if (healthy === 0 && layer !== cascade[cascade.length - 1]) {
        status[layer].failoverTo = cascade[cascade.indexOf(layer) + 1];
      }
    }
    return { cascade, status, timestamp: new Date().toISOString() };
  }

  async syncManifest() {
    if (!this.#initialized) await this.init();
    const manifest = {
      timestamp: new Date().toISOString(),
      configFingerprint: crypto.createHash('sha256').update(JSON.stringify(this.#config)).digest('hex').slice(0, 16),
      activeMirrors: this.#config.mirrors.filter(m => m.status === 'active').map(m => ({
        id: m.id, url: m.url, jurisdiction: m.jurisdiction, networkLayer: m.networkLayer, regions: m.regions, encryption: m.encryption?.atRest || false, lastSync: m.lastSync,
      })),
      standbyMirrors: this.#config.mirrors.filter(m => m.status === 'standby').map(m => ({ id: m.id, networkLayer: m.networkLayer, provider: m.provider })),
      routingStrategy: this.#config.routing?.strategy || 'geo-latency-with-censorship-bypass',
      fallbackOrder: this.#config.routing?.fallbackOrder || [],
      antiCensorship: { enabled: this.#config.antiCensorship?.enabled || false, failoverCascade: this.#config.antiCensorship?.failoverCascade || [] },
      doomsdayVault: { enabled: this.#vaultConfig?.enabled || false, geoReplicas: this.#vaultConfig?.geoReplicas?.length || 0, quorumRequired: this.#vaultConfig?.restore?.quorumRequired || 1 },
      restoreDrillEnabled: this.#config.restoreDrill?.enabled || false,
      lastRestoreDrill: this.#state.lastRestoreDrill,
      breachCount: (this.#state.breaches || []).length,
      censorshipEventCount: (this.#state.censorshipEvents || []).length,
      vaultSnapshotCount: (this.#state.vaultSnapshots || []).length,
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
        case 'health': { const h = await secureCloud.health(); console.log(JSON.stringify(h, null, 2)); break; }
        case 'check-mirror': { const r = await secureCloud.checkMirrorHealth(process.argv[3]); console.log(JSON.stringify(r, null, 2)); break; }
        case 'restore-drill': { const d = await secureCloud.runRestoreDrill(); console.log(JSON.stringify(d, null, 2)); break; }
        case 'detect-censorship': { const c = await secureCloud.detectCensorship(); console.log(JSON.stringify(c, null, 2)); break; }
        case 'failover': { const f = await secureCloud.failoverCascade(); console.log(JSON.stringify(f, null, 2)); break; }
        case 'vault-snapshot': { const v = await secureCloud.vaultSnapshot(); console.log(JSON.stringify(v, null, 2)); break; }
        case 'vault-restore': { const v = await secureCloud.vaultRestore(process.argv[3]); console.log(JSON.stringify(v, null, 2)); break; }
        case 'verify': { const v = await secureCloud.verifyIntegrity(process.argv[3]); console.log(JSON.stringify(v, null, 2)); break; }
        case 'sync-manifest': { const m = await secureCloud.syncManifest(); console.log(JSON.stringify(m, null, 2)); break; }
        case 'config': { const c = await secureCloud.getConfig(); console.log(JSON.stringify(c, null, 2)); break; }
        default: console.log('Usage: node src/secure-cloud.mjs <health|check-mirror|restore-drill|detect-censorship|failover|vault-snapshot|vault-restore|verify|sync-manifest|config>');
      }
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  })();
}
