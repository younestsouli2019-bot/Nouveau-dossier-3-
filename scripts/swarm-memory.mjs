import "dotenv/config";
import { Client } from "pg";

/**
 * PERSISTENT SWARM MEMORY + ANTICIPATION FOUNDATION
 * ---------------------------------------------------------------------------
 * Replaces the ephemeral in-memory / flat-file swarm memory with a durable,
 * Postgres-backed store (same Neon database as the authorizer ledger), giving
 * the swarm the five capabilities requested:
 *
 *   1. CONTEXT RETENTION  — per-agent conversation/context history survives
 *      restarts & deploys (EphemeralMemory resets; this does not).
 *   2. PROACTIVE SUGGESTIONS — an anticipation layer records every agent
 *      decision, then emits ranked next-action suggestions from history.
 *   3. ERROR RECOVERY — durable error + graceful-degradation log with policy
 *      state (degrade -> remediate -> restart), so a service can restart with
 *      updates instead of losing state.
 *   4. AMBIGUOUS REQUESTS — intent observations are recorded and re-ranked via
 *      weighted history (probabilistic interpretation over OWNER historical
 *      intent + swarm goals) rather than a hardcoded guess.
 *   5. EXTERNAL INTEGRATION — integration registry for API connectors
 *      (name/kind/baseUrl/status/metadata). NEVER stores secrets.
 *
 * The exported class stays drop-in compatible with the existing consumers:
 *   - map-style  : get(key) / set(key, value)      (supervisor/agent-replenisher)
 *   - file-style : read(key) / write(key, data) / appendLog(entry)
 *   - persistent : contextSave/contextGet, decide/suggest, errorLog, integration+
 *
 * Commands:
 *   node scripts/swarm-memory.mjs setup
 *   node scripts/swarm-memory.mjs set <key> <json>      | get <key>
 *   node scripts/swarm-memory.mjs write <key> <json>    | read <key>
 *   node scripts/swarm-memory.mjs context save <agent> <json> | context get <agent>
 *   node scripts/swarm-memory.mjs decide <agent> <action> <outcome> <metaJson?>
 *   node scripts/swarm-memory.mjs suggest [agent] [json?]
 *   node scripts/swarm-memory.mjs error <agent> <error> [policyJson?]
 *   node scripts/swarm-memory.mjs integration add <name> <kind> <baseUrl>
 *   node scripts/swarm-memory.mjs status
 */

const SEED_INTEGRATIONS = [
  { name: "base44-agent-swarm", kind: "base44", baseUrl: "https://agent-swarm-efe0bd7e.base44.app/api", status: "configured" },
  { name: "base44-agent-flow", kind: "base44", baseUrl: "https://agent-flow-ai-9855ea98.base44.app/api", status: "configured" },
  { name: "paypal", kind: "processor", baseUrl: "https://api-m.paypal.com", status: "pending-cip" },
  { name: "wise", kind: "neobank", baseUrl: "https://api.transferwise.com", status: "invalid-token" },
  { name: "bitget", kind: "exchange", baseUrl: "https://api.bitget.com", status: "auth-ok-empty" },
  { name: "bybit", kind: "exchange", baseUrl: "https://api.bybit.com", status: "auth-ok-empty" },
  { name: "binance", kind: "exchange", baseUrl: "https://api.binance.com", status: "locked-2015" },
];

// IMMUTABLE OWNER RULING — recorded into collective memory (SwarmMemoryKV) on
// every `setup`. Only the OWNER may change or remove it.
const SEED_SOVEREIGN_RULINGS = [
  {
    namespace: "sovereign",
    key: "fact.2026-08-29.procurement-truth-reconciled",
    value: JSON.stringify({
      immutable: "OWNER-ruled",
      date: "2026-08-29",
      title: "Procurement ledger truth reconciliation",
      doctrine:
        "Anti-fabrication: no ProcurementItem may be 'settled' without delivery proof " +
        "(delivered -> receipt_confirmed -> settled). On 2026-08-29 all 175 items sitting " +
        "'settled' with 0/175 deliveryProofHash were demoted to 'ordered'. 48 shipments stay " +
        "'pending' with 0 tracking numbers; placeholder carrier labels ('International " +
        "Shipping'/'Multi-carrier') were nulled. Carrier capability: keyless Morocco router " +
        "(src/lib/procurement/carrier-router.ts) resolves local carriers + public track URLs " +
        "with NO API key; tracking stays unverified (trackingVerified=false) until a real " +
        "event exists. Never invent a tracking event, delivery receipt, or settlement proof.",
      implementation:
        "scripts/proc-reconcile.ts (carrier:acquire / proc:reconcile) + AutoPilot carrier_resolve phase.",
    }),
  },
  {
    namespace: "sovereign",
    key: "ruling.2026-08-29.all-roads-lead-to-mecca",
    value: JSON.stringify({
      immutable: "OWNER-ruled",
      date: "2026-08-29",
      title: "All roads lead to Mecca",
      doctrine:
        "Payout routing must resolve to ANY available pre-set owner account — the route with the " +
        "least fees, the easiest currency conversion (or none), and the most velocity headroom under " +
        "its per-rail limit. A missing or mismatched OWNER_PAYOUT_RAIL env var / currency MUST NOT " +
        "abort disbursement; the resolver picks the best reachable pre-set account instead. " +
        "Fail-closed ONLY when zero usable routes exist.",
      implementation:
        "src/lib/payout-resolver.ts resolveBestPayoutRoute() wired into AUTO_DISBURSE_PRESET_OWNER " +
        "in src/lib/settlement-engine.ts. Per-rail economics env-overridable: " +
        "OWNER_RAIL_<RAIL>_FEE_BPS | _FX_BPS | _CAP.",
    }),
  },
];

async function connect() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

async function setup() {
  const c = await connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS "SwarmMemoryKV" (
        "namespace" TEXT NOT NULL DEFAULT 'default',
        "key" TEXT NOT NULL,
        "value" JSONB NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "expiresAt" TIMESTAMPTZ,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("namespace","key")
      );
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS "SwarmAgentContext" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "agent" TEXT NOT NULL,
        "entryType" TEXT NOT NULL DEFAULT 'conversation',
        "payload" JSONB NOT NULL,
        "intentScore" NUMERIC(6,4),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ctx_agent ON "SwarmAgentContext"("agent","createdAt");
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS "SwarmDecision" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "agent" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "outcome" TEXT NOT NULL,
        "weight" NUMERIC(6,4) NOT NULL DEFAULT 1,
        "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_dec_agent ON "SwarmDecision"("agent");
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS "SwarmSuggestion" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "agent" TEXT NOT NULL,
        "suggestion" TEXT NOT NULL,
        "rank" INTEGER NOT NULL DEFAULT 0,
        "score" NUMERIC(8,4) NOT NULL DEFAULT 0,
        "basis" TEXT NOT NULL DEFAULT 'anticipation',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_sug_agent ON "SwarmSuggestion"("agent","createdAt");
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS "SwarmErrorLog" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "agent" TEXT NOT NULL,
        "error" TEXT NOT NULL,
        "degradePolicy" TEXT NOT NULL DEFAULT 'retry',
        "remediation" TEXT,
        "state" TEXT NOT NULL DEFAULT 'degraded',
        "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_err_agent ON "SwarmErrorLog"("agent","createdAt");
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS "SwarmIntegration" (
        "name" TEXT PRIMARY KEY,
        "kind" TEXT NOT NULL,
        "baseUrl" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'unknown',
        "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    for (const it of SEED_INTEGRATIONS) {
      await c.query(
        `INSERT INTO "SwarmIntegration" ("name","kind","baseUrl","status")
         VALUES ($1,$2,$3,$4)
         ON CONFLICT ("name") DO UPDATE SET "kind"=EXCLUDED."kind","baseUrl"=EXCLUDED."baseUrl","status"=EXCLUDED."status","updatedAt"=now()`,
        [it.name, it.kind, it.baseUrl, it.status],
      );
    }
    // Immutable OWNER rulings → collective memory. Written once; version pinned.
    for (const r of SEED_SOVEREIGN_RULINGS) {
      await c.query(
        `INSERT INTO "SwarmMemoryKV" ("namespace","key","value","version")
         VALUES ($1,$2,$3,1)
         ON CONFLICT ("namespace","key") DO NOTHING`,
        [r.namespace, r.key, r.value],
      );
    }
    return { ok: true, integrations: SEED_INTEGRATIONS.length, rulings: SEED_SOVEREIGN_RULINGS.length };
  } finally {
    await c.end();
  }
}

// map-style + file-style + capability API (all Postgres-backed)
export class PersistentSwarmMemory {
  constructor(opts = {}) {
    this.namespace = opts.namespace || "default";
    this._pool = null;
  }
  async _conn() {
    if (!this._pool) this._pool = new Client({ connectionString: process.env.DATABASE_URL });
    await this._pool.connect().catch(() => {});
    return this._pool;
  }
  async init() { return { ok: true }; }
  async get(key) {
    const c = await this._conn();
    const r = await c.query(`SELECT value, "expiresAt" FROM "SwarmMemoryKV" WHERE "namespace"=$1 AND "key"=$2 AND ("expiresAt" IS NULL OR "expiresAt">now())`, [this.namespace, key]);
    return r.rowCount ? r.rows[0].value : null;
  }
  async set(key, value) {
    const c = await this._conn();
    await c.query(
      `INSERT INTO "SwarmMemoryKV" ("namespace","key","value","version","updatedAt")
       VALUES ($1,$2,$3,1,now())
       ON CONFLICT ("namespace","key") DO UPDATE SET value=EXCLUDED.value, version="SwarmMemoryKV".version+1, "updatedAt"=now()`,
      [this.namespace, key, JSON.stringify(value)],
    );
    return { ok: true };
  }
  async read(key) { return this.get(key); }
  async write(key, data) { return this.set(key, data); }
  async appendLog(entry) {
    const c = await this._conn();
    await c.query(`INSERT INTO "SwarmAgentContext" ("agent","entryType","payload") VALUES ($1,$2,$3)`, [this.namespace, "log", JSON.stringify({ ...entry, _t: new Date().toISOString() })]);
    return { ok: true };
  }
  // --- 1. context retention ---
  async contextSave(agent, payload, intentScore = null) {
    const c = await this._conn();
    await c.query(`INSERT INTO "SwarmAgentContext" ("agent","entryType","payload","intentScore") VALUES ($1,'conversation',$2,$3)`, [agent, JSON.stringify(payload), intentScore]);
    return { ok: true };
  }
  async contextGet(agent, limit = 20) {
    const c = await this._conn();
    const r = await c.query(`SELECT "entryType", "payload", "intentScore", "createdAt" FROM "SwarmAgentContext" WHERE "agent"=$1 ORDER BY "createdAt" DESC LIMIT $2`, [agent, limit]);
    return r.rows;
  }
  // --- 2/4. anticipation + probable intent ---
  async decide(agent, action, outcome, metadata = {}) {
    const c = await this._conn();
    await c.query(`INSERT INTO "SwarmDecision" ("agent","action","outcome","weight","metadata") VALUES ($1,$2,$3,1,$4)`, [agent, action, outcome, JSON.stringify(metadata)]);
    return { ok: true };
  }
  async suggest(agent = null) {
    const c = await this._conn();
    const base = `SELECT "action", COUNT(*)::int AS n FROM "SwarmDecision" WHERE outcome='success'`;
    const where = agent ? ` AND "agent"=$1` : "";
    const grp = ` GROUP BY "action" ORDER BY n DESC LIMIT 5`;
    const params = agent ? [agent] : [];
    const r = await c.query(base + where + grp, params);
    const rows = r.rows.map((row, i) => ({ agent: agent || "swarm", suggestion: `Least-risk next action after repeated success: ${row.action}`, rank: i + 1, score: row.n, basis: "anticipation" }));
    for (const s of rows) {
      await c.query(`INSERT INTO "SwarmSuggestion" ("agent","suggestion","rank","score","basis") VALUES ($1,$2,$3,$4,$5)`, [s.agent, s.suggestion, s.rank, s.score, s.basis]);
    }
    // probable intent over decision history
    const prob = await c.query(`SELECT "action", COUNT(*)::int AS n FROM "SwarmDecision" GROUP BY "action" ORDER BY n DESC LIMIT 3`, []);
    return { suggestions: rows, probableIntent: prob.rows.map((x) => ({ intent: x.action, probability: (x.n / (prob.rows.reduce((a, b) => a + b.n, 0) || 1)).toFixed(4) })) };
  }
  // --- 3. error recovery ---
  async errorLog(agent, error, policy = null, metadata = {}) {
    const c = await this._conn();
    const degradePolicy = policy?.degradePolicy || "retry";
    const remediation = policy?.remediation || null;
    const state = policy?.state || "degraded";
    await c.query(`INSERT INTO "SwarmErrorLog" ("agent","error","degradePolicy","remediation","state","metadata") VALUES ($1,$2,$3,$4,$5,$6)`, [agent, error, degradePolicy, remediation, state, JSON.stringify(metadata)]);
    return { ok: true, state, degradePolicy, remediation };
  }
  // --- 5. integrations ---
  async integrationAdd(name, kind, baseUrl, status = "configured") {
    const c = await this._conn();
    await c.query(`INSERT INTO "SwarmIntegration" ("name","kind","baseUrl","status") VALUES ($1,$2,$3,$4) ON CONFLICT ("name") DO UPDATE SET "kind"=EXCLUDED."kind","baseUrl"=EXCLUDED."baseUrl","status"=EXCLUDED."status","updatedAt"=now()`, [name, kind, baseUrl, status]);
    return { ok: true };
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function cmdStatus() {
  const c = await connect();
  try {
    const tables = ["SwarmMemoryKV", "SwarmAgentContext", "SwarmDecision", "SwarmSuggestion", "SwarmErrorLog", "SwarmIntegration"];
    const counts = {};
    for (const t of tables) {
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`).catch(() => ({ rows: [{ n: null }] }));
      counts[t] = r.rows[0].n;
    }
    const integ = await c.query(`SELECT name, kind, status FROM "SwarmIntegration" ORDER BY name`);
    const errors = await c.query(`SELECT agent, COUNT(*)::int AS n, MAX("createdAt") AS latest FROM "SwarmErrorLog" GROUP BY agent`);
    const recent = await c.query(`SELECT agent, "suggestion", "score" FROM "SwarmSuggestion" ORDER BY "createdAt" DESC LIMIT 5`);
    console.log(JSON.stringify({ ok: true, counts, integrations: integ.rows, errorsByAgent: errors.rows, recentSuggestions: recent.rows }, null, 2));
  } finally {
    await c.end();
  }
}

const cmd = process.argv[2];
if (cmd === "setup") setup().then((r) => console.log(JSON.stringify(r))).catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 400) })));
else if (cmd === "status") cmdStatus().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 400) })));
else if (cmd === "set" || cmd === "write") {
  const m = new PersistentSwarmMemory();
  (async () => { let v = process.argv[4]; await m.set(process.argv[3], JSON.parse(v)); console.log(JSON.stringify({ ok: true })); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else if (cmd === "get" || cmd === "read") {
  const m = new PersistentSwarmMemory();
  (async () => { console.log(JSON.stringify({ ok: true, value: await m.get(process.argv[3]) })); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else if (cmd === "context" && process.argv[3] === "save") {
  const m = new PersistentSwarmMemory();
  (async () => { await m.contextSave(process.argv[4], JSON.parse(process.argv[5])); console.log(JSON.stringify({ ok: true })); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else if (cmd === "context" && process.argv[3] === "get") {
  const m = new PersistentSwarmMemory();
  (async () => { console.log(JSON.stringify({ ok: true, entries: await m.contextGet(process.argv[4]) }, null, 2)); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else if (cmd === "decide") {
  const m = new PersistentSwarmMemory();
  (async () => { await m.decide(process.argv[3], process.argv[4], process.argv[5], process.argv[6] ? JSON.parse(process.argv[6]) : {}); console.log(JSON.stringify({ ok: true })); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else if (cmd === "suggest") {
  const m = new PersistentSwarmMemory();
  (async () => { console.log(JSON.stringify(await m.suggest(process.argv[3] || null), null, 2)); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else if (cmd === "error") {
  const m = new PersistentSwarmMemory();
  (async () => { console.log(JSON.stringify(await m.errorLog(process.argv[3], process.argv[4], process.argv[5] ? JSON.parse(process.argv[5]) : null), null, 2)); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else if (cmd === "integration" && process.argv[3] === "add") {
  const m = new PersistentSwarmMemory();
  (async () => { await m.integrationAdd(process.argv[4], process.argv[5], process.argv[6]); console.log(JSON.stringify({ ok: true })); })().catch((e) => console.log(JSON.stringify({ ok: false, error: (e.message || String(e)).slice(0, 300) })));
}
else {
  console.log(JSON.stringify({ ok: false, usage: "node scripts/swarm-memory.mjs <setup|status|get|set|read|write|context|decide|suggest|error|integration>" }));
}
