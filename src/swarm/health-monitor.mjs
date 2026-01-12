export class AgentHealthMonitor {
  constructor({ intervalMs = 30000 } = {}) {
    this.intervalMs = intervalMs;
    this.started = false;
  }
  async start() {
    this.started = true;
    return { ok: true, intervalMs: this.intervalMs };
  }
  async check() {
    return { ok: true, at: new Date().toISOString() };
  }
}

