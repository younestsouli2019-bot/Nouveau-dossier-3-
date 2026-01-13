import fs from "node:fs/promises";
import path from "node:path";

function normalizePositiveInt(value, fallback, { min }) {
  const n = Number(value);
  if (!n || Number.isNaN(n) || n < min) return fallback;
  return Math.floor(n);
}

function pruneByTtl(map, { ttlMs, now }) {
  const cutoff = now() - ttlMs;
  for (const [k, at] of map) {
    if (typeof at !== "number" || at < cutoff) map.delete(k);
  }
}

function enforceMaxEntries(map, maxEntries) {
  while (map.size > maxEntries) {
    const firstKey = map.keys().next().value;
    if (firstKey == null) break;
    map.delete(firstKey);
  }
}

async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(filePath, json) {
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {}

  await fs.writeFile(tmp, json, "utf8");

  try {
    await fs.unlink(filePath);
  } catch {}

  try {
    await fs.rename(tmp, filePath);
  } catch {
    try {
      await fs.copyFile(tmp, filePath);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }
}

export function createDedupeStore({
  filePath = null,
  ttlMs = 1800000,
  maxEntries = 5000,
  flushIntervalMs = 5000,
  now = () => Date.now()
} = {}) {
  const enabled = typeof filePath === "string" && filePath.trim() !== "";
  const ttl = normalizePositiveInt(ttlMs, 1800000, { min: 1000 });
  const max = normalizePositiveInt(maxEntries, 5000, { min: 1 });
  const flushEvery = normalizePositiveInt(flushIntervalMs, 5000, { min: 250 });

  const map = new Map();
  let flushTimer = null;
  let flushScheduled = false;
  let flushChain = Promise.resolve();

  async function load() {
    if (!enabled) return;
    const exists = await fileExists(filePath);
    if (!exists) return;

    let raw;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return;
      throw e;
    }
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];

    const pairs = [];
    for (const it of items) {
      if (!Array.isArray(it) || it.length !== 2) continue;
      const [k, at] = it;
      if (typeof k !== "string" || !k) continue;
      if (typeof at !== "number" || Number.isNaN(at)) continue;
      pairs.push([k, at]);
    }

    pairs.sort((a, b) => a[1] - b[1]);
    for (const [k, at] of pairs) map.set(k, at);

    pruneByTtl(map, { ttlMs: ttl, now });
    enforceMaxEntries(map, max);
  }

  function isRecentlyDone(key) {
    if (!key) return false;
    const at = map.get(key);
    if (at == null) return false;
    if (now() - at <= ttl) return true;
    map.delete(key);
    return false;
  }

  function markDone(key) {
    if (!key) return;
    if (map.has(key)) map.delete(key);
    map.set(key, now());
    pruneByTtl(map, { ttlMs: ttl, now });
    enforceMaxEntries(map, max);
    scheduleFlush();
  }

  function snapshot() {
    pruneByTtl(map, { ttlMs: ttl, now });
    enforceMaxEntries(map, max);
    return { v: 1, items: Array.from(map.entries()) };
  }

  async function flush() {
    if (!enabled) return;
    const payload = snapshot();
    const json = JSON.stringify(payload);
    const run = () => atomicWriteJson(filePath, json);
    const p = flushChain.then(run, run);
    flushChain = p.catch(() => {});
    return p;
  }

  function scheduleFlush() {
    if (!enabled) return;
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(async () => {
      flushScheduled = false;
      try {
        await flush();
      } catch {}
    }, 0);
  }

  function start() {
    if (!enabled) return;
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      flush().catch(() => {});
    }, flushEvery);
    flushTimer.unref?.();
  }

  function stop() {
    if (!flushTimer) return;
    clearInterval(flushTimer);
    flushTimer = null;
  }

  function stats() {
    return { enabled, size: map.size, ttlMs: ttl, maxEntries: max, flushIntervalMs: flushEvery };
  }

  return { load, isRecentlyDone, markDone, flush, start, stop, stats };
}
