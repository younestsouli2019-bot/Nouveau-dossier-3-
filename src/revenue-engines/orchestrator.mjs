import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { list, get, loadAllEngines } from './registry.mjs';
import contingencyEngine from '../contingency.mjs';
import ownerRouteValidator from '../owner-route-validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TRACE_DIR = path.join(ROOT, 'data', 'orchestrator-traces');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');

const THREAT_LEVELS = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

class RevenueOrchestrator {
  constructor() {
    this._initialized = false;
    this._traceId = null;
    this._spanId = null;
    this._spans = [];
  }

  async init() {
    if (this._initialized) return;
    mkdirSync(TRACE_DIR, { recursive: true });
    await loadAllEngines();
    await contingencyEngine.init();
    await ownerRouteValidator.init();
    this._initialized = true;
  }

  _loadTruth() {
    try { return JSON.parse(fs.readFileSync(TRUTH_PATH, 'utf-8')); } catch { return null; }
  }

  _startTrace(name) {
    this._traceId = crypto.randomUUID();
    this._spanId = crypto.randomUUID();
    this._spans = [];
    this._addSpan('orchestrator', name, 'start');
    return { traceId: this._traceId, rootSpanId: this._spanId };
  }

  _addSpan(service, name, phase, extra = {}) {
    const span = {
      traceId: this._traceId,
      spanId: crypto.randomUUID(),
      parentSpanId: this._spans.length > 0 ? this._spans[this._spans.length - 1].spanId : null,
      service, name, phase,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    this._spans.push(span);
    return span;
  }

  async _saveTrace(result) {
    const trace = {
      traceId: this._traceId,
      spans: this._spans,
      result,
      generated_at: new Date().toISOString(),
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(TRACE_DIR, `trace-${stamp}.json`);
    await fs.writeFile(filePath, JSON.stringify(trace, null, 2));
    await fs.writeFile(path.join(TRACE_DIR, 'trace-latest.json'), JSON.stringify(trace, null, 2));
    return filePath;
  }

  async orchestrate(goal = 'run-all') {
    await this.init();
    const trace = this._startTrace(`orchestrate:${goal}`);

    const health = await contingencyEngine.health();
    if (!health.healthy) {
      this._addSpan('policy', 'circuit-breaker-check', 'blocked', {
        threatLevel: health.threatLevel,
        openCircuits: health.openCircuits,
      });
      return {
        status: 'BLOCKED',
        goal,
        threatLevel: health.threatLevel,
        openCircuits: health.openCircuits,
        traceId: this._traceId,
        spans: this._spans.length,
      };
    }

    if (goal === 'run-all') return this._runAllEngines(trace);
    if (goal.startsWith('run:')) {
      const engineName = goal.slice(4);
      return this._runSingleEngine(engineName, trace);
    }
    if (goal === 'status') return this._statusAll(trace);

    return { status: 'UNKNOWN_GOAL', goal };
  }

  async _runAllEngines(trace) {
    this._addSpan('orchestrator', 'run-all', 'discover');
    const engines = list();
    const results = [];
    const truth = this._loadTruth();
    const allocationSplits = truth?.settlementPolicy?.fundAllocation?.splits || [];

    for (const { name, factory } of engines) {
      this._addSpan(name, `engine:${name}`, 'run');
      const engineResult = await factory().run();
      results.push({ engine: name, result: engineResult });

      for (const earning of engineResult.earnings || []) {
        const cbCheck = await contingencyEngine.monitorTransaction({
          destination: earning.earningId,
          paymentMethod: 'crypto',
          amount: earning.amount,
          previousBalance: 0,
        });
        if (cbCheck.length > 0) {
          this._addSpan('policy', 'circuit-breaker-tripped', 'blocked', { earningId: earning.earningId, threats: cbCheck });
          continue;
        }

        const allocation = this._applyAllocation(earning.amount, earning.currency, allocationSplits);
        this._addSpan('policy', 'fund-allocation', 'applied', {
          earningId: earning.earningId,
          totalAmount: earning.amount,
          splits: allocation,
        });
      }
    }

    this._addSpan('orchestrator', 'run-all', 'complete', {
      enginesRun: results.length,
      ok: results.filter(r => r.result.status === 'ok').length,
      partial: results.filter(r => r.result.status === 'partial').length,
    });

    const summary = {
      goal: 'run-all',
      status: results.some(r => r.result.status === 'fatal') ? 'partial' : 'ok',
      enginesRun: results.length,
      ok: results.filter(r => r.result.status === 'ok').length,
      partial: results.filter(r => r.result.status === 'partial').length,
      fatal: results.filter(r => r.result.status === 'fatal').length,
      envMissing: results.filter(r => r.result.status === 'env_missing').length,
      results,
    };

    const tracePath = await this._saveTrace(summary);
    return { ...summary, tracePath };
  }

  async _runSingleEngine(engineName, trace) {
    const entry = get(engineName);
    if (!entry) {
      this._addSpan('orchestrator', `run:${engineName}`, 'not-found');
      return { status: 'ENGINE_NOT_FOUND', engine: engineName };
    }

    this._addSpan(engineName, `engine:${engineName}`, 'run');
    const result = await entry.factory().run();
    this._addSpan('orchestrator', `run:${engineName}`, 'complete', { status: result.status });

    const summary = { goal: `run:${engineName}`, engine: engineName, status: result.status, result };
    const tracePath = await this._saveTrace(summary);
    return { ...summary, tracePath };
  }

  async _statusAll(trace) {
    const engines = list();
    const statuses = [];
    for (const { name, factory } of engines) {
      statuses.push(await factory().status());
    }
    return { goal: 'status', engines: statuses, traceId: this._traceId };
  }

  _applyAllocation(amount, currency, splits) {
    if (!splits || splits.length === 0) return [];
    return splits.map(s => ({
      id: s.id,
      label: s.label,
      pct: s.pct,
      amount: Number((amount * s.pct / 100).toFixed(8)),
      currency,
      destination: s.destination,
      purpose: s.purpose,
      priority: s.priority,
    }));
  }
}

const orchestrator = new RevenueOrchestrator();
export default orchestrator;
export { RevenueOrchestrator };
