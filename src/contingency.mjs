#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTINGENCY_STATE = path.join(ROOT, '.swarm', 'contingency-state.json');
const CONTINGENCY_LOG = path.join(ROOT, '.swarm', 'contingency-log.json');
const FORENSIC_DIR = path.join(ROOT, '.swarm', 'forensic-snapshots');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');

const THREAT_LEVELS = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
const THREAT_NAMES = ['GREEN', 'YELLOW', 'ORANGE', 'RED'];

// ---------------------------------------------------------------------------
// BreachDetector — monitors for anomalous activity
// ---------------------------------------------------------------------------
class BreachDetector {
  constructor(engine) {
    this.engine = engine;
    this.anomalyLog = [];
    this.thresholds = {
      maxPayoutsPerWindow: 3,
      payoutWindowMinutes: 60,
      maxNewDestinationsPerDay: 2,
      maxAuthFailuresPerWindow: 5,
      authWindowMinutes: 15,
      maxBalanceDropPct: 30,
      offHoursStart: 22,
      offHoursEnd: 6,
    };
  }

  async monitorPayoutVelocity(tx) {
    const state = await this.engine.loadState();
    const now = Date.now();
    const window = this.thresholds.payoutWindowMinutes * 60 * 1000;

    const recent = (state.recentPayouts || []).filter(t => now - new Date(t.timestamp).getTime() < window);
    recent.push({ ...tx, timestamp: new Date().toISOString() });

    if (recent.length > this.thresholds.maxPayoutsPerWindow) {
      return this.engine.raiseThreat({
        type: 'PAYOUT_VELOCITY',
        severity: 'HIGH',
        detail: `${recent.length} payouts in ${this.thresholds.payoutWindowMinutes}min (max ${this.thresholds.maxPayoutsPerWindow})`,
        payload: { windowPayouts: recent.length, limit: this.thresholds.maxPayoutsPerWindow, txs: recent.slice(-5) },
      });
    }
    state.recentPayouts = recent.slice(-20);
    await this.engine._persist(state);
    return null;
  }

  async monitorNewDestination(destination, method) {
    const state = await this.engine.loadState();
    const knownDests = state.knownDestinations || {};
    const key = `${method}:${String(destination).toLowerCase()}`;

    if (!knownDests[key]) {
      knownDests[key] = { firstSeen: new Date().toISOString(), count: 0 };
    }
    knownDests[key].count++;

    const today = new Date().toDateString();
    const todayFirstSeen = knownDests[key].firstSeen.startsWith(today);
    if (todayFirstSeen && knownDests[key].count >= this.thresholds.maxNewDestinationsPerDay) {
      return this.engine.raiseThreat({
        type: 'NEW_DESTINATION_VELOCITY',
        severity: 'MEDIUM',
        detail: `${destination} seen ${knownDests[key].count} times today (first seen today)`,
        payload: { destination, method, count: knownDests[key].count, firstSeen: knownDests[key].firstSeen },
      });
    }

    state.knownDestinations = knownDests;
    await this.engine._persist(state);
    return null;
  }

  async monitorAuthFailures(identifier) {
    const state = await this.engine.loadState();
    const now = Date.now();
    const window = this.thresholds.authWindowMinutes * 60 * 1000;

    const failures = (state.recentAuthFailures || []).filter(f => now - new Date(f.timestamp).getTime() < window);
    failures.push({ identifier, timestamp: new Date().toISOString() });

    if (failures.length >= this.thresholds.maxAuthFailuresPerWindow) {
      return this.engine.raiseThreat({
        type: 'AUTH_FAILURE_STORM',
        severity: 'CRITICAL',
        detail: `${failures.length} failed auth attempts in ${this.thresholds.authWindowMinutes}min from ${identifier}`,
        payload: { failures: failures.length, window: this.thresholds.authWindowMinutes, identifier },
      });
    }

    state.recentAuthFailures = failures.slice(-50);
    await this.engine._persist(state);
    return null;
  }

  async monitorOffHoursActivity() {
    const hour = new Date().getHours();
    if (hour >= this.thresholds.offHoursStart || hour < this.thresholds.offHoursEnd) {
      return this.engine.raiseThreat({
        type: 'OFF_HOURS_ACTIVITY',
        severity: 'LOW',
        detail: `Activity at ${hour}:00 (off-hours: ${this.thresholds.offHoursStart}:00-${this.thresholds.offHoursEnd}:00)`,
        payload: { hour, offHoursStart: this.thresholds.offHoursStart, offHoursEnd: this.thresholds.offHoursEnd },
      });
    }
    return null;
  }

  async monitorBalanceDrop(previousBalance, newBalance) {
    if (previousBalance <= 0) return null;
    const dropPct = ((previousBalance - newBalance) / previousBalance) * 100;
    if (dropPct >= this.thresholds.maxBalanceDropPct) {
      return this.engine.raiseThreat({
        type: 'BALANCE_DRAIN',
        severity: 'CRITICAL',
        detail: `Balance dropped ${dropPct.toFixed(1)}% (${previousBalance} -> ${newBalance})`,
        payload: { previousBalance, newBalance, dropPct: dropPct.toFixed(1) },
      });
    }
    return null;
  }

  async monitorTransaction(tx) {
    const threats = [];
    const v = await this.monitorPayoutVelocity(tx);
    if (v) threats.push(v);

    if (tx.destination) {
      const d = await this.monitorNewDestination(tx.destination, tx.paymentMethod || 'unknown');
      if (d) threats.push(d);
    }

    const o = await this.monitorOffHoursActivity();
    if (o) threats.push(o);

    if (tx.previousBalance !== undefined && tx.amount !== undefined) {
      const b = await this.monitorBalanceDrop(tx.previousBalance, tx.previousBalance - tx.amount);
      if (b) threats.push(b);
    }

    return threats;
  }

  summary() {
    const recent = this.anomalyLog.slice(-50);
    return {
      totalAnomalies: this.anomalyLog.length,
      recentAnomalies: recent.length,
      recentThreats: recent.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH').length,
      thresholds: this.thresholds,
    };
  }
}

// ---------------------------------------------------------------------------
// CircuitBreaker — progressive response levels
// ---------------------------------------------------------------------------
class CircuitBreaker {
  constructor(engine) {
    this.engine = engine;
    this.circuits = {
      outboundPayouts: { state: 'CLOSED', level: 0, failures: 0, lastTrip: null, cooldownMs: 300_000 },
      newDestinations: { state: 'CLOSED', level: 0, failures: 0, lastTrip: null, cooldownMs: 600_000 },
      authSystem: { state: 'CLOSED', level: 0, failures: 0, lastTrip: null, cooldownMs: 900_000 },
      balanceManagement: { state: 'CLOSED', level: 0, failures: 0, lastTrip: null, cooldownMs: 300_000 },
    };
  }

  async trip(circuitName, reason, level = 1) {
    if (!this.circuits[circuitName]) return null;
    const circuit = this.circuits[circuitName];
    circuit.state = level >= 2 ? 'OPEN' : 'HALF_OPEN';
    circuit.level = Math.max(circuit.level, level);
    circuit.failures++;
    circuit.lastTrip = new Date().toISOString();
    circuit.reason = reason;

    await this.engine.log(`[CB] ${circuitName} -> ${circuit.state} (level ${circuit.level}, ${circuit.failures} failures)`);
    await this.engine._persist(await this.engine.loadState());

    return {
      circuit: circuitName,
      state: circuit.state,
      level: circuit.level,
      failures: circuit.failures,
      reason,
    };
  }

  async reset(circuitName) {
    if (!this.circuits[circuitName]) return null;
    const circuit = this.circuits[circuitName];
    const prevState = circuit.state;
    circuit.state = 'CLOSED';
    circuit.level = 0;
    circuit.lastTrip = null;
    await this.engine.log(`[CB] ${circuitName}: ${prevState} -> CLOSED`);
    return { circuit: circuitName, previousState: prevState, newState: 'CLOSED' };
  }

  isAllowed(circuitName) {
    const circuit = this.circuits[circuitName];
    if (!circuit) return true;
    if (circuit.state === 'CLOSED') return true;
    if (circuit.state === 'HALF_OPEN') {
      if (circuit.lastTrip && Date.now() - new Date(circuit.lastTrip).getTime() > circuit.cooldownMs) {
        this.reset(circuitName);
        return true;
      }
      return true;
    }
    return false;
  }

  async check(circuitName) {
    const circuit = this.circuits[circuitName];
    if (!circuit) return { allowed: true, reason: 'unknown_circuit' };

    if (circuit.state === 'CLOSED') return { allowed: true, reason: 'circuit_closed' };

    if (circuit.state === 'HALF_OPEN' && circuit.lastTrip) {
      const elapsed = Date.now() - new Date(circuit.lastTrip).getTime();
      if (elapsed > circuit.cooldownMs) {
        await this.reset(circuitName);
        return { allowed: true, reason: 'circuit_reset_after_cooldown' };
      }
      return { allowed: true, reason: `half_open_allowed (${Math.round((circuit.cooldownMs - elapsed) / 1000)}s until full close)` };
    }

    return {
      allowed: false,
      reason: `circuit_OPEN: ${circuitName} blocked since ${circuit.lastTrip} (level ${circuit.level}, ${circuit.failures} failures)`,
      circuit: circuitName,
      level: circuit.level,
      failures: circuit.failures,
      lastTrip: circuit.lastTrip,
      cooldownRemaining: circuit.lastTrip ? Math.max(0, circuit.cooldownMs - (Date.now() - new Date(circuit.lastTrip).getTime())) : 0,
    };
  }

  async globalFreeze(reason) {
    const results = [];
    for (const name of Object.keys(this.circuits)) {
      results.push(await this.trip(name, reason, 3));
    }
    await this.engine.log(`[CB] GLOBAL FREEZE: ${reason}`);
    return results;
  }

  async globalThaw(reason) {
    const results = [];
    for (const name of Object.keys(this.circuits)) {
      results.push(await this.reset(name));
    }
    await this.engine.log(`[CB] GLOBAL THAW: ${reason}`);
    return results;
  }

  summary() {
    return Object.entries(this.circuits).map(([name, c]) => ({
      name,
      state: c.state,
      level: c.level,
      failures: c.failures,
      lastTrip: c.lastTrip,
      cooldownRemaining: c.lastTrip ? Math.max(0, c.cooldownMs - (Date.now() - new Date(c.lastTrip).getTime())) : 0,
    }));
  }
}

// ---------------------------------------------------------------------------
// EscalationManager — severity matrix and notification
// ---------------------------------------------------------------------------
class EscalationManager {
  constructor(engine) {
    this.engine = engine;
    this.escalations = [];
    this.timers = {};
    this.policy = {
      LOW: { level: 1, notify: ['log'], maxResponseMinutes: 1440, autoEscalateAfter: null },
      MEDIUM: { level: 2, notify: ['log', 'console'], maxResponseMinutes: 120, autoEscalateAfter: 240 },
      HIGH: { level: 3, notify: ['log', 'console', 'webhook'], maxResponseMinutes: 30, autoEscalateAfter: 60 },
      CRITICAL: { level: 4, notify: ['log', 'console', 'webhook', 'freeze'], maxResponseMinutes: 5, autoEscalateAfter: 15 },
    };
  }

  async escalate(threat) {
    const severity = threat.severity || 'LOW';
    const policy = this.policy[severity] || this.policy.LOW;

    const escalation = {
      id: crypto.randomUUID(),
      threatType: threat.type,
      severity,
      level: policy.level,
      detail: threat.detail,
      payload: threat.payload,
      timestamp: new Date().toISOString(),
      actions: policy.notify,
      responded: false,
      response: null,
      autoEscalateAt: policy.autoEscalateAfter
        ? new Date(Date.now() + policy.autoEscalateAfter * 60 * 1000).toISOString()
        : null,
    };

    this.escalations.push(escalation);

    for (const action of policy.notify) {
      switch (action) {
        case 'freeze':
          await this.engine.circuitBreaker.globalFreeze(`[${severity}] ${threat.type}: ${threat.detail}`);
          break;
        case 'webhook':
          await this.engine._fireWebhook('escalation', escalation);
          break;
        case 'console':
          console.error(`[ESCALATION ${severity}] ${threat.type}: ${threat.detail}`);
          break;
        case 'log':
          await this.engine.log(`[ESCALATION ${severity}] ${threat.type}: ${threat.detail}`);
          break;
      }
    }

    if (escalation.autoEscalateAt) {
      const delay = policy.autoEscalateAfter * 60 * 1000;
      this.timers[escalation.id] = setTimeout(async () => {
        const updated = this.escalations.find(e => e.id === escalation.id);
        if (updated && !updated.responded) {
          const nextLevel = this._nextSeverity(severity);
          if (nextLevel) {
            await this.escalate({ ...threat, severity: nextLevel, detail: `${threat.detail} [AUTO-ESCALATED from ${severity}]` });
          }
        }
        delete this.timers[escalation.id];
      }, delay);
    }

    return escalation;
  }

  async respond(escalationId, response) {
    const escalation = this.escalations.find(e => e.id === escalationId);
    if (!escalation) throw new Error(`Escalation ${escalationId} not found`);
    escalation.responded = true;
    escalation.response = response;
    escalation.respondedAt = new Date().toISOString();

    if (this.timers[escalationId]) {
      clearTimeout(this.timers[escalationId]);
      delete this.timers[escalationId];
    }

    await this.engine.log(`[ESCALATION] ${escalationId} responded: ${response}`);
    return escalation;
  }

  _nextSeverity(current) {
    const levels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const idx = levels.indexOf(current);
    return idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;
  }

  summary() {
    const active = this.escalations.filter(e => !e.responded);
    return {
      total: this.escalations.length,
      active: active.length,
      critical: active.filter(e => e.severity === 'CRITICAL').length,
      high: active.filter(e => e.severity === 'HIGH').length,
      recentEscalations: this.escalations.slice(-10),
    };
  }
}

// ---------------------------------------------------------------------------
// RecoveryOrchestrator — post-incident recovery
// ---------------------------------------------------------------------------
class RecoveryOrchestrator {
  constructor(engine) {
    this.engine = engine;
  }

  async freezeEvidence(reason) {
    await fs.mkdir(FORENSIC_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshot = {
      timestamp,
      reason,
      state: await this.engine.loadState(),
      circuitBreakers: this.engine.circuitBreaker.summary(),
      activeEscalations: this.engine.escalationManager.escalations.filter(e => !e.responded),
      truth: await this.engine._loadTruth(),
      systemInfo: {
        node: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    };

    const snapshotFile = path.join(FORENSIC_DIR, `forensic-${timestamp}.json`);
    await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    await this.engine.log(`[FORENSIC] Snapshot saved: ${snapshotFile}`);

    return { snapshotFile, snapshot };
  }

  async rotateCredentials(reason) {
    const vaultScript = path.join(ROOT, 'src', 'mcp', 'swarm-vault.ps1');
    const actions = [];

    try {
      await fs.access(vaultScript);
      const secretsToRotate = [
        'CHARI_BAAS_SECRET_KEY',
        'BAAS_WALLET_ID',
        'STRIPE_SECRET_KEY',
        'WEBHOOK_SECRET',
      ];

      for (const secret of secretsToRotate) {
        actions.push({ secret, action: 'flag_for_rotation', reason });
      }

      await this.engine.log(`[CREDENTIALS] ${actions.length} secrets flagged for rotation: ${reason}`);
    } catch {
      await this.engine.log('[CREDENTIALS] Vault not available, manual rotation required');
      actions.push({ action: 'manual_rotation_required', reason });
    }

    return actions;
  }

  async lockdown(reason) {
    const results = {
      circuits: await this.engine.circuitBreaker.globalFreeze(`LOCKDOWN: ${reason}`),
      forensic: await this.freezeEvidence(`LOCKDOWN: ${reason}`),
      credentials: await this.rotateCredentials(`LOCKDOWN: ${reason}`),
      timestamp: new Date().toISOString(),
    };

    // Write lockdown manifest
    const manifest = path.join(FORENSIC_DIR, `LOCKDOWN-${new Date().toISOString().replace(/[:.]/g, '-')}.manifest.json`);
    await fs.writeFile(manifest, JSON.stringify(results, null, 2), 'utf-8');
    await this.engine.log(`[LOCKDOWN] Activated: ${reason}`);

    return results;
  }

  async thaw(reason, verificationToken) {
    const state = await this.engine.loadState();
    if (state.lockdownToken && state.lockdownToken !== verificationToken) {
      throw new Error('LOCKDOWN THAW BLOCKED: Invalid verification token');
    }

    const results = {
      circuits: await this.engine.circuitBreaker.globalThaw(`THAW: ${reason}`),
      timestamp: new Date().toISOString(),
    };

    await this.engine.log(`[LOCKDOWN] Lifted: ${reason}`);
    return results;
  }

  async generateIncidentReport(threat) {
    const report = {
      incidentId: crypto.randomUUID(),
      title: `Incident: ${threat.type}`,
      severity: threat.severity,
      detectedAt: new Date().toISOString(),
      detail: threat.detail,
      payload: threat.payload,
      state: await this.engine.loadState(),
      circuitStatus: this.engine.circuitBreaker.summary(),
      escalationLog: this.engine.escalationManager.escalations.slice(-20),
      forensicSnapshots: [],
    };

    try {
      const files = await fs.readdir(FORENSIC_DIR);
      report.forensicSnapshots = files.filter(f => f.endsWith('.json')).slice(-5).map(f => ({
        file: f,
        path: path.join(FORENSIC_DIR, f),
      }));
    } catch {}

    const reportFile = path.join(FORENSIC_DIR, `INCIDENT-${report.incidentId}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    await this.engine.log(`[INCIDENT] Report saved: ${reportFile}`);

    return report;
  }

  summary() {
    return {
      forensicDir: FORENSIC_DIR,
      hasSnapshots: false,
      lastIncident: null,
    };
  }
}

// ---------------------------------------------------------------------------
// ContingencyPlanner — pre-planned response playbooks
// ---------------------------------------------------------------------------
class ContingencyPlanner {
  constructor(engine) {
    this.engine = engine;
    this.playbooks = {
      BREACH_CONFIRMED: {
        id: 'PLAYBOOK-BREACH-001',
        name: 'Confirmed Security Breach',
        severity: 'CRITICAL',
        steps: [
          'IMMEDIATE: Trip all circuit breakers (GLOBAL FREEZE)',
          'IMMEDIATE: Take forensic snapshot of all state',
          'FAST: Rotate all credentials in vault',
          'FAST: Revoke all active sessions/tokens',
          'MEDIUM: Generate incident report with evidence',
          'MEDIUM: Notify owner via all channels',
          'SLOW: Review audit log for unauthorized transactions',
          'SLOW: Contact affected financial institutions',
          'RECOVERY: Restore from pre-breach state snapshot',
          'POST-MORTEM: Update security policy to prevent recurrence',
        ],
        references: [
          'owner-truth.json → identityPolicy',
          'owner-truth.json → contingency.emergencyContacts',
          'src/contingency.mjs → RecoveryOrchestrator.lockdown()',
        ],
      },
      ASSET_SEIZURE: {
        id: 'PLAYBOOK-SEIZURE-001',
        name: 'Asset Seizure / Account Freeze by Authority',
        severity: 'CRITICAL',
        steps: [
          'IMMEDIATE: Do NOT resist legal freeze order',
          'IMMEDIATE: Freeze evidence — take snapshot of all state BEFORE freeze',
          'FAST: Contact legal counsel (see emergencyContacts)',
          'FAST: Preserve all transaction records for compliance',
          'MEDIUM: Identify which accounts/assets are affected',
          'MEDIUM: Activate backup payout routes if available (non-frozen accounts)',
          'SLOW: Comply with legal information requests — document everything',
          'RECOVERY: After freeze lifted, verify account integrity before resuming',
          'POST-MORTEM: Implement multi-jurisdiction account strategy',
        ],
        references: [
          'owner-truth.json → contingency.legalJurisdictions',
          'owner-truth.json → contingency.backupPayoutMethods',
          'src/contingency.mjs → RecoveryOrchestrator.lockdown()',
        ],
      },
      AUTH_STORM: {
        id: 'PLAYBOOK-AUTH-001',
        name: 'Authentication Failure Storm',
        severity: 'HIGH',
        steps: [
          'IMMEDIATE: Trip authSystem circuit breaker',
          'FAST: Check for brute-force pattern in auth failure log',
          'FAST: Rotate leaked or exposed credentials',
          'MEDIUM: Enable rate limiting on auth endpoints',
          'MEDIUM: Notify owner of possible credential stuffing attack',
          'RECOVERY: After cooldown, reset circuit and test with single auth attempt',
        ],
        references: [
          'src/contingency.mjs → BreachDetector.monitorAuthFailures()',
          'src/contingency.mjs → CircuitBreaker.circuits.authSystem',
        ],
      },
      FUND_MISDIRECTION: {
        id: 'PLAYBOOK-FUND-001',
        name: 'Funds Sent to Wrong Destination',
        severity: 'HIGH',
        steps: [
          'IMMEDIATE: Trip outboundPayouts circuit breaker',
          'IMMEDIATE: Take forensic snapshot',
          'FAST: Identify destination — check if reclaimable (PayPal reversal, bank recall)',
          'FAST: Contact destination institution within recall window',
          'MEDIUM: Generate incident report for insurance/legal',
          'MEDIUM: Update allowedRecipients if destination was fraudulent',
          'SLOW: Initiate recall/reversal procedure',
          'RECOVERY: After reclaim, verify destination allowlist integrity',
        ],
        references: [
          'owner-truth.json → allowedRecipients',
          'owner-truth.json → settlementPolicy.forbiddenFlows',
          'src/contingency.mjs → BreachDetector.monitorNewDestination()',
        ],
      },
      SYSTEM_FAILURE: {
        id: 'PLAYBOOK-SYS-001',
        name: 'Critical System Failure / Data Loss',
        severity: 'MEDIUM',
        steps: [
          'FAST: Assess data loss scope from .swarm/ state files',
          'FAST: Restore from latest forensic snapshot',
          'MEDIUM: Verify SwarmMemory data integrity',
          'MEDIUM: Check all circuit breaker states',
          'SLOW: Restart daemon and verify pipeline health',
          'RECOVERY: Run full recovery cycle (src/recovery.mjs)',
        ],
        references: [
          'src/recovery.mjs → RecoveryEngine.fullRecovery()',
          '.swarm/forensic-snapshots/',
          'src/mcp/autonomous_daemon.mjs',
        ],
      },
    };
  }

  async getPlaybook(threatType) {
    const keyMap = {
      PAYOUT_VELOCITY: 'BREACH_CONFIRMED',
      NEW_DESTINATION_VELOCITY: 'FUND_MISDIRECTION',
      AUTH_FAILURE_STORM: 'AUTH_STORM',
      BALANCE_DRAIN: 'BREACH_CONFIRMED',
      OFF_HOURS_ACTIVITY: 'BREACH_CONFIRMED',
      SEIZURE: 'ASSET_SEIZURE',
      SYSTEM_FAILURE: 'SYSTEM_FAILURE',
    };
    const playbookKey = keyMap[threatType] || 'BREACH_CONFIRMED';
    return this.playbooks[playbookKey] || this.playbooks.BREACH_CONFIRMED;
  }

  async executePlaybook(threat) {
    const playbook = await this.getPlaybook(threat.type);
    await this.engine.log(`[PLAYBOOK] Executing "${playbook.name}" (${playbook.id})`);

    const execution = {
      playbookId: playbook.id,
      playbookName: playbook.name,
      triggeredBy: threat.type,
      severity: threat.severity,
      startedAt: new Date().toISOString(),
      steps: playbook.steps.map(step => ({ step, status: 'pending', completedAt: null })),
    };

    const state = await this.engine.loadState();
    state.lastPlaybook = execution;
    await this.engine._persist(state);

    return execution;
  }

  summary() {
    return {
      playbooks: Object.keys(this.playbooks).length,
      playbookNames: Object.values(this.playbooks).map(p => ({ id: p.id, name: p.name, severity: p.severity })),
    };
  }
}

// ---------------------------------------------------------------------------
// Main Contingency Engine
// ---------------------------------------------------------------------------
class ContingencyEngine {
  constructor() {
    this.state = null;
    this.breachDetector = new BreachDetector(this);
    this.circuitBreaker = new CircuitBreaker(this);
    this.escalationManager = new EscalationManager(this);
    this.recoveryOrchestrator = new RecoveryOrchestrator(this);
    this.contingencyPlanner = new ContingencyPlanner(this);
    this.initialized = false;
  }

  async init() {
    await fs.mkdir(path.dirname(CONTINGENCY_STATE), { recursive: true });
    await fs.mkdir(FORENSIC_DIR, { recursive: true });
    this.state = await this.loadState();
    await this.log('=== Contingency Engine initialized ===');
    this.initialized = true;
    return this;
  }

  async log(msg) {
    const line = `[${new Date().toISOString()}] [CNT] ${msg}`;
    console.log(line);
    try {
      await fs.appendFile(CONTINGENCY_LOG, line + '\n', 'utf-8');
    } catch {}
  }

  async loadState() {
    try {
      return JSON.parse(await fs.readFile(CONTINGENCY_STATE, 'utf-8'));
    } catch {
      return {
        threatLevel: 'GREEN',
        recentPayouts: [],
        recentAuthFailures: [],
        knownDestinations: {},
        lastPlaybook: null,
        lockdownToken: null,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async _persist(state) {
    if (!state) state = this.state;
    state.updatedAt = new Date().toISOString();
    const tmp = CONTINGENCY_STATE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tmp, CONTINGENCY_STATE);
  }

  async _loadTruth() {
    try { return JSON.parse(await fs.readFile(TRUTH_PATH, 'utf-8')); } catch { return null; }
  }

  async _fireWebhook(eventType, payload) {
    const http = await import('http');
    const data = JSON.stringify({ event: eventType, ...payload, timestamp: new Date().toISOString() });
    const req = http.request({
      hostname: 'localhost', port: 9876, path: '/webhook/contingency',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 5000,
    });
    req.on('error', () => {});
    req.write(data);
    req.end();
  }

  async raiseThreat(threat) {
    const level = threat.severity === 'CRITICAL' ? 'RED' : threat.severity === 'HIGH' ? 'ORANGE' : threat.severity === 'MEDIUM' ? 'YELLOW' : 'GREEN';
    const threatLevelNum = THREAT_LEVELS[level];

    if (threatLevelNum > THREAT_LEVELS[this.state.threatLevel]) {
      this.state.threatLevel = level;
      await this._persist();
    }

    await this.log(`[THREAT ${threat.severity}] ${threat.type}: ${threat.detail}`);

    const escalation = await this.escalationManager.escalate(threat);
    const playbook = await this.contingencyPlanner.executePlaybook(threat);

    // If CRITICAL, auto-lockdown
    if (threat.severity === 'CRITICAL') {
      const lockdownToken = crypto.randomUUID();
      this.state.lockdownToken = lockdownToken;
      await this._persist();
      await this.recoveryOrchestrator.lockdown(threat.detail);
      await this.recoveryOrchestrator.generateIncidentReport(threat);
      await this.log(`[LOCKDOWN] Token: ${lockdownToken} — save this to thaw`);
    }

    return { escalation, playbook, threatLevel: level, lockdownToken: this.state.lockdownToken };
  }

  async monitorTransaction(tx) {
    const threats = await this.breachDetector.monitorTransaction(tx);
    return threats;
  }

  async monitorAuthFailure(identifier) {
    const threat = await this.breachDetector.monitorAuthFailures(identifier);
    if (threat) {
      await this.circuitBreaker.trip('authSystem', `Auth storm from ${identifier}`, 2);
    }
    return threat;
  }

  // --- Public API ---

  async freeze(reason) {
    return this.recoveryOrchestrator.lockdown(reason);
  }

  async thaw(token, reason) {
    this.state.lockdownToken = null;
    await this._persist();
    await this.circuitBreaker.globalThaw(reason);
    this.state.threatLevel = 'YELLOW';
    await this._persist();
    return { thawed: true, reason };
  }

  async health() {
    const cbStatus = this.circuitBreaker.summary();
    const openCircuits = cbStatus.filter(c => c.state === 'OPEN');
    return {
      threatLevel: this.state.threatLevel,
      healthy: openCircuits.length === 0 && this.state.threatLevel === 'GREEN',
      openCircuits: openCircuits.map(c => ({ name: c.name, reason: c.lastTrip })),
      circuitBreakers: cbStatus,
      escalations: this.escalationManager.summary(),
      breaches: this.breachDetector.summary(),
      playbooks: this.contingencyPlanner.summary().playbookNames,
      timestamp: new Date().toISOString(),
    };
  }
}

const contingencyEngine = new ContingencyEngine();
export default contingencyEngine;
export {
  ContingencyEngine,
  BreachDetector,
  CircuitBreaker,
  EscalationManager,
  RecoveryOrchestrator,
  ContingencyPlanner,
};
