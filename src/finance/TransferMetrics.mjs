/**
 * TransferMetrics — per-transfer observability for the treasury edge.
 *
 * OWNER guardrails covered:
 *   - "Per-transfer metrics, P95/P99 latencies, failed-transfer rates, daily
 *     volumes per counterparty, alerts for reconciliation mismatches."
 *
 * Non-goal: this is a metrics SINK (collect + alert signal). It never moves money.
 * It stores rolling counters in a JSON store so a dashboard/ops route can read them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class TransferMetrics {
  constructor({ dir, mismatches, now = () => Date.now() } = {}) {
    this.dir = dir || path.join(os.tmpdir(), 'treasury-metrics');
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'metrics.json');
    this.now = now;
    // mismatch detector injected (e.g. from bank-reconciliation) so this stays decoupled.
    this.onMismatch = mismatches || ((event) => console.warn('[metrics] reconcil-mismatch', event));
    this.store = this._load();
  }

  _load() {
    if (fs.existsSync(this.file)) { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {} }
    return { transfers: [], byCounterparty: {}, counters: { successes: 0, failures: 0 } };
  }
  _save() { fs.writeFileSync(this.file, JSON.stringify(this.store, null, 2)); }

  _day(ts) { return new Date(ts).toISOString().slice(0, 10); }

  /** Record one transfer attempt (call around each external call with its latencyMs). */
  record({ counterparty, amount, currency, ok, latencyMs, idempotencyKey, provider }) {
    const ts = this.now();
    const day = this._day(ts);
    this.store.transfers.push({ ts, day, counterparty, amount, currency, ok, latencyMs, provider, idem: idempotencyKey });
    // bound memory to last 5000 transfers
    if (this.store.transfers.length > 5000) this.store.transfers = this.store.transfers.slice(-5000);
    this.store.counters[ok ? 'successes' : 'failures']++;
    const cp = (this.store.byCounterparty[counterparty] = this.store.byCounterparty[counterparty] || { byDay: {} });
    const d = (cp.byDay[day] = cp.byDay[day] || { volume: 0, count: 0, failures: 0 });
    d.volume += amount; d.count++; if (!ok) d.failures++;
    this._save();
  }

  /** Latency percentile over recorded transfers in a window. */
  latencyPercentile(p, windowMs = 24 * 3600 * 1000) {
    const cutoff = this.now() - windowMs;
    const lats = this.store.transfers.filter(t => t.ts >= cutoff && t.latencyMs != null).map(t => t.latencyMs).sort((a, b) => a - b);
    if (!lats.length) return null;
    return lats[Math.min(lats.length - 1, Math.floor((p / 100) * lats.length))];
  }

  p95() { return this.latencyPercentile(95); }
  p99() { return this.latencyPercentile(99); }

  /** Failed-transfer rate in the window (0..1). */
  failureRate(windowMs = 24 * 3600 * 1000) {
    const cutoff = this.now() - windowMs;
    const ws = this.store.transfers.filter(t => t.ts >= cutoff);
    if (!ws.length) return 0;
    return ws.filter(t => !t.ok).length / ws.length;
  }

  /** Daily volume per counterparty. */
  dailyVolume(counterparty, day) {
    const d = this.store.byCounterparty[counterparty]?.byDay[day || this._day(this.now())];
    return d ? { volume: d.volume, count: d.count, failures: d.failures } : { volume: 0, count: 0, failures: 0 };
  }

  /** Alert on a reconciliation mismatch (amount/ref mismatch between internal & provider). */
  alertMismatch({ settlementId, expected, actual, currency, ref }) {
    const event = { type: 'RECONCIL_MISMATCH', ts: this.now(), settlementId, expected, actual, currency, ref };
    this.store.counters.mismatchAlerts = (this.store.counters.mismatchAlerts || 0) + 1;
    this._save();
    this.onMismatch(event);
    return event;
  }

  snapshot() {
    const now = this.now();
    const day = this._day(now);
    return {
      counters: this.store.counters,
      p95: this.p95(),
      p99: this.p99(),
      failureRate24h: this.failureRate(),
      totalTransfers: this.store.transfers.length,
      activeCounterparties: Object.keys(this.store.byCounterparty).length,
      day,
      daily: Object.fromEntries(Object.entries(this.store.byCounterparty).map(([k, v]) => [k, v.byDay[day] || { volume: 0, count: 0 }])),
    };
  }
}