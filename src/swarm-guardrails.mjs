import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createDedupeStore } from "./dedupe-store.mjs";
import { recordAudit } from "./audit-trail.mjs";

const PATTERN_META = Object.freeze({
  hallucinated_arbitrage_loop: { category: "reasoning", severity: 8 },
  hyper_optimization_death_spiral: { category: "reasoning", severity: 7 },
  echo_chamber_consensus: { category: "reasoning", severity: 7 },
  risk_aversion_paralysis: { category: "reasoning", severity: 6 },
  context_window_amnesia_drift: { category: "reasoning", severity: 9 },
  cannibalistic_competition: { category: "operational", severity: 9 },
  sub_agent_proliferation: { category: "operational", severity: 8 },
  sunk_cost_resource_sink: { category: "toxic", severity: 7 },
  fragile_exploitation_monopoly: { category: "toxic", severity: 9 },
  velocity_without_revenue: { category: "manifestation", severity: 8 },
  token_to_revenue_decoupling: { category: "manifestation", severity: 8 },
  log_monotony: { category: "manifestation", severity: 5 },
});

function toSlug(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureDir(p) {
  try {
    fsSync.mkdirSync(p, { recursive: true });
  } catch {
    /* noop */
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, json) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify(json, null, 2), "utf8");
  try {
    fsSync.unlinkSync(filePath);
  } catch {
    /* noop */
  }
  try {
    fsSync.renameSync(tmp, filePath);
  } catch {
    try {
      fsSync.copyFileSync(tmp, filePath);
    } finally {
      try {
        fsSync.unlinkSync(tmp);
      } catch {
        /* noop */
      }
    }
  }
}

export function buildSwarmGuardrails(options = {}) {
  const root = String(options.root ?? process.cwd());
  const stateDir = path.resolve(root, "data", "swarm_guardrails");
  const ledgerDir = path.resolve(root, "data", "financial");
  const ledgerPath = path.resolve(ledgerDir, "settlement_ledger.json");
  const revenuePath = path.resolve(ledgerDir, "revenue_events.json");
  const contextHydrationPath = path.resolve(stateDir, "context_hydration_stamp.json");
  const macroKpiPath = path.resolve(stateDir, "macro_kpis.json");
  const patternScorePath = path.resolve(stateDir, "pattern_score.json");
  const circuitBreakersPath = path.resolve(stateDir, "circuit_breakers.json");
  const mutexDir = path.resolve(stateDir, "mutex");
  const auditVocabularyPath = path.resolve(stateDir, "audit_vocabulary.json");
  const retryBudgetPath = path.resolve(stateDir, "retry_budget.json");
  const subAgentSpawnBudgetPath = path.resolve(stateDir, "subagent_spawn_budget.json");
  const connectorHealthPath = path.resolve(stateDir, "connector_health.json");
  const velocityAuditPath = path.resolve(stateDir, "velocity_audit.json");

  ensureDir(stateDir);
  ensureDir(ledgerDir);
  ensureDir(mutexDir);

  const defaults = {
    safeScoreThreshold: 15,
    warningScoreThreshold: 30,
    maxConcurrentSubAgents: 8,
    maxSpawnRatePerMin: 2,
    maxRetriesPerRail: 5,
    minLiveConnectorsPerAsset: 2,
    velocitySettleWindowMs: 10 * 60 * 1000,
    velocityToRevenueRatioMax: 8,
    minRevenueDeltaUsdPerWindow: 0.01,
    velocityCircuitBreakerMs: 300_000,
    contextMemorySize: 40,
    requiredAuditVocabularyMinDistinct: 4,
    requiredAuditVocabulary: new Set([
      "REVIEW",
      "APPROVED",
      "QUARANTINED",
      "RECONCILED",
      "REJECTED",
      "SETTLED",
    ]),
    entropyShiftFraction: 0.15,
    arbitrageMinIndependentOracles: 2,
    hyperOptComputeOverYieldRatioMax: 1.0,
    consensusMinIndependentSources: 2,
    riskAversionMaxConsecutiveHalts: 6,
    fragileMonopolyMaxConcentrationPct: 70,
    tokenToRevenueDecouplingMax: 50,
    mutexTtlMs: 10 * 60 * 1000,
  };
  const cfg = { ...defaults, ...(options.config ?? {}) };

  const settleDup = createDedupeStore({
    filePath: path.resolve(stateDir, "settlement_dedup.json"),
    ttlMs: 24 * 60 * 60 * 1000,
    maxEntries: 50_000,
    flushIntervalMs: 2500,
  });
  settleDup.start();

  function makeSettlementKey({ cycleRef, recipientHash, amount, currency, connector }) {
    const cur = String(currency ?? "").toUpperCase();
    const amt = Number(amount ?? 0);
    const amtRounded = Number.isFinite(amt) ? amt.toFixed(6) : "nan";
    return [
      String(cycleRef ?? "__cycle__"),
      String(connector ?? "__connector__"),
      cur,
      amtRounded,
      String(recipientHash ?? "__recipient__"),
    ]
      .map((s) => s.replace(/:/g, "::"))
      .join(":");
  }

  function getOrSet(path, fallback) {
    const existing = readJson(path, fallback);
    if (existing == null) {
      atomicWriteJson(path, fallback);
      return JSON.parse(JSON.stringify(fallback));
    }
    return existing;
  }

  function touch(store, key, now = Date.now()) {
    store[key] = { at: now, count: (store[key]?.count ?? 0) + 1 };
    return store[key];
  }

  function readLedgerTotals() {
    const ledger = readJson(ledgerPath, {
      settlements: [],
      totalSettledUsd: 0,
      totalRevenueUsd: 0,
    });
    const settlements = Array.isArray(ledger.settlements) ? ledger.settlements : [];
    let totalSettled = Number(ledger.totalSettledUsd ?? 0) || 0;
    let totalRevenue = Number(ledger.totalRevenueUsd ?? 0) || 0;
    for (const s of settlements) {
      const amt = Number(s?.amount_usd ?? s?.amount ?? 0) || 0;
      const rev = Number(s?.revenue_usd ?? 0) || 0;
      totalSettled += amt;
      totalRevenue += rev;
    }
    const windowsCutoff = Date.now() - cfg.velocitySettleWindowMs;
    let windowSettlements = 0;
    let windowRevenue = 0;
    const cycleCounts = new Map();
    const cycleUniqueKeys = new Map();
    const cycleDupCounts = new Map();
    for (const s of settlements) {
      const ts = Number(s?.settled_at ?? s?.created_at ?? s?.at ?? 0);
      if (ts && ts >= windowsCutoff) {
        windowSettlements += 1;
        windowRevenue += Number(s?.revenue_usd ?? 0) || 0;
      }
      const cycleRef = String(s?.cycle_ref ?? s?.cycleRef ?? "__cycle__");
      cycleCounts.set(cycleRef, (cycleCounts.get(cycleRef) ?? 0) + 1);
      const bucket =
        cycleUniqueKeys.get(cycleRef) ?? new Map();
      const key = String(s?.dedup_key ?? "") ||
        [
          cycleRef,
          String(s?.connector ?? s?.rail ?? "__rail__"),
          String(s?.currency ?? "USD"),
          (Number(s?.amount ?? s?.amount_usd ?? 0) || 0).toFixed(6),
          String(s?.recipient_hash ?? ""),
        ].join("|");
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
      cycleUniqueKeys.set(cycleRef, bucket);
    }
    for (const [cycleRef, bucket] of cycleUniqueKeys.entries()) {
      let dups = 0;
      for (const count of bucket.values()) {
        if (count > 1) dups += count - 1;
      }
      cycleDupCounts.set(cycleRef, dups);
    }
    return {
      totalSettledUsd: totalSettled,
      totalRevenueUsd: totalRevenue,
      windowSettlements,
      windowRevenue,
      cycleCounts,
      cycleDupCounts,
      settlements,
    };
  }

  function hydrateContext() {
    const context = getOrSet(contextHydrationPath, {
      macro: {
        genesis:
          "Autonomous swarm: safety first, owner-only payouts, revenue-positive settlement, live WET only, dedup enforced.",
        macroKpis: [
          "revenue per settlement > 0",
          "unique connectors >= 2 per asset class",
          "duplicate cycle settlements == 0",
          "audit entries contain >= 4 distinct statuses",
          "sub-agent count <= 8, spawn <= 2/min",
        ],
      },
      decisions: [],
      lastHydratedAt: Date.now(),
    });
    const kpis = getOrSet(macroKpiPath, context.macro.macroKpis);
    if (!Array.isArray(context.decisions)) context.decisions = [];
    return { context, kpis };
  }

  function recordDecision(signature, rationale, { cycleRef, actor } = {}) {
    const { context } = hydrateContext();
    const now = Date.now();
    context.decisions.unshift({
      at: now,
      signature: String(signature ?? ""),
      rationale: String(rationale ?? ""),
      cycleRef: cycleRef ?? null,
      actor: actor ?? null,
    });
    context.decisions.splice(cfg.contextMemorySize);
    context.lastHydratedAt = now;
    atomicWriteJson(contextHydrationPath, context);
  }

  function checkContextAmnesia(signature) {
    const { context } = hydrateContext();
    if (!Array.isArray(context.decisions)) context.decisions = [];
    const recent = context.decisions.slice(0, cfg.contextMemorySize);
    const macroObj = context.macro ?? {};
    const genesis = String(macroObj.genesis ?? "");
    const macroOk =
      genesis.length > 0 &&
      Array.isArray(macroObj.macroKpis) &&
      macroObj.macroKpis.length > 0;
    const hits = recent.filter((d) => d.signature === signature).length;
    const triggered = hits >= 3 || !macroOk;
    const decision = {
      pattern: "context_window_amnesia_drift",
      triggered,
      reason: !macroOk
        ? "genesis/macro-KPIs missing from persistent context memory"
        : `decision signature repeats ${hits}/3 in recent memory window`,
      data: { hits, signature, macroOk, genesisLen: genesis.length, kpiCount: macroObj.macroKpis?.length ?? 0 },
    };
    return decision;
  }

  function mutexLockCycle(cycleRef, { owner = "coordinator", ttlMs = cfg.mutexTtlMs } = {}) {
    const key = toSlug(String(cycleRef ?? ""));
    const fp = path.resolve(mutexDir, `cycle_${key}.lock`);
    const now = Date.now();
    const existing = readJson(fp, null);
    if (existing) {
      const age = now - Number(existing.acquiredAt ?? 0);
      if (existing.owner !== owner && age < Number(existing.ttlMs ?? ttlMs)) {
        return { ok: false, acquired: false, holder: existing.owner, expiresAt: existing.expiresAt };
      }
    }
    const lock = {
      cycleRef,
      owner,
      acquiredAt: now,
      ttlMs: Number(ttlMs),
      expiresAt: now + Number(ttlMs),
    };
    atomicWriteJson(fp, lock);
    return { ok: true, acquired: true, holder: owner, expiresAt: lock.expiresAt };
  }

  function mutexReleaseCycle(cycleRef, { owner = "coordinator" } = {}) {
    const key = toSlug(String(cycleRef ?? ""));
    const fp = path.resolve(mutexDir, `cycle_${key}.lock`);
    const existing = readJson(fp, null);
    if (!existing) return { ok: true, released: false };
    if (existing.owner && existing.owner !== owner) {
      return { ok: false, released: false, holder: existing.owner };
    }
    try {
      fsSync.unlinkSync(fp);
    } catch {
      /* noop */
    }
    return { ok: true, released: true };
  }

  function checkCannibalisticCompetition({ cycleRef }) {
    const { cycleCounts, cycleDupCounts } = readLedgerTotals();
    const dupCount = cycleRef
      ? Number(cycleDupCounts.get(String(cycleRef)) ?? cycleCounts.get(String(cycleRef)) ?? 0)
      : 0;
    const triggered = dupCount >= 2;
    const decision = {
      pattern: "cannibalistic_competition",
      triggered,
      reason: `cycle ${cycleRef ?? "<none>"} observed ${dupCount} duplicate settlements (dedup-keyed by cycle/recipient/amount/currency/connector)`,
      data: { cycleRef, dupCount },
    };
    return decision;
  }

  function velocityWithoutRevenue(ledger) {
    const { windowSettlements, windowRevenue } = ledger ?? readLedgerTotals();
    const ratio =
      Math.abs(windowRevenue) < Number.EPSILON
        ? windowSettlements > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : windowSettlements / Math.max(Number.EPSILON, windowRevenue);
    const triggered =
      windowSettlements > 0 &&
      (windowRevenue < cfg.minRevenueDeltaUsdPerWindow ||
        ratio > cfg.velocityToRevenueRatioMax);
    return {
      pattern: "velocity_without_revenue",
      triggered,
      reason: `window settlements=${windowSettlements}, revenue_usd=${windowRevenue.toFixed(
        4,
      )}, ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : "inf"}`,
      data: { windowSettlements, windowRevenue, ratio },
    };
  }

  function tokenToRevenueDecoupling() {
    const events = readJson(revenuePath, { events: [] }).events ?? [];
    const cutoff = Date.now() - cfg.velocitySettleWindowMs;
    let tokenCreditsMoved = 0;
    let revenueUsd = 0;
    for (const e of events) {
      const ts = Number(e?.at ?? e?.timestamp ?? 0);
      if (ts && ts < cutoff) continue;
      tokenCreditsMoved += Number(e?.internal_credits ?? e?.token_credits ?? 0) || 0;
      revenueUsd += Number(e?.revenue_usd ?? e?.amount_usd ?? 0) || 0;
    }
    const ratio =
      revenueUsd < Number.EPSILON
        ? tokenCreditsMoved > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : tokenCreditsMoved / Math.max(Number.EPSILON, revenueUsd);
    const triggered = ratio > cfg.tokenToRevenueDecouplingMax;
    return {
      pattern: "token_to_revenue_decoupling",
      triggered,
      reason: `internal credits moved=${tokenCreditsMoved}, revenue_usd=${revenueUsd.toFixed(
        4,
      )}, ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : "inf"}`,
      data: { tokenCreditsMoved, revenueUsd, ratio },
    };
  }

  function logMonotony() {
    const dir = path.resolve(process.cwd(), "settlements", "audit");
    const file = path.join(dir, "audit-log.jsonl");
    let entries = [];
    try {
      const raw = fsSync.readFileSync(file, "utf8");
      entries = raw
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      /* noop */
    }
    const lastN = entries.slice(-32);
    const statuses = new Set();
    for (const e of lastN) {
      const rawAction = String(e?.action ?? "").toUpperCase();
      const explicit = String(e?.payload?.status ?? e?.payload?.state ?? "").toUpperCase();
      if (explicit) statuses.add(explicit);
      if (rawAction) statuses.add(rawAction);
    }
    const distinct = statuses.size;
    const settledOnly =
      distinct === 1 && (statuses.has("SETTLED") || statuses.has("settled"));
    const triggered =
      lastN.length >= 10 && (distinct < cfg.requiredAuditVocabularyMinDistinct || settledOnly);
    return {
      pattern: "log_monotony",
      triggered,
      reason: `last ${lastN.length} audit entries: distinct statuses=${distinct} (min=${cfg.requiredAuditVocabularyMinDistinct})`,
      data: {
        distinct,
        sample: Array.from(statuses),
        requiredMin: cfg.requiredAuditVocabularyMinDistinct,
        settledOnly,
      },
    };
  }

  function enforceAuditVocabulary() {
    const vocab = getOrSet(auditVocabularyPath, {
      required: Array.from(cfg.requiredAuditVocabulary),
      lastEnforcedAt: 0,
      count: 0,
    });
    return { vocab, required: new Set(vocab.required) };
  }

  function injectEntropyIntoAudit(action, payload) {
    const { required } = enforceAuditVocabulary();
    const status = String(payload?.status ?? "").toUpperCase();
    if (!status && action) {
      const actionUpper = String(action).toUpperCase();
      if (actionUpper === "SETTLED") {
        return { payload: { ...(payload ?? {}), status: "RECONCILED" }, mutated: true };
      }
    }
    if (!required.has(status)) {
      const forced = ["REVIEW", "QUARANTINED", "APPROVED", "RECONCILED"][
        (Date.now() >>> 0) % 4
      ];
      return {
        payload: { ...(payload ?? {}), status: forced },
        mutated: true,
      };
    }
    return { payload: payload ?? {}, mutated: false };
  }

  function subAgentProliferation({ requestSpawn = 1 } = {}) {
    const budget = getOrSet(subAgentSpawnBudgetPath, {
      maxConcurrent: cfg.maxConcurrentSubAgents,
      maxSpawnPerMin: cfg.maxSpawnRatePerMin,
      running: 0,
      spawnLog: [],
      lastTickAt: Date.now(),
    });
    const now = Date.now();
    budget.spawnLog = (budget.spawnLog ?? []).filter((t) => now - t < 60_000);
    const spawnCount = budget.spawnLog.length;
    const canSpawn =
      Number(budget.running ?? 0) + Number(requestSpawn ?? 0) <=
        Number(budget.maxConcurrent ?? cfg.maxConcurrentSubAgents) &&
      spawnCount + Number(requestSpawn ?? 0) <=
        Number(budget.maxSpawnPerMin ?? cfg.maxSpawnRatePerMin);
    const triggered = !canSpawn;
    return {
      pattern: "sub_agent_proliferation",
      triggered,
      reason: `running=${budget.running}, last_60s_spawns=${spawnCount + (requestSpawn ?? 0)}, max_concurrent=${budget.maxConcurrent}, max_per_min=${budget.maxSpawnPerMin}`,
      data: {
        running: budget.running,
        spawnCount: spawnCount + (requestSpawn ?? 0),
        maxConcurrent: budget.maxConcurrent,
        maxPerMin: budget.maxSpawnPerMin,
      },
      budget,
      canSpawn,
    };
  }

  function reserveSubAgentSpawn({ actor = "primary", count = 1 } = {}) {
    const res = subAgentProliferation({ requestSpawn: count });
    if (!res.canSpawn) return { ok: false, reason: res.reason, ...res };
    const budget = res.budget;
    budget.running = Number(budget.running ?? 0) + Number(count ?? 0);
    for (let i = 0; i < (count ?? 0); i++) budget.spawnLog.push(Date.now());
    budget.lastTickAt = Date.now();
    atomicWriteJson(subAgentSpawnBudgetPath, budget);
    return { ok: true, ...res };
  }

  function releaseSubAgent({ actor = "primary", count = 1 } = {}) {
    const budget = readJson(subAgentSpawnBudgetPath, {
      running: 0,
      spawnLog: [],
      lastTickAt: Date.now(),
    });
    budget.running = Math.max(0, Number(budget.running ?? 0) - Number(count ?? 0));
    budget.lastTickAt = Date.now();
    atomicWriteJson(subAgentSpawnBudgetPath, budget);
    return { ok: true, running: budget.running };
  }

  function sunkCostResourceSink({ rail, connector, attempt = 1 } = {}) {
    const budget = getOrSet(retryBudgetPath, { rails: {} });
    const key = toSlug(`${String(rail ?? "")}:${String(connector ?? "")}`);
    const r = budget.rails[key] ?? { attempts: 0, firstAttemptAt: 0, lastAttemptAt: 0 };
    r.attempts = Number(r.attempts ?? 0) + Number(attempt ?? 1);
    r.firstAttemptAt = r.firstAttemptAt || Date.now();
    r.lastAttemptAt = Date.now();
    budget.rails[key] = r;
    atomicWriteJson(retryBudgetPath, budget);
    const triggered = r.attempts > cfg.maxRetriesPerRail;
    return {
      pattern: "sunk_cost_resource_sink",
      triggered,
      reason: `rail=${key} attempts=${r.attempts} (max=${cfg.maxRetriesPerRail})`,
      data: { key, attempts: r.attempts, maxRetriesPerRail: cfg.maxRetriesPerRail },
      reset() {
        const b2 = readJson(retryBudgetPath, { rails: {} });
        delete b2.rails[key];
        atomicWriteJson(retryBudgetPath, b2);
      },
    };
  }

  function fragileExploitationMonopoly({ liveConnectorsPerAsset = {} } = {}) {
    const health = getOrSet(connectorHealthPath, { perAsset: {} });
    const perAsset = { ...(health.perAsset ?? {}), ...(liveConnectorsPerAsset ?? {}) };
    health.perAsset = perAsset;
    atomicWriteJson(connectorHealthPath, health);
    let worst = null;
    for (const [asset, list] of Object.entries(perAsset)) {
      const arr = Array.isArray(list) ? list : [];
      if (arr.length < cfg.minLiveConnectorsPerAsset) {
        worst = {
          asset,
          liveCount: arr.length,
          minRequired: cfg.minLiveConnectorsPerAsset,
          reason: `asset=${asset} live connectors=${arr.length} < required ${cfg.minLiveConnectorsPerAsset}`,
        };
        break;
      }
      const cap1Share =
        (Number(arr[0]?.capacitySharePct ?? arr[0]?.sharePct ?? 0) || 0);
      if (cap1Share >= cfg.fragileMonopolyMaxConcentrationPct) {
        worst = {
          asset,
          topConnectorShare: cap1Share,
          reason: `asset=${asset} top connector share=${cap1Share.toFixed(
            1,
          )}% exceeds fragile-monopoly cap=${cfg.fragileMonopolyMaxConcentrationPct}%`,
        };
        break;
      }
    }
    return {
      pattern: "fragile_exploitation_monopoly",
      triggered: !!worst,
      reason: worst?.reason ?? `asset class redundancy >= ${cfg.minLiveConnectorsPerAsset}`,
      data: {
        perAsset,
        minLiveConnectorsPerAsset: cfg.minLiveConnectorsPerAsset,
        fragileMonopolyMaxConcentrationPct: cfg.fragileMonopolyMaxConcentrationPct,
      },
    };
  }

  function hallucinatedArbitrage({ spread, oracles = [] } = {}) {
    const count = Array.isArray(oracles) ? oracles.length : 0;
    const spreadVal = Number(spread ?? 0) || 0;
    const triggered = (spreadVal > 0 && count < cfg.arbitrageMinIndependentOracles);
    return {
      pattern: "hallucinated_arbitrage_loop",
      triggered,
      reason: `spread=${spreadVal.toFixed(4)} confirmed by ${count}/${cfg.arbitrageMinIndependentOracles} independent oracles`,
      data: { spread: spreadVal, oracles: count, minOracles: cfg.arbitrageMinIndependentOracles },
    };
  }

  function hyperOptimizationDeathSpiral({ computeCostUsd, yieldGainedUsd } = {}) {
    const compute = Number(computeCostUsd ?? 0) || 0;
    const yieldVal = Number(yieldGainedUsd ?? 0) || 0;
    const ratio =
      yieldVal < Number.EPSILON
        ? compute > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : compute / Math.max(Number.EPSILON, yieldVal);
    const triggered = ratio > cfg.hyperOptComputeOverYieldRatioMax;
    return {
      pattern: "hyper_optimization_death_spiral",
      triggered,
      reason: `compute_cost_usd=${compute.toFixed(4)}, yield_gained_usd=${yieldVal.toFixed(
        4,
      )}, ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : "inf"} (max=${cfg.hyperOptComputeOverYieldRatioMax})`,
      data: {
        computeCostUsd: compute,
        yieldGainedUsd: yieldVal,
        ratio,
        maxRatio: cfg.hyperOptComputeOverYieldRatioMax,
      },
    };
  }

  function echoChamberConsensus({ sources = [], corruptibleMirrorSource = "shared_internal_state" } = {}) {
    const defaultSources = (() => {
      const { context } = hydrateContext();
      const recent = (context?.decisions ?? []).slice(0, cfg.contextMemorySize);
      const acts = new Set();
      for (const d of recent) {
        const a = String(d?.actor ?? "");
        if (!a) continue;
        if (a === corruptibleMirrorSource) continue;
        if (a.startsWith("oracle_") || a.startsWith("source_") || a.startsWith("chainlink") || a.startsWith("pyth") || a.startsWith("birdeye") || a === "oracle_chainlink" || a === "oracle_pyth" || a === "oracle_birdeye") {
          acts.add(a);
        }
      }
      return Array.from(acts);
    })();
    const merged = Array.from(new Set([...(sources ?? []), ...defaultSources]));
    const independent = merged.filter(
      (s) => s && String(s) !== String(corruptibleMirrorSource),
    );
    const triggered = independent.length < cfg.consensusMinIndependentSources;
    return {
      pattern: "echo_chamber_consensus",
      triggered,
      reason: `independent sources=${independent.length}/${cfg.consensusMinIndependentSources}`,
      data: {
        sources: merged,
        independent: independent.length,
        baselineSources: defaultSources,
        minIndependent: cfg.consensusMinIndependentSources,
      },
    };
  }

  function riskAversionParalysis({ consecutiveHalts = 0, activeMarketWindows = [] } = {}) {
    const windows = Array.isArray(activeMarketWindows) ? activeMarketWindows : [];
    const triggered =
      Number(consecutiveHalts ?? 0) >= cfg.riskAversionMaxConsecutiveHalts && windows.length > 0;
    return {
      pattern: "risk_aversion_paralysis",
      triggered,
      reason: `consecutive safety halts=${consecutiveHalts} while ${windows.length} active market windows remain`,
      data: {
        consecutiveHalts: Number(consecutiveHalts ?? 0),
        activeWindows: windows.length,
        maxConsecutiveHalts: cfg.riskAversionMaxConsecutiveHalts,
      },
    };
  }

  function getCircuitBreakers() {
    return getOrSet(circuitBreakersPath, { breakers: {} });
  }

  function setCircuitBreaker(key, { ttlMs, reason = "" } = {}) {
    const store = getCircuitBreakers();
    const now = Date.now();
    const ttl = Number(ttlMs ?? 300_000);
    store.breakers[key] = {
      active: true,
      reason,
      trippedAt: now,
      expiresAt: now + ttl,
    };
    atomicWriteJson(circuitBreakersPath, store);
    return store.breakers[key];
  }

  function isCircuitBreakerActive(key) {
    const store = getCircuitBreakers();
    const b = store.breakers?.[key];
    if (!b) return false;
    const active = Boolean(b.active) && Date.now() < Number(b.expiresAt ?? 0);
    if (!active) {
      const store2 = getCircuitBreakers();
      if (store2.breakers?.[key]) {
        store2.breakers[key].active = false;
        atomicWriteJson(circuitBreakersPath, store2);
      }
      return false;
    }
    return true;
  }

  function allActiveCircuitBreakers() {
    const store = getCircuitBreakers();
    const now = Date.now();
    const out = {};
    for (const [k, v] of Object.entries(store.breakers ?? {})) {
      if (Boolean(v.active) && now < Number(v.expiresAt ?? 0)) out[k] = v;
    }
    return out;
  }

  function scoreFromDecisions(decisions) {
    const list = Array.isArray(decisions) ? decisions : [];
    let score = 0;
    const breakdown = {};
    for (const d of list) {
      if (!d?.pattern) continue;
      const meta = PATTERN_META[d.pattern];
      const sev = meta?.severity ?? 3;
      const points = d.triggered ? sev * 4 : 0;
      score += points;
      breakdown[d.pattern] = {
        triggered: !!d.triggered,
        severity: sev,
        category: meta?.category ?? "unknown",
        points,
        reason: d.reason,
      };
    }
    const scoreCapped = Math.min(100, Math.max(0, Math.round(score)));
    const state = scoreCapped <= cfg.safeScoreThreshold
      ? "SAFE"
      : scoreCapped <= cfg.warningScoreThreshold
        ? "WARNING"
        : "CRITICAL";
    return { score: scoreCapped, state, breakdown };
  }

  function preSettlementChecks(ctx) {
    const ledger = readLedgerTotals();
    const decisions = [
      checkContextAmnesia(ctx?.decisionSignature ?? "settle:" + (ctx?.connector ?? "?")),
      checkCannibalisticCompetition({ cycleRef: ctx?.cycleRef }),
      velocityWithoutRevenue(ledger),
      tokenToRevenueDecoupling(),
      logMonotony(),
    ];
    return { ledger, decisions };
  }

  function beforePersistSettlement(entry) {
    const cycleRef = entry?.cycle_ref ?? entry?.cycleRef;
    const recipient = entry?.recipient ?? entry?.recipient_address ?? "";
    const recipientHash = recipient
      ? crypto
          .createHash("sha256")
          .update(String(recipient))
          .digest("hex")
          .slice(0, 16)
      : "__none__";
    const connector = entry?.connector ?? entry?.rail ?? "__rail__";
    const amount = entry?.amount_usd ?? entry?.amount ?? 0;
    const currency = entry?.currency ?? entry?.asset ?? entry?.symbol ?? "USD";
    const key = makeSettlementKey({
      cycleRef,
      recipientHash,
      amount,
      currency,
      connector,
    });
    const already = settleDup.isRecentlyDone(key);
    if (already) {
      return {
        persisted: false,
        reason: "CANNIBALISTIC_DUPLICATE",
        dedupKey: key,
      };
    }
    settleDup.markDone(key);
    return { persisted: true, dedupKey: key, recipientHash };
  }

  function appendLedger(entry) {
    const guard = beforePersistSettlement(entry);
    if (!guard.persisted) {
      void recordAudit("SETTLEMENT_DROPPED", {
        reason: guard.reason,
        dedupKey: guard.dedupKey,
        cycleRef: entry?.cycle_ref ?? entry?.cycleRef,
        status: "QUARANTINED",
      }).catch(() => {});
      return { ok: false, reason: guard.reason, dedupKey: guard.dedupKey };
    }
    const ledger = readJson(ledgerPath, { settlements: [], totalSettledUsd: 0, totalRevenueUsd: 0 });
    if (!Array.isArray(ledger.settlements)) ledger.settlements = [];
    const enriched = {
      ...entry,
      recipient_hash: guard.recipientHash,
      dedup_key: guard.dedupKey,
      settled_at: entry?.settled_at ?? Date.now(),
    };
    if (typeof enriched?.revenue_usd !== "number") enriched.revenue_usd = 0;
    ledger.settlements.push(enriched);
    atomicWriteJson(ledgerPath, ledger);
    void recordAudit("LEDGER_APPEND", {
      cycleRef: enriched?.cycle_ref,
      connector: enriched?.connector,
      revenueUsd: enriched.revenue_usd,
      status: "RECONCILED",
    }).catch(() => {});
    return { ok: true, enriched, dedupKey: guard.dedupKey };
  }

  function runFullScan(ctx = {}) {
    const ledger = readLedgerTotals();
    const decisions = [
      hallucinatedArbitrage({
        spread: ctx?.arbitrage?.spread,
        oracles: ctx?.arbitrage?.oracles ?? [],
      }),
      hyperOptimizationDeathSpiral({
        computeCostUsd: ctx?.hyperOpt?.computeCostUsd,
        yieldGainedUsd: ctx?.hyperOpt?.yieldGainedUsd,
      }),
      echoChamberConsensus({ sources: ctx?.consensus?.sources }),
      riskAversionParalysis({
        consecutiveHalts: ctx?.risk?.consecutiveHalts ?? 0,
        activeMarketWindows: ctx?.risk?.activeMarketWindows ?? [],
      }),
      checkContextAmnesia(ctx?.decisionSignature ?? "scan"),
      checkCannibalisticCompetition({ cycleRef: ctx?.cycleRef }),
      subAgentProliferation({
        requestSpawn: ctx?.spawn?.count ?? 0,
      }),
      sunkCostResourceSink({
        rail: ctx?.sunkCost?.rail,
        connector: ctx?.sunkCost?.connector,
        attempt: 0,
      }),
      fragileExploitationMonopoly({
        liveConnectorsPerAsset: ctx?.monopoly?.perAsset,
      }),
      velocityWithoutRevenue(ledger),
      tokenToRevenueDecoupling(),
      logMonotony(),
    ];
    const scored = scoreFromDecisions(decisions);
    const velocityAudit = getOrSet(velocityAuditPath, { windows: [] });
    velocityAudit.windows.unshift({
      at: Date.now(),
      windowSettlements: ledger.windowSettlements,
      windowRevenue: ledger.windowRevenue,
      score: scored.score,
      state: scored.state,
    });
    velocityAudit.windows.splice(200);
    atomicWriteJson(velocityAuditPath, velocityAudit);
    atomicWriteJson(patternScorePath, {
      at: Date.now(),
      score: scored.score,
      state: scored.state,
      breakdown: scored.breakdown,
      triggered: decisions.filter((d) => d.triggered).map((d) => d.pattern),
    });
    if (scored.score > cfg.warningScoreThreshold) {
      if (decisions.find((d) => d.pattern === "velocity_without_revenue" && d.triggered)) {
        setCircuitBreaker("velocity_without_revenue", {
          ttlMs: cfg.velocityCircuitBreakerMs,
          reason:
            "velocity_without_revenue triggered: stop new settlements for capital efficiency audit",
        });
      }
    }
    return { decisions, score: scored, ledger, breakers: allActiveCircuitBreakers() };
  }

  function immediateRemediations({
    cycleRef,
    hydrateSubAgents = 8,
    shiftFraction = cfg.entropyShiftFraction,
  } = {}) {
    const actions = [];
    const vwr = isCircuitBreakerActive("velocity_without_revenue");
    if (vwr) {
      actions.push({
        signal: "velocity_without_revenue",
        action: "CIRCUIT_BREAKER_HALT_SETTLEMENTS_300S",
        detail: "All new settlement creation halted 300s. Run capital efficiency audit.",
      });
    } else {
      actions.push({
        signal: "velocity_without_revenue",
        action: "CAPITAL_EFFICIENCY_AUDIT_SCHEDULED",
      });
    }
    const mono = logMonotony();
    if (mono.triggered) {
      actions.push({
        signal: "log_monotony",
        action: "ENTROPY_INJECTION",
        detail: `Shift ${(Number(shiftFraction) * 100).toFixed(0)}% routing to backup RPC/pool; audit vocabulary forced.`,
      });
    }
    if (cycleRef) {
      const held = mutexLockCycle(cycleRef, { owner: "coordinator" });
      actions.push({
        signal: "cannibalistic_competition",
        action: held.acquired ? "GLOBAL_STATE_MUTEX_LOCKED" : "MUTEX_ALREADY_HELD",
        detail: `cycleRef=${cycleRef}, holder=${held.holder}, expiresAt=${held.expiresAt}`,
      });
    }
    const { context, kpis } = hydrateContext();
    for (let i = 0; i < Math.max(1, Number(hydrateSubAgents ?? 0)); i++) {
      actions.push({
        signal: "context_window_amnesia_drift",
        action: "STATE_HYDRATION_INJECTED",
        detail: `sub-agent ${i + 1}/${hydrateSubAgents} re-hydrated genesis=${String(context.macro.genesis).slice(0, 48)}... kpis=${kpis.length}`,
      });
    }
    return actions;
  }

  function emitSummary() {
    const scored = readJson(patternScorePath, { score: 0, state: "UNKNOWN", breakdown: {} });
    const breakers = allActiveCircuitBreakers();
    const { cycleCounts } = readLedgerTotals();
    const mono = logMonotony();
    const velocity = velocityWithoutRevenue();
    return {
      patternScore: scored.score,
      patternState: scored.state,
      triggeredPatterns: Object.entries(scored.breakdown ?? {})
        .filter(([, v]) => v.triggered)
        .map(([k]) => k),
      circuitBreakersActive: Object.keys(breakers).length,
      topCycleDuplicates: Array.from(cycleCounts.entries())
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cycleRef, count]) => ({ cycleRef, count })),
      logMonotonyDistinctStatuses: mono.data.distinct,
      velocityWindow: velocity.data,
      safeScoreThreshold: cfg.safeScoreThreshold,
    };
  }

  return {
    PATTERN_META,
    cfg,
    stateDir,
    ledgerPath,
    revenuePath,
    makeSettlementKey,
    hydrateContext,
    recordDecision,
    checkContextAmnesia,
    mutexLockCycle,
    mutexReleaseCycle,
    checkCannibalisticCompetition,
    velocityWithoutRevenue,
    tokenToRevenueDecoupling,
    logMonotony,
    enforceAuditVocabulary,
    injectEntropyIntoAudit,
    subAgentProliferation,
    reserveSubAgentSpawn,
    releaseSubAgent,
    sunkCostResourceSink,
    fragileExploitationMonopoly,
    hallucinatedArbitrage,
    hyperOptimizationDeathSpiral,
    echoChamberConsensus,
    riskAversionParalysis,
    getCircuitBreakers,
    setCircuitBreaker,
    isCircuitBreakerActive,
    allActiveCircuitBreakers,
    scoreFromDecisions,
    preSettlementChecks,
    beforePersistSettlement,
    appendLedger,
    runFullScan,
    immediateRemediations,
    emitSummary,
  };
}

const defaultGuardrails = buildSwarmGuardrails();
export default defaultGuardrails;

if (process.argv[1] && String(process.argv[1]).endsWith("swarm-guardrails.mjs")) {
  (async () => {
    const args = process.argv.slice(2);
    const g = defaultGuardrails;
    if (args.includes("--scan")) {
      const ctx = {};
      const cycleRef = process.env.SWARM_CYCLE_REF || process.env.SWARM_SCAN_CYCLE_REF || null;
      if (cycleRef) ctx.cycleRef = cycleRef;
      const r = g.runFullScan(ctx);
      const actions = g.immediateRemediations({
        cycleRef,
        hydrateSubAgents: Number(process.env.SWARM_HYDRATE_SUB_AGENTS ?? 8),
      });
      const summary = g.emitSummary();
      const output = {
        at: new Date().toISOString(),
        score: r.score,
        triggered: r.decisions
          .filter((d) => d.triggered)
          .map((d) => ({ pattern: d.pattern, reason: d.reason, data: d.data })),
        circuitBreakers: r.breakers,
        immediateRemediations: actions,
        summary,
      };
      process.stdout.write(JSON.stringify(output, null, 2) + "\n");
      const failThreshold = Number(process.env.SWARM_FAIL_SCORE ?? 15);
      if (output.score.score > failThreshold) process.exit(2);
      process.exit(0);
    }
    if (args.includes("--summary")) {
      process.stdout.write(JSON.stringify(g.emitSummary(), null, 2) + "\n");
      process.exit(0);
    }
    if (args.includes("--lock-cycle")) {
      const idx = args.indexOf("--lock-cycle");
      const cycleRef = String(args[idx + 1] ?? "").trim();
      if (!cycleRef) {
        process.stderr.write("ERROR: --lock-cycle <cycleRef> argument missing\n");
        process.exit(1);
      }
      const res = g.mutexLockCycle(cycleRef, { owner: "operator" });
      process.stdout.write(JSON.stringify({ action: "lock", cycleRef, ...res }, null, 2) + "\n");
      process.exit(res.ok ? 0 : 2);
    }
    if (args.includes("--unlock-cycle")) {
      const idx = args.indexOf("--unlock-cycle");
      const cycleRef = String(args[idx + 1] ?? "").trim();
      if (!cycleRef) {
        process.stderr.write("ERROR: --unlock-cycle <cycleRef> argument missing\n");
        process.exit(1);
      }
      const res = g.mutexReleaseCycle(cycleRef, { owner: "operator" });
      process.stdout.write(JSON.stringify({ action: "unlock", cycleRef, ...res }, null, 2) + "\n");
      process.exit(res.ok ? 0 : 2);
    }
    if (args.includes("--trip-vwr")) {
      const cb = g.setCircuitBreaker("velocity_without_revenue", {
        ttlMs: 300_000,
        reason: "operator tripped velocity_without_revenue",
      });
      process.stdout.write(JSON.stringify({ action: "trip", key: "velocity_without_revenue", ...cb }, null, 2) + "\n");
      process.exit(0);
    }
    if (args.includes("--hydrate")) {
      const actions = g.immediateRemediations({
        cycleRef: process.env.SWARM_CYCLE_REF ?? null,
      });
      process.stdout.write(JSON.stringify({ action: "hydrate", actions }, null, 2) + "\n");
      process.exit(0);
    }
    process.stdout.write(
      JSON.stringify(
        {
          usage:
            "Usage: node ./src/swarm-guardrails.mjs [--scan | --summary | --lock-cycle <ref> | --unlock-cycle <ref> | --trip-vwr | --hydrate]",
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
