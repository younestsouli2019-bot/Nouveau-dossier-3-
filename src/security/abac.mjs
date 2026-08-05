import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

function resolveBaseDir() {
  return path.resolve(process.env.SWARM_SECURITY_DIR || path.join(process.cwd(), 'data', 'security'));
}

const HIGH_RISK_ACTIONS = new Set([
  'payout.execute',
  'payout.submit',
  'payout.approve',
  'payout.resubmit',
  'crypto.withdraw',
  'wire.submit',
  'auto-pilot.enable',
  'recovery.approve',
  'recovery.resolve',
  'audit.unseal',
  'config.owner',
  'agent.isolate',
  'rekey.swarm',
  'thaw.global',
  'procurement.execute',
  'procurement.supplier.register',
  'procurement.supplier.approve',
  'procurement.settle',
]);

const LIVE_GATED_ACTIONS = new Set([
  'payout.execute',
  'payout.submit',
  'payout.approve',
  'payout.resubmit',
  'crypto.withdraw',
  'wire.submit',
  'recovery.resolve',
  'procurement.settle',
]);

class ABACEngine {
  #dir = null;
  #policyPath = null;
  #approvalsPath = null;
  #policy = null;
  #validator = null;
  #initialized = false;

  async init({ validator = null } = {}) {
    this.#dir = path.join(resolveBaseDir(), 'abac');
    await fs.mkdir(this.#dir, { recursive: true });
    this.#policyPath = path.join(this.#dir, 'policy.json');
    this.#approvalsPath = path.join(this.#dir, 'approvals.json');
    this.#validator = validator;
    await this.#loadPolicy();
    this.#initialized = true;
    return this;
  }

  async #loadPolicy() {
    const defaults = {
      version: 'ABAC-1.0',
      rules: {
        'payout.execute': { roles: ['owner'], hitl: true },
        'payout.submit': { roles: ['owner', 'supervisor'], hitl: true },
        'payout.approve': { roles: ['owner'], hitl: true },
        'payout.resubmit': { roles: ['owner'], hitl: true },
        'crypto.withdraw': { roles: ['owner'], hitl: true },
        'wire.submit': { roles: ['owner'], hitl: true },
        'auto-pilot.enable': { roles: ['owner'], hitl: true },
        'auto-pilot.disable': { roles: ['owner'], hitl: true },
        'recovery.scan': { roles: ['owner', 'supervisor', 'agent'], hitl: false },
        'recovery.approve': { roles: ['owner'], hitl: true },
        'recovery.resolve': { roles: ['owner'], hitl: true },
        'audit.read': { roles: ['owner', 'supervisor'], hitl: false },
        'audit.seal': { roles: ['owner'], hitl: true },
        'audit.unseal': { roles: ['owner'], hitl: true },
        'config.owner': { roles: ['owner'], hitl: true },
        'agent.register': { roles: ['owner', 'supervisor'], hitl: false },
        'agent.isolate': { roles: ['owner', 'supervisor'], hitl: true },
        'rekey.swarm': { roles: ['owner'], hitl: true },
        'thaw.global': { roles: ['owner'], hitl: true },
        'dashboard.read': { roles: ['owner', 'supervisor', 'agent'], hitl: false },
        'legal.protocol': { roles: ['owner'], hitl: true },
        'procurement.execute': { roles: ['owner', 'agent'], hitl: false },
        'procurement.supplier.register': { roles: ['owner'], hitl: true },
        'procurement.supplier.approve': { roles: ['owner'], hitl: true },
        'procurement.settle': { roles: ['owner', 'agent'], hitl: true },
      },
      highRisk: [...HIGH_RISK_ACTIONS],
      liveGated: [...LIVE_GATED_ACTIONS],
    };
    if (existsSync(this.#policyPath)) {
      try {
        this.#policy = { ...defaults, ...JSON.parse(await fs.readFile(this.#policyPath, 'utf-8')) };
        return;
      } catch {
        this.#policy = defaults;
        return;
      }
    }
    this.#policy = defaults;
    await fs.mkdir(this.#dir, { recursive: true });
    await fs.writeFile(this.#policyPath, JSON.stringify(this.#policy, null, 2), 'utf-8');
  }

  async #savePolicy() {
    await fs.writeFile(this.#policyPath, JSON.stringify(this.#policy, null, 2), 'utf-8');
  }

  async evaluate({ subject, action, resource = null, env = {} } = {}) {
    this.#ensureInit();
    if (!subject || !action) throw new Error('ABAC: subject and action required');
    const role = subject.role || 'agent';
    const tenancy = subject.tenancy || 'default';
    const rule = this.#policy.rules[action];
    if (!rule) return { decision: 'deny', reason: `no policy rule for action "${action}"`, action, role };
    if (!rule.roles.includes(role)) {
      return { decision: 'deny', reason: `role "${role}" not authorized for "${action}" (allowed: ${rule.roles.join(', ')})`, action, role };
    }
    const live = env.liveMode === true || process.env.SWARM_LIVE === 'true';
    if (this.#policy.liveGated.includes(action) && !live) {
      return { decision: 'deny', reason: `action "${action}" requires live mode (SWARM_LIVE=true)`, action, role };
    }
    const threat = env.threatLevel || 'GREEN';
    if ((threat === 'ORANGE' || threat === 'RED') && this.#policy.highRisk.includes(action)) {
      return { decision: 'deny', reason: `threat level ${threat} freezes high-risk action "${action}"`, action, role, threat };
    }
    if (subject.role === 'owner') {
      if (subject.ownerClaim && this.#validator) {
        const v = this.#validator.verifyOwnerIdentity(subject.ownerClaim);
        if (!v.verified) {
          return { decision: 'deny', reason: `owner claim failed: ${v.reason}`, action, role };
        }
      }
      if (rule.hitl && !subject.approval) {
        return { decision: 'hitl', reason: `action "${action}" requires human-in-the-loop owner approval`, action, role, resource, tenancy };
      }
      return { decision: 'allow', reason: 'owner authorized', action, role, resource, tenancy };
    }
    if (rule.hitl) {
      return { decision: 'hitl', reason: `action "${action}" requires human-in-the-loop approval`, action, role, resource, tenancy };
    }
    return { decision: 'allow', reason: 'authorized by policy', action, role, resource, tenancy };
  }

  async assertAllowed(args) {
    const r = await this.evaluate(args);
    if (r.decision !== 'allow') throw new Error(`ABAC DENIED: ${r.reason}`);
    return r;
  }

  async requestApproval({ action, detail = null, actor = 'system' } = {}) {
    this.#ensureInit();
    const code = crypto.randomBytes(9).toString('base64url');
    let approvals = await this.#loadApprovals();
    approvals.push({ id: code, action, detail, actor, status: 'pending', createdAt: new Date().toISOString() });
    await fs.writeFile(this.#approvalsPath, JSON.stringify(approvals, null, 2), 'utf-8');
    return { approvalId: code, action, status: 'pending', note: 'owner must approve in dashboard before execution' };
  }

  async submitApproval({ approvalId, ownerClaim, detail = null } = {}) {
    this.#ensureInit();
    if (this.#validator) {
      const v = this.#validator.verifyOwnerIdentity(ownerClaim);
      if (!v.verified) throw new Error(`ABAC HITL BLOCKED: ${v.reason}`);
    }
    const approvals = await this.#loadApprovals();
    const found = approvals.find(a => a.id === approvalId);
    if (!found) throw new Error('ABAC: approval id not found');
    if (found.status !== 'pending') throw new Error(`ABAC: approval already ${found.status}`);
    found.status = 'approved';
    found.approvedAt = new Date().toISOString();
    await fs.writeFile(this.#approvalsPath, JSON.stringify(approvals, null, 2), 'utf-8');
    return { approvalId, action: found.action, status: 'approved' };
  }

  async #loadApprovals() {
    if (!existsSync(this.#approvalsPath)) return [];
    try {
      return JSON.parse(await fs.readFile(this.#approvalsPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  async listApprovals() {
    this.#ensureInit();
    return this.#loadApprovals();
  }

  getPolicy() {
    this.#ensureInit();
    return structuredClone(this.#policy);
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('ABACEngine not initialized. Call init() first.');
  }
}

const abacEngine = new ABACEngine();
export default abacEngine;
export { ABACEngine, HIGH_RISK_ACTIONS, LIVE_GATED_ACTIONS };
