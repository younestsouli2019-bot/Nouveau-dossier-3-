import fs from "node:fs/promises";
import path from "node:path";

function nowMs() { return Date.now(); }

function parseListEnv(name, def = []) {
  const raw = process.env[name];
  if (!raw) return def;
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseJsonEnv(name, def = null) {
  const raw = process.env[name];
  if (!raw) return def;
  try {
    return JSON.parse(raw);
  } catch {
    return def;
  }
}

export class RouteManager {
  constructor({
    routes,
    persistencePath = path.join(process.cwd(), "data", "locks", "route-health.json"),
    baseBackoffMs = Number(process.env.ROUTE_BACKOFF_BASE_MS ?? "30000") || 30000,
    maxBackoffMs = Number(process.env.ROUTE_BACKOFF_MAX_MS ?? "3600000") || 3600000,
    weights = {},
    disabled = new Set(),
  } = {}) {
    const list = Array.isArray(routes) && routes.length > 0 ? routes : parseListEnv("ROUTE_LIST", []);
    const w = Object.assign({}, parseJsonEnv("ROUTE_WEIGHTS_JSON", {}), weights || {});
    const dis = new Set([...(parseJsonEnv("ROUTE_DISABLE_JSON", []) || []), ...Array.from(disabled || [])].map(String));

    this.routes = list.map((name) => ({ name, weight: Number(w[name] ?? 0) || 0 })).filter((r) => !dis.has(r.name));
    this.baseBackoffMs = baseBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
    this.persistencePath = persistencePath;
    this.state = {
      byRoute: {}
    };
  }

  async load() {
    try {
      const txt = await fs.readFile(this.persistencePath, "utf8");
      const obj = JSON.parse(txt);
      if (obj && typeof obj === "object" && obj.byRoute) this.state = obj;
    } catch {
      // ignore
    }
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.persistencePath), { recursive: true });
      await fs.writeFile(this.persistencePath, JSON.stringify(this.state, null, 2));
    } catch {
      // ignore persistence errors
    }
  }

  _ensureRoute(name) {
    if (!this.state.byRoute[name]) {
      this.state.byRoute[name] = {
        failures: 0,
        lastFailureAt: 0,
        lastSuccessAt: 0,
        cooldownUntil: 0,
      };
    }
    return this.state.byRoute[name];
  }

  getHealth(name) {
    return this._ensureRoute(name);
  }

  reportSuccess(name) {
    const h = this._ensureRoute(name);
    h.failures = 0;
    h.lastSuccessAt = nowMs();
    h.cooldownUntil = 0;
    return h;
  }

  reportFailure(name, reason) {
    const h = this._ensureRoute(name);
    h.failures = Math.max(0, Number(h.failures) || 0) + 1;
    h.lastFailureAt = nowMs();
    const backoff = Math.min(this.maxBackoffMs, this.baseBackoffMs * Math.pow(2, Math.min(10, h.failures - 1)));
    h.cooldownUntil = nowMs() + backoff;
    h.lastReason = String(reason ?? "failure");
    return h;
  }

  getAvailableRoutes() {
    const now = nowMs();
    const active = [];
    const cooling = [];
    for (const r of this.routes) {
      const h = this._ensureRoute(r.name);
      if (h.cooldownUntil && now < h.cooldownUntil) cooling.push({ ...r, health: h });
      else active.push({ ...r, health: h });
    }
    // Sort active by weight desc then lastSuccessAt desc then failures asc
    active.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if ((b.health?.lastSuccessAt || 0) !== (a.health?.lastSuccessAt || 0)) return (b.health?.lastSuccessAt || 0) - (a.health?.lastSuccessAt || 0);
      return (a.health?.failures || 0) - (b.health?.failures || 0);
    });

    // Cooling sorted by soonest ready first
    cooling.sort((a, b) => (a.health.cooldownUntil || 0) - (b.health.cooldownUntil || 0));
    return { active, cooling };
  }

  pickRoute() {
    const { active, cooling } = this.getAvailableRoutes();
    if (active.length > 0) return { route: active[0].name, info: active[0] };
    if (cooling.length > 0) return { route: cooling[0].name, info: cooling[0], cooling: true };
    return { route: null, info: null };
  }

  async withFailover(executor, { maxTries = null, onAttempt } = {}) {
    // executor: async ({ route }) => { ... }
    await this.load();
    const tried = new Set();

    // Snapshot of order
    const { active, cooling } = this.getAvailableRoutes();
    const ordered = [...active, ...cooling].map((r) => r.name);
    const limit = Math.min(ordered.length, maxTries || ordered.length || 0);

    let lastError = null;
    for (let i = 0; i < limit; i++) {
      const route = ordered[i];
      tried.add(route);
      if (typeof onAttempt === "function") {
        try { await onAttempt({ route, attempt: i + 1, remaining: limit - i - 1 }); } catch {}
      }
      try {
        const res = await executor({ route });
        this.reportSuccess(route);
        await this.save();
        return { ok: true, route, result: res };
      } catch (e) {
        this.reportFailure(route, e?.message ?? String(e));
        await this.save();
        lastError = e;
      }
    }
    return { ok: false, error: lastError?.message ?? String(lastError || "all routes failed"), tried: Array.from(tried) };
  }
}

// Builder Notes:
// - RouteManager is generic. Integrate at orchestration layer to wrap settlement or dispatch calls.
// - Env usage:
//   ROUTE_LIST=paypal,binance,bitget,bybit
//   ROUTE_WEIGHTS_JSON={"paypal":10,"binance":8,"bitget":7,"bybit":6}
//   ROUTE_DISABLE_JSON=["someRoute"]
//   ROUTE_BACKOFF_BASE_MS=30000, ROUTE_BACKOFF_MAX_MS=3600000
//   ROUTE_PERSIST_PATH overrides default path if desired.
// - To execute with failover:
//   const rm = new RouteManager({ routes:["paypal","binance","bitget","bybit"] });
//   await rm.withFailover(async ({route}) => {
//     switch(route){
//       case "paypal": return await sendViaPayPal(payload);
//       case "binance": return await sendViaBinance(payload);
//       case "bitget": return await sendViaBitget(payload);
//       case "bybit": return await sendViaBybit(payload);
//       default: throw new Error(`unknown route ${route}`);
//     }
//   });
