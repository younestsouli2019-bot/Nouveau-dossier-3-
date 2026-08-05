import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import keychain from './keychain.mjs';
import tokenService from './token.mjs';
import didRegistry from './did.mjs';
import auditLog from './audit.mjs';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

class IncidentResponse {
  #dir = null;
  #incidentsPath = null;
  #honeypotPath = null;
  #initialized = false;
  #keychain = null;
  #tokenService = null;
  #didRegistry = null;
  #auditLog = null;

  async init(opts = {}) {
    this.#dir = path.join(opts.baseDir || resolveBaseDir(), 'incidents');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#incidentsPath = path.join(this.#dir, 'incidents.json');
    this.#honeypotPath = path.join(this.#dir, 'honeypot.json');
    this.#keychain = opts.keychain || keychain;
    this.#tokenService = opts.tokenService || tokenService;
    this.#didRegistry = opts.didRegistry || didRegistry;
    this.#auditLog = opts.auditLog || auditLog;
    this.#initialized = true;
    return this;
  }

  async #recordIncident(entry) {
    let incidents = [];
    if (existsSync(this.#incidentsPath)) {
      try {
        incidents = JSON.parse(await fs.readFile(this.#incidentsPath, 'utf-8'));
      } catch {
        incidents = [];
      }
    }
    incidents.push({ ...entry, at: new Date().toISOString() });
    if (incidents.length > 1000) incidents = incidents.slice(-1000);
    await fs.writeFile(this.#incidentsPath, JSON.stringify(incidents, null, 2), 'utf-8');
  }

  async isolateAgent({ did, actor = 'system', reason = null } = {}) {
    this.#ensureInit();
    if (!did) throw new Error('IncidentResponse: did required');
    await this.#didRegistry.revokeAgent(did);
    await this.#tokenService.revokeForSubject(did);
    await this.#recordIncident({ kind: 'AGENT_ISOLATED', did, actor, reason, action: 'revoke_did+revoke_tokens' });
    await this.#auditLog.append({ actor, action: 'AGENT_ISOLATE', resource: `did:${did}`, result: 'isolated', detail: reason });
    return { isolated: did };
  }

  async revokeCredentials({ subject, actor = 'system', reason = null } = {}) {
    this.#ensureInit();
    if (!subject) throw new Error('IncidentResponse: subject required');
    await this.#tokenService.revokeForSubject(subject);
    await this.#recordIncident({ kind: 'CREDENTIAL_REVOKED', subject, actor, reason });
    await this.#auditLog.append({ actor, action: 'CREDENTIAL_REVOKE', resource: subject, result: 'revoked', detail: reason });
    return { revoked: subject, epoch: (await this.#tokenService.status()).epoch };
  }

  async rekeySwarm({ actor = 'system', reason = null } = {}) {
    this.#ensureInit();
    const before = await this.#keychain.status();
    const rotation = await this.#keychain.rotateMasterKey();
    await this.#tokenService.revokeAll();
    const after = await this.#keychain.status();
    await this.#recordIncident({
      kind: 'SWARM_REKEY',
      actor,
      reason,
      beforeVersion: before.version,
      afterVersion: after.version,
      tokensRevoked: true,
    });
    await this.#auditLog.append({ actor, action: 'REKEY_SWARM', resource: 'master-key', result: `rotated v${after.version}`, detail: reason });
    return { beforeVersion: before.version, afterVersion: after.version, tokensRevoked: true };
  }

  async activateHoneypot({ actor = 'system', reason = null } = {}) {
    this.#ensureInit();
    const state = { active: true, since: new Date().toISOString(), actor, reason };
    await fs.writeFile(this.#honeypotPath, JSON.stringify(state, null, 2), 'utf-8');
    await this.#recordIncident({ kind: 'HONEYPOT_ACTIVATED', actor, reason });
    await this.#auditLog.append({ actor, action: 'HONEYPOT_ACTIVATE', resource: 'dashboard', result: 'decoy mode', detail: reason });
    return state;
  }

  async deactivateHoneypot({ actor = 'system', reason = null } = {}) {
    this.#ensureInit();
    const state = { active: false, since: null, deactivatedAt: new Date().toISOString(), actor, reason };
    await fs.writeFile(this.#honeypotPath, JSON.stringify(state, null, 2), 'utf-8');
    await this.#recordIncident({ kind: 'HONEYPOT_DEACTIVATED', actor, reason });
    await this.#auditLog.append({ actor, action: 'HONEYPOT_DEACTIVATE', resource: 'dashboard', result: 'real mode', detail: reason });
    return state;
  }

  async isHoneypotMode() {
    this.#ensureInit();
    if (!existsSync(this.#honeypotPath)) return false;
    try {
      const rec = JSON.parse(await fs.readFile(this.#honeypotPath, 'utf-8'));
      return rec.active === true;
    } catch {
      return false;
    }
  }

  async runPlaybook({ name, ctx = {}, actor = 'system', reason = null } = {}) {
    this.#ensureInit();
    const playbooks = {
      agent_isolate: async () => this.isolateAgent({ did: ctx.did, actor, reason }),
      credential_revoke: async () => this.revokeCredentials({ subject: ctx.subject, actor, reason }),
      swarm_rekey: async () => this.rekeySwarm({ actor, reason }),
      honeypot_on: async () => this.activateHoneypot({ actor, reason }),
      honeypot_off: async () => this.deactivateHoneypot({ actor, reason }),
    };
    const fn = playbooks[name];
    if (!fn) throw new Error(`IncidentResponse: unknown playbook "${name}"`);
    const result = await fn();
    return { playbook: name, result };
  }

  async incidents() {
    this.#ensureInit();
    if (!existsSync(this.#incidentsPath)) return [];
    try {
      return JSON.parse(await fs.readFile(this.#incidentsPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  async status() {
    this.#ensureInit();
    return {
      honeypot: await this.isHoneypotMode(),
      incidents: (await this.incidents()).length,
    };
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('IncidentResponse not initialized. Call init() first.');
  }
}

const incidentResponse = new IncidentResponse();
export default incidentResponse;
export { IncidentResponse };
