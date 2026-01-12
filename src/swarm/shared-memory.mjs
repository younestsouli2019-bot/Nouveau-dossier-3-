export class SwarmMemory {
  constructor(initial = {}) {
    this.state = { ...(initial || {}) };
  }
  get(key = null) {
    if (!key) return this.state;
    return this.state[key];
  }
  set(key, value) {
    this.state[key] = value;
    return this;
  }
}

