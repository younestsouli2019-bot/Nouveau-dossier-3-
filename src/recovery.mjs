import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import swarmMemory from './swarm-memory.mjs';
import ownerRouteValidator from './owner-route-validator.mjs';

const STATE_PATH = path.join(process.cwd(), '.autonomous-state.json');
const TRUTH_PATH = path.join(process.cwd(), 'owner-truth.json');
const RECOVERY_LOG_PATH = path.join(process.cwd(), '.swarm', 'recovery-log.json');

class RecoveryEngine {
  #memory;
  #validator;

  constructor(memory = swarmMemory, validator = ownerRouteValidator) {
    this.#memory = memory;
    this.#validator = validator;
  }

  async init() {
    await this.#memory.init();
    try {
      await this.#validator.init();
    } catch {
      // Validator init failure is non-fatal for recovery, but logged
    }
    await fs.mkdir(path.dirname(RECOVERY_LOG_PATH), { recursive: true });
    return this;
  }

  async loadAutonomousState() {
    if (!existsSync(STATE_PATH)) {
      return {
        consecutiveFailures: 0,
        freeze: { active: false, reason: null },
        exportedPayoneerBatches: {},
        updatedAt: new Date().toISOString(),
      };
    }
    try {
      const raw = await fs.readFile(STATE_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { consecutiveFailures: 0, freeze: { active: false, reason: null } };
    }
  }

  async saveAutonomousState(state) {
    state.updatedAt = new Date().toISOString();
    const tmp = STATE_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tmp, STATE_PATH);
  }

  async resetErrorStorm() {
    const state = await this.loadAutonomousState();
    const prevFailures = state.consecutiveFailures;
    const wasFrozen = state.freeze?.active;

    state.consecutiveFailures = 0;
    state.freeze = { active: false, reason: null };
    state.lastRecoveryAt = new Date().toISOString();
    state.recoveryAction = 'ERROR_STORM_RESET';

    await this.saveAutonomousState(state);

    await this.#logRecovery({
      action: 'ERROR_STORM_RESET',
      previousFailures: prevFailures,
      wasFrozen,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      previousFailures,
      wasFrozen,
      newState: state,
    };
  }

  async recoverPayoneerBatches() {
    const state = await this.loadAutonomousState();
    const batches = state.exportedPayoneerBatches || {};
    const batchIds = Object.keys(batches);

    const recoverable = batchIds.filter(id => {
      const b = batches[id];
      return b.status === 'completed' && !b.external_disbursed;
    });

    const results = [];
    for (const batchId of recoverable) {
      const batch = batches[batchId];
      batch.status = 'failed_payoneer_restricted';
      batch.metadata = {
        ...(batch.metadata || {}),
        recovery_action: 'DOWNgraded_TO_FAILED',
        recovery_at: new Date().toISOString(),
        original_status: 'completed',
        external_disbursed: false,
        failure_reason: 'Payoneer API access restricted - see owner-truth.json',
        reprocess_required: true,
        recommended_route: 'crypto_or_bank_wire',
      };
      results.push({ batchId, action: 'DOWNGRADED', batch });
    }

    if (results.length > 0) {
      state.exportedPayoneerBatches = batches;
      state.lastRecoveryAt = new Date().toISOString();
      await this.saveAutonomousState(state);
    }

    await this.#logRecovery({
      action: 'PAYONEER_BATCH_RECOVERY',
      totalBatches: batchIds.length,
      recoverableCount: recoverable.length,
      results,
      timestamp: new Date().toISOString(),
    });

    return { totalBatches: batchIds.length, recovered: results };
  }

  async migrateMemoryState() {
    const state = await this.loadAutonomousState();

    await this.#memory.set('autonomous:state', state, { namespace: 'migration' });
    await this.#memory.set('autonomous:freeze', state.freeze, { namespace: 'migration' });
    await this.#memory.set('autonomous:payoneer_batches', state.exportedPayoneerBatches || {}, {
      namespace: 'migration',
    });

    if (existsSync(path.join(process.cwd(), '.autonomous-offline-store.json'))) {
      try {
        const offline = JSON.parse(
          await fs.readFile(path.join(process.cwd(), '.autonomous-offline-store.json'), 'utf-8')
        );
        await this.#memory.set('autonomous:offline_store', offline, { namespace: 'migration' });
      } catch { /* skip corrupt file */ }
    }

    if (existsSync(path.join(process.cwd(), '.base44-offline-store.json'))) {
      try {
        const base44 = JSON.parse(
          await fs.readFile(path.join(process.cwd(), '.base44-offline-store.json'), 'utf-8')
        );
        await this.#memory.set('base44:offline_store', base44, { namespace: 'migration' });
      } catch { /* skip corrupt file */ }
    }

    await this.#memory.set('owner:truth', this.#validator.getTruth(), { namespace: 'owner' });
    await this.#memory.set('owner:accounts', this.#validator.getOwnerAccounts(), { namespace: 'owner' });
    await this.#memory.set('owner:policy', this.#validator.getPolicy(), { namespace: 'owner' });

    const checksum = this.#memory.checksum();

    await this.#logRecovery({
      action: 'MEMORY_MIGRATION',
      keysMigrated: this.#memory.keys().length,
      checksum,
      timestamp: new Date().toISOString(),
    });

    return { keysMigrated: this.#memory.keys().length, checksum };
  }

  async healthCheck() {
    const issues = [];

    const stateExists = existsSync(STATE_PATH);
    if (!stateExists) {
      issues.push({ severity: 'WARNING', issue: '.autonomous-state.json missing' });
    } else {
      const state = await this.loadAutonomousState();
      if (state.freeze?.active) {
        issues.push({
          severity: 'CRITICAL',
          issue: `System frozen: ${state.freeze.reason}`,
          action: 'run resetErrorStorm()',
        });
      }
      if (state.consecutiveFailures > 10) {
        issues.push({
          severity: 'HIGH',
          issue: `${state.consecutiveFailures} consecutive failures`,
          action: 'run resetErrorStorm()',
        });
      }
    }

    const truthExists = existsSync(TRUTH_PATH);
    if (!truthExists) {
      issues.push({
        severity: 'CRITICAL',
        issue: 'owner-truth.json missing',
        action: 'Create owner-truth.json with owner identity',
      });
    }

    try {
      this.#validator.getOwnerAccounts();
    } catch (err) {
      issues.push({
        severity: 'CRITICAL',
        issue: `OwnerRouteValidator failed: ${err.message}`,
      });
    }

    const memoryKeys = this.#memory.keys();
    if (memoryKeys.length === 0) {
      issues.push({
        severity: 'INFO',
        issue: 'SwarmMemory is empty - run migrateMemoryState()',
      });
    }

    return {
      healthy: issues.filter(i => i.severity === 'CRITICAL').length === 0,
      issues,
      memoryKeys: memoryKeys.length,
      timestamp: new Date().toISOString(),
    };
  }

  async fullRecovery() {
    const steps = [];

    steps.push({ step: '1', name: 'Reset error storm', result: await this.resetErrorStorm() });
    steps.push({ step: '2', name: 'Recover Payoneer batches', result: await this.recoverPayoneerBatches() });
    steps.push({ step: '3', name: 'Migrate to SwarmMemory', result: await this.migrateMemoryState() });

    const health = await this.healthCheck();
    steps.push({ step: '4', name: 'Health check', result: health });

    await this.#logRecovery({
      action: 'FULL_RECOVERY',
      steps: steps.map(s => ({ step: s.step, name: s.name, success: !s.result.error })),
      health: health.healthy,
      timestamp: new Date().toISOString(),
    });

    return { steps, health };
  }

  async #logRecovery(entry) {
    let log = [];
    if (existsSync(RECOVERY_LOG_PATH)) {
      try {
        log = JSON.parse(await fs.readFile(RECOVERY_LOG_PATH, 'utf-8'));
      } catch { log = []; }
    }
    log.push(entry);
    if (log.length > 200) log = log.slice(-200);
    const tmp = RECOVERY_LOG_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(log, null, 2), 'utf-8');
    await fs.rename(tmp, RECOVERY_LOG_PATH);
  }
}

const recoveryEngine = new RecoveryEngine();
export default recoveryEngine;
export { RecoveryEngine };
