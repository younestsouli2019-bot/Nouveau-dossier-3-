#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DiscoveryAgent } from './discovery-agent.mjs';
import { InfraProvisioner } from './infra-provisioner.mjs';
import { IntegrationAgent } from './integration-agent.mjs';
import { QAAgent } from './qa-agent.mjs';
import { SelfHealingAgent } from './self-healing-agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const STATE_FILE = path.join(ROOT, '.swarm', 'charibaas-setup.json');

const STEP_TIMEOUT_MS = 120_000;

const ERROR_TAXONOMY = {
  PORT_CONFLICT: { pattern: /EADDRINUSE|address already in use|port.*in use/i, action: 'scan_ports_rewrite' },
  AUTH_REJECTION: { pattern: /auth|unauthorized|401|403|invalid.*credential|token.*expir/i, action: 'refresh_credentials' },
  SCHEMA_MISMATCH: { pattern: /migration|schema|column.*not found|relation.*exist/i, action: 'generate_migration' },
  DEPENDENCY_MISSING: { pattern: /not found|cannot find|ENOENT|no such/i, action: 'install_dependency' },
  NETWORK_UNREACHABLE: { pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/i, action: 'retry_with_backoff' },
  CONFIG_INVALID: { pattern: /invalid.*config|validation.*fail|malformed/i, action: 'regenerate_config' },
  DISK_FULL: { pattern: /ENOSPC|no space/i, action: 'cleanup_and_retry' },
  UNKNOWN: { pattern: /.*/, action: 'escalate' },
};

export class Orchestrator {
  constructor(options = {}) {
    this.options = {
      provider: options.provider || 'docker-compose',
      targetDir: options.targetDir || ROOT,
      skipDiscovery: options.skipDiscovery || false,
      skipProvision: options.skipProvision || false,
      skipIntegration: options.skipIntegration || false,
      skipQA: options.skipQA || false,
      ...options,
    };
    this.state = {
      step: 'init',
      status: 'pending',
      startedAt: new Date().toISOString(),
      context: {},
      provisionResult: null,
      integrationResult: null,
      qaResult: null,
      errors: [],
      recovery: [],
    };
    this.agents = {};
    this.pipelineHealth = {
      discovery: { ok: false, reason: 'not_started' },
      provision: { ok: false, reason: 'not_started' },
      integration: { ok: false, reason: 'not_started' },
      qa: { ok: false, reason: 'not_started' },
      selfHealing: { ok: true, reason: 'standby' },
    };
  }

  async log(msg) {
    const line = `[${new Date().toISOString()}] [ORCH] ${msg}`;
    console.log(line);
    try {
      await fs.appendFile(path.join(ROOT, '.swarm', 'charibaas-setup.log'), line + '\n', 'utf-8');
    } catch {}
  }

  async loadState() {
    try {
      const data = JSON.parse(await fs.readFile(STATE_FILE, 'utf-8'));
      Object.assign(this.state, data);
      await this.log(`Resumed state: step=${this.state.step} status=${this.state.status}`);
    } catch {}
  }

  async saveState() {
    try {
      const dir = path.dirname(STATE_FILE);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      await this.log(`State save failed: ${err.message}`);
    }
  }

  classifyError(error) {
    const msg = error?.message || String(error);
    for (const [type, entry] of Object.entries(ERROR_TAXONOMY)) {
      if (entry.pattern.test(msg)) {
        return { type, action: entry.action, message: msg };
      }
    }
    return { type: 'UNKNOWN', action: 'escalate', message: msg };
  }

  async retry(fn, label, maxRetries = 3, baseDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const classified = this.classifyError(err);
        await this.log(`[RETRY] ${label} attempt ${attempt}/${maxRetries} failed: ${classified.type} - ${classified.message}`);

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await this.log(`[RETRY] Backoff ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          const healed = await this.agents.selfHealing?.heal(classified, { label, attempt, state: this.state });
          if (healed) {
            await this.log(`[SELF-HEAL] Recovery applied, retrying ${label}`);
            attempt = 0;
            continue;
          }
          throw err;
        }
      }
    }
  }

  async run() {
    await this.loadState();

    this.agents.discovery = new DiscoveryAgent({ root: this.options.targetDir });
    this.agents.provisioner = new InfraProvisioner({ provider: this.options.provider, root: this.options.targetDir });
    this.agents.integration = new IntegrationAgent({ root: this.options.targetDir });
    this.agents.qa = new QAAgent({ root: this.options.targetDir });
    this.agents.selfHealing = new SelfHealingAgent({ state: this.state, taxonomy: ERROR_TAXONOMY });

    await this.log('=== ChariBaaS Auto-Setup Orchestrator ===');
    await this.log(`Provider: ${this.options.provider}`);
    await this.log(`Target:   ${this.options.targetDir}`);

    try {
      if (!this.options.skipDiscovery) await this.retry(() => this.stepDiscovery(), 'Discovery', 2, 1000);
      if (!this.options.skipProvision) await this.retry(() => this.stepProvision(), 'Provision', 3, 2000);
      if (!this.options.skipIntegration) await this.retry(() => this.stepIntegration(), 'Integration', 3, 2000);
      if (!this.options.skipQA) await this.retry(() => this.stepQA(), 'QA', 2, 1000);

      this.state.status = 'completed';
      this.state.completedAt = new Date().toISOString();
      await this.log('=== ChariBaaS Auto-Setup completed successfully ===');
    } catch (err) {
      this.state.status = 'failed';
      this.state.failedAt = new Date().toISOString();
      this.state.fatalError = err.message;
      await this.log(`=== ChariBaaS Auto-Setup FAILED: ${err.message} ===`);
      if (this.agents.selfHealing) {
        const classification = this.classifyError(err);
        await this.agents.selfHealing.heal(classification, { fatal: true, state: this.state });
      }
    }

    await this.saveState();
    return {
      status: this.state.status,
      errors: this.state.errors,
      recovery: this.state.recovery,
      pipelineHealth: this.pipelineHealth,
      state: this.state,
    };
  }

  async stepDiscovery() {
    this.state.step = 'discovery';
    this.pipelineHealth.discovery = { ok: false, reason: 'in_progress' };
    await this.log('Agent [Discovery]: Scanning project matrix...');

    const ctx = await this.agents.discovery.scan();
    this.state.context = ctx;
    this.pipelineHealth.discovery = { ok: true, reason: 'completed', context: ctx };

    await this.log(`  Framework: ${ctx.framework || 'unknown'}`);
    await this.log(`  Language:  ${ctx.language || 'unknown'}`);
    await this.log(`  Dependencies: ${ctx.dependencies?.length || 0} packages`);
    await this.log(`  CLI Tools: ${Object.entries(ctx.cliTools || {}).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'none'}`);
    await this.saveState();
    return ctx;
  }

  async stepProvision() {
    this.state.step = 'provision';
    this.pipelineHealth.provision = { ok: false, reason: 'in_progress' };
    await this.log(`Agent [IaC]: Generating configs for ${this.options.provider}...`);

    const result = await this.agents.provisioner.provision({
      context: this.state.context,
    });
    this.state.provisionResult = result;
    this.pipelineHealth.provision = { ok: result.success, reason: result.success ? 'completed' : result.error };

    if (result.success) {
      await this.log(`  Configs generated: ${result.configs?.length || 0}`);
      await this.log(`  Services: ${result.services?.join(', ') || 'none'}`);
    } else {
      await this.log(`  Provision FAILED: ${result.error}`);
    }
    await this.saveState();
    return result;
  }

  async stepIntegration() {
    this.state.step = 'integration';
    this.pipelineHealth.integration = { ok: false, reason: 'in_progress' };
    await this.log('Agent [Integration]: Hydrating runtime environment...');

    const result = await this.agents.integration.integrate({
      context: this.state.context,
      provisionResult: this.state.provisionResult,
    });
    this.state.integrationResult = result;
    this.pipelineHealth.integration = { ok: result.success, reason: result.success ? 'completed' : result.error };

    if (result.success) {
      await this.log(`  Env files: ${result.envFiles?.join(', ') || 'none'}`);
      await this.log(`  Vault secrets set: ${result.vaultSecrets?.length || 0}`);
    } else {
      await this.log(`  Integration FAILED: ${result.error}`);
    }
    await this.saveState();
    return result;
  }

  async stepQA() {
    this.state.step = 'qa';
    this.pipelineHealth.qa = { ok: false, reason: 'in_progress' };
    await this.log('Agent [QA]: Verifying deployment...');

    const result = await this.agents.qa.verify({
      context: this.state.context,
      provisionResult: this.state.provisionResult,
      integrationResult: this.state.integrationResult,
    });
    this.state.qaResult = result;
    this.pipelineHealth.qa = { ok: result.success, reason: result.success ? 'passed' : result.error };

    if (result.success) {
      await this.log(`  Smoke tests: ${result.smokePassed ? 'PASS' : 'FAIL'}`);
      await this.log(`  Synthetic txn: ${result.syntheticPassed ? 'PASS' : 'FAIL'}`);
      await this.log(`  Configs verified: ${result.configsVerified ? 'PASS' : 'FAIL'}`);
    } else {
      await this.log(`  QA FAILED: ${result.error}`);
    }
    await this.saveState();
    return result;
  }

  summary() {
    const h = this.pipelineHealth;
    const allOk = h.discovery.ok && h.provision.ok && h.integration.ok && h.qa.ok;
    return {
      status: allOk ? 'HEALTHY' : 'DEGRADED',
      pipeline: {
        discovery: h.discovery.ok ? 'PASS' : 'FAIL',
        provision: h.provision.ok ? 'PASS' : 'FAIL',
        integration: h.integration.ok ? 'PASS' : 'FAIL',
        qa: h.qa.ok ? 'PASS' : 'FAIL',
        selfHealing: h.selfHealing.ok ? 'ACTIVE' : 'STANDBY',
      },
      errors: this.state.errors?.length || 0,
      recovery: this.state.recovery?.length || 0,
      started: this.state.startedAt,
      completed: this.state.completedAt,
      stateStatus: this.state.status,
    };
  }
}
