export class NetworkGuard {
  constructor({ intervalMs = 30000 } = {}) {
    this.intervalMs = intervalMs;
    this.running = false;
  }
  async start() {
    this.running = true;
    return { ok: true, intervalMs: this.intervalMs };
  }
}

