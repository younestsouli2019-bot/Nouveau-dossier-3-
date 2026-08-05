import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

const now = () => Date.now();

class AnomalyEngine {
  #dir = null;
  #statePath = null;
  #rate = new Map();
  #geo = new Map();
  #initialized = false;

  constructor(opts = {}) {
    this.windowMs = opts.windowMs || parseInt(process.env.SWARM_ANOMALY_WINDOW_MS || '60000', 10);
    this.spikeMultiplier = opts.spikeMultiplier || parseFloat(process.env.SWARM_ANOMALY_SPIKE_MULT || '3');
    this.geoConflictWindowMs = opts.geoConflictWindowMs || parseInt(process.env.SWARM_ANOMALY_GEO_WINDOW_MS || '600000', 10);
    this.maxPayloadBytes = opts.maxPayloadBytes || parseInt(process.env.SWARM_ANOMALY_MAX_PAYLOAD_BYTES || '262144', 10);
  }

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'anomaly');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#statePath = path.join(this.#dir, 'state.json');
    await this.#load();
    this.#initialized = true;
    return this;
  }

  async #load() {
    if (existsSync(this.#statePath)) {
      try {
        const rec = JSON.parse(await fs.readFile(this.#statePath, 'utf-8'));
        this.#rate = new Map(Object.entries(rec.rate || {}));
        this.#geo = new Map(Object.entries(rec.geo || {}));
      } catch {
        this.#rate = new Map();
        this.#geo = new Map();
      }
    }
  }

  async #persist() {
    await fs.writeFile(this.#statePath, JSON.stringify({ rate: Object.fromEntries(this.#rate), geo: Object.fromEntries(this.#geo) }, null, 2), 'utf-8');
  }

  countInWindow(key, fromMs) {
    const arr = this.#rate.get(key) || [];
    return arr.filter(t => t > fromMs).length;
  }

  async record({ actor, ip = null, geo = null, action = null, params = {}, payloadSize = 0, allowedParams = null } = {}) {
    this.#ensureInit();
    const t = now();
    const rateKey = `${actor}@${ip || 'unknown'}`;
    const arr = this.#rate.get(rateKey) || [];
    arr.push(t);
    this.#rate.set(rateKey, arr);

    if (geo) {
      const seen = this.#geo.get(actor) || {};
      seen[geo] = t;
      this.#geo.set(actor, seen);
    }

    const anomalies = [];

    if (payloadSize > this.maxPayloadBytes) {
      anomalies.push({ type: 'PAYLOAD_TOO_LARGE', severity: 'MEDIUM', payloadSize, limit: this.maxPayloadBytes });
    }

    if (allowedParams && action) {
      const allowed = new Set(allowedParams);
      const unexpected = Object.keys(params || {}).filter(k => !allowed.has(k));
      if (unexpected.length > 0) {
        anomalies.push({ type: 'UNAUTHORIZED_PARAMETER_INJECTION', severity: 'HIGH', action, unexpected });
      }
    }

    const rate = this.countInWindow(rateKey, t - this.windowMs);
    if (rate >= 3) {
      const prev = this.countInWindow(rateKey, t - 2 * this.windowMs) - rate;
      const baseline = Math.max(prev, 1);
      if (rate > baseline * this.spikeMultiplier) {
        anomalies.push({ type: 'VELOCITY_SPIKE', severity: 'HIGH', actor, ip, windowMs: this.windowMs, rate, baseline });
      }
    }

    const seen = this.#geo.get(actor) || {};
    const geoKeys = Object.keys(seen);
    if (geoKeys.length > 1 && action && !actor.toLowerCase().includes('owner')) {
      const conflict = geoKeys.some((g, i) => i > 0 && seen[geoKeys[i - 1]] && t - seen[geoKeys[i - 1]] < this.geoConflictWindowMs);
      if (conflict) {
        anomalies.push({ type: 'GEO_CONFLICT', severity: 'HIGH', actor, geos: geoKeys, windowMs: this.geoConflictWindowMs });
      }
    }

    anomalies.push(...this.#geoPolicy(geoKeys));

    this.#prune(t, rateKey);
    await this.#persist();

    return { ok: anomalies.length === 0, anomalies, rate };
  }

  #prune(t, rateKey) {
    const cutoff = t - 10 * this.windowMs;
    for (const [key, arr] of [...this.#rate.entries()]) {
      const kept = arr.filter(x => x > cutoff);
      if (kept.length === 0) this.#rate.delete(key);
      else this.#rate.set(key, kept);
    }
    for (const [actor, seen] of [...this.#geo.entries()]) {
      const kept = Object.fromEntries(Object.entries(seen).filter(([, last]) => t - last < this.geoConflictWindowMs));
      if (Object.keys(kept).length === 0) this.#geo.delete(actor);
      else this.#geo.set(actor, kept);
    }
  }

  #geoPolicy(geoKeys) {
    const policy = process.env.SWARM_ALLOWED_GEO || null;
    if (!policy) return [];
    const allowed = policy.split(',').map(g => g.trim().toUpperCase());
    const anomalies = [];
    for (const geo of geoKeys) {
      if (!allowed.includes(geo.toUpperCase())) {
        anomalies.push({ type: 'UNKNOWN_GEO', severity: 'HIGH', geo });
      }
    }
    return anomalies;
  }

  async status() {
    this.#ensureInit();
    return { trackedRateKeys: this.#rate.size, trackedGeoActors: this.#geo.size, windowMs: this.windowMs, spikeMultiplier: this.spikeMultiplier };
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('AnomalyEngine not initialized. Call init() first.');
  }
}

const anomalyEngine = new AnomalyEngine();
export default anomalyEngine;
export { AnomalyEngine };
