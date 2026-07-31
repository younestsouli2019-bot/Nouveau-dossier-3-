import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const STATE_PATH = path.join(ROOT, 'data', 'settlement', 'guardrails.json');

class GuardrailEngine {
  constructor() {
    this.state = null;
  }

  async init() {
    mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    if (!existsSync(STATE_PATH)) {
      this.state = { version: 1, agents: {} };
      await this._persist();
    } else {
      this.state = JSON.parse(await fs.readFile(STATE_PATH, 'utf-8'));
    }
    return this;
  }

  async _persist() {
    const tmp = STATE_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tmp, STATE_PATH);
  }

  config() {
    return {
      maxAgentValueCap: Number(process.env.GUARDRAIL_AGENT_CAP || 10000),
      maxSwarmValueCap: Number(process.env.GUARDRAIL_SWARM_CAP || 100000),
      maxErrorRate: Number(process.env.GUARDRAIL_MAX_ERROR_RATE || 0.1),
      errorWindowMs: Number(process.env.GUARDRAIL_ERROR_WINDOW_MS || 60000),
      minErrorsToTrip: Number(process.env.GUARDRAIL_MIN_ERRORS || 3),
    };
  }

  _agentState(agent) {
    if (!this.state.agents[agent]) {
      this.state.agents[agent] = {
        accumulatedValue: 0,
        errors: [],
        successes: [],
        frozenUntil: null,
        frozenReason: null,
      };
    }
    return this.state.agents[agent];
  }

  async checkValue(agent, amount) {
    await this.init();
    const cfg = this.config();
    const st = this._agentState(agent);
    if (st.frozenUntil && Date.now() < new Date(st.frozenUntil).getTime()) {
      return { allowed: false, reason: `AGENT_FROZEN: ${st.frozenReason}`, agent, amount };
    }
    if (st.accumulatedValue + amount > cfg.maxAgentValueCap) {
      return { allowed: false, reason: 'AGENT_VALUE_CAP_EXCEEDED', agent, amount, cap: cfg.maxAgentValueCap, requiresHumanApproval: true };
    }
    const swarmTotal = Object.values(this.state.agents).reduce((s, a) => s + a.accumulatedValue, 0);
    if (swarmTotal + amount > cfg.maxSwarmValueCap) {
      return { allowed: false, reason: 'SWARM_VALUE_CAP_EXCEEDED', agent, amount, cap: cfg.maxSwarmValueCap, requiresHumanApproval: true };
    }
    st.accumulatedValue += amount;
    await this._persist();
    return { allowed: true, agent, amount };
  }

  async recordSuccess(agent) {
    await this.init();
    const cfg = this.config();
    const st = this._agentState(agent);
    const now = Date.now();
    st.successes.push(now);
    st.successes = st.successes.filter(t => now - t < cfg.errorWindowMs);
    await this._persist();
  }

  async recordError(agent, error) {
    await this.init();
    const cfg = this.config();
    const st = this._agentState(agent);
    const now = Date.now();
    st.errors.push({ at: now, error: error?.message || String(error) });
    st.errors = st.errors.filter(e => now - e.at < cfg.errorWindowMs);

    const errorsInWindow = st.errors.length;
    const successesInWindow = st.successes.length;
    const total = errorsInWindow + successesInWindow;
    const rate = total === 0 ? 0 : errorsInWindow / total;

    if (errorsInWindow >= cfg.minErrorsToTrip && rate > cfg.maxErrorRate) {
      st.frozenUntil = new Date(now + 60 * 1000).toISOString();
      st.frozenReason = `ERROR_STORM: ${errorsInWindow} errors / ${rate.toFixed(2)} rate in ${cfg.errorWindowMs}ms window`;
    }
    await this._persist();
    return { errorsInWindow, successesInWindow, rate: Number(rate.toFixed(3)), frozen: !!st.frozenUntil };
  }

  async isFrozen(agent) {
    await this.init();
    const st = this._agentState(agent);
    if (!st.frozenUntil) return { frozen: false };
    if (Date.now() >= new Date(st.frozenUntil).getTime()) {
      st.frozenUntil = null;
      st.frozenReason = null;
      st.errors = [];
      await this._persist();
      return { frozen: false };
    }
    return { frozen: true, reason: st.frozenReason, frozenUntil: st.frozenUntil };
  }

  async status() {
    return {
      config: this.config(),
      agents: Object.fromEntries(
        Object.entries(this.state.agents).map(([a, s]) => [a, { accumulatedValue: s.accumulatedValue, frozen: !!s.frozenUntil, frozenReason: s.frozenReason, errorsInWindow: s.errors.length }])
      ),
    };
  }
}

const guardrailEngine = new GuardrailEngine();
export default guardrailEngine;
export { GuardrailEngine };
