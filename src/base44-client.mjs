import { createClient } from "@base44/sdk";
import fs from "node:fs/promises";
import path from "node:path";

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getEnvBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function getOfflineStorePath() {
  const v = String(process.env.BASE44_OFFLINE_STORE_PATH ?? "").trim();
  return v || path.join(process.cwd(), ".base44-offline-store.json");
}

async function readJsonFile(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  return JSON.parse(txt);
}

async function atomicWriteText(filePath, text) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  try {
    await fs.rename(tmp, filePath);
  } catch {
    await fs.copyFile(tmp, filePath);
    await fs.unlink(tmp).catch(() => {});
  }
}

function selectFields(record, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return record;
  const out = {};
  for (const f of fields) {
    if (f in record) out[f] = record[f];
  }
  return out;
}

function parseSort(sort) {
  const s = String(sort ?? "").trim();
  if (!s) return { key: "created_date", dir: -1 };
  if (s.startsWith("-")) return { key: s.slice(1), dir: -1 };
  return { key: s, dir: 1 };
}

function sortRecords(records, sort) {
  const { key, dir } = parseSort(sort);
  return [...records].sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function matchesFilter(record, filter) {
  if (!filter || typeof filter !== "object") return true;
  for (const [k, v] of Object.entries(filter)) {
    const rv = record?.[k];
    if (Array.isArray(v)) {
      if (!v.some((x) => x === rv)) return false;
      continue;
    }
    if (rv !== v) return false;
  }
  return true;
}

function ensureEntityBucket(store, entityName) {
  if (!store.entities) store.entities = {};
  if (!store.entities[entityName]) {
    store.entities[entityName] = { records: [] };
  }
  if (!Array.isArray(store.entities[entityName].records)) store.entities[entityName].records = [];
  return store.entities[entityName];
}

function generateId(entityName) {
  return `offline_${entityName}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function createOfflineClient({ filePath }) {
  let storePromise = null;
  let storeCache = null;

  async function getStore() {
    if (storeCache) return storeCache;
    if (!storePromise) {
      storePromise = (async () => {
        const loaded = await readJsonFile(filePath).catch(() => ({ entities: {} }));
        if (!loaded || typeof loaded !== "object") return { entities: {} };
        if (!loaded.entities || typeof loaded.entities !== "object") loaded.entities = {};
        return loaded;
      })();
    }
    storeCache = await storePromise;
    return storeCache;
  }

  async function flush(store) {
    await atomicWriteText(filePath, JSON.stringify(store));
  }

  function makeEntity(entityName) {
    return {
      list: async (sort = "-created_date", limit = 50, offset = 0, fields) => {
        const store = await getStore();
        const bucket = ensureEntityBucket(store, entityName);
        const sorted = sortRecords(bucket.records, sort);
        const slice = sorted.slice(offset, offset + limit);
        return slice.map((r) => selectFields(r, fields));
      },
      filter: async (filter, sort = "-created_date", limit = 50, offset = 0, fields) => {
        const store = await getStore();
        const bucket = ensureEntityBucket(store, entityName);
        const filtered = bucket.records.filter((r) => matchesFilter(r, filter));
        const sorted = sortRecords(filtered, sort);
        const slice = sorted.slice(offset, offset + limit);
        return slice.map((r) => selectFields(r, fields));
      },
      create: async (data) => {
        const store = await getStore();
        const bucket = ensureEntityBucket(store, entityName);
        const now = new Date().toISOString();
        const id = data?.id ? String(data.id) : generateId(entityName);
        const rec = { ...(data ?? {}), id, created_date: now, updated_date: now };
        bucket.records.push(rec);
        await flush(store);
        return rec;
      },
      update: async (id, patch) => {
        const store = await getStore();
        const bucket = ensureEntityBucket(store, entityName);
        const idx = bucket.records.findIndex((r) => r?.id === id);
        if (idx === -1) throw new Error(`Offline entity ${entityName} missing id=${id}`);
        const now = new Date().toISOString();
        bucket.records[idx] = { ...bucket.records[idx], ...(patch ?? {}), updated_date: now };
        await flush(store);
        return bucket.records[idx];
      }
    };
  }

  const entities = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        return makeEntity(prop);
      }
    }
  );

  return {
    asServiceRole: { entities },
    offline: { filePath }
  };
}

function createOnlineClient() {
  const appId = getEnvOrThrow("BASE44_APP_ID");
  const serviceToken = getEnvOrThrow("BASE44_SERVICE_TOKEN");
  const serverUrl = process.env.BASE44_SERVER_URL;

  return createClient({
    ...(serverUrl ? { serverUrl } : {}),
    appId,
    serviceToken
  });
}

export function buildBase44Client({ allowMissing = false, mode = "auto" } = {}) {
  const wantOffline =
    mode === "offline" ||
    (mode === "auto" && (getEnvBool("BASE44_OFFLINE", false) || getEnvBool("BASE44_OFFLINE_MODE", false)));
  if (wantOffline) return createOfflineClient({ filePath: getOfflineStorePath() });

  const appId = process.env.BASE44_APP_ID;
  const serviceToken = process.env.BASE44_SERVICE_TOKEN;
  if ((!appId || !serviceToken) && allowMissing) return null;
  return createOnlineClient();
}

export function buildBase44ServiceClient({ mode = "auto" } = {}) {
  return buildBase44Client({ allowMissing: false, mode });
}
