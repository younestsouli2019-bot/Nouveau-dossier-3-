export class ConfigManager {
  constructor(initial = {}) {
    this.config = { ...(initial || {}) };
  }
  get(key, fallback = null) {
    const v = this.config?.[key];
    return v == null ? fallback : v;
  }
  set(key, value) {
    this.config[key] = value;
    return this;
  }
}

