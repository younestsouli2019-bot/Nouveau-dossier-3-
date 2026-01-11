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
  const { appId, serviceToken } = getOnlineAuth();
  const serverUrl = process.env.BASE44_SERVER_URL;

<<<<<<< Updated upstream
  return createClient({
    ...(serverUrl ? { serverUrl } : {}),
    appId,
    serviceToken
=======
  // Avoid logging sensitive tokens. Log only non-sensitive metadata.
  console.log(`[Base44Client] Connecting to server: ${serverUrl}`);
  console.log(`[Base44Client] App identifier resolved`);

  const client = createClient({
    serverUrl,
    appId,
    serviceToken,
    // Keep Bearer and X-Service-Token for broad compatibility; avoid redundant keys and apiKey duplication
    headers: {
      "Authorization": `Bearer ${serviceToken}`,
      "X-Service-Token": serviceToken
    }
>>>>>>> Stashed changes
  });
}

function decodeJwtPayload(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(`${b64}${pad}`, "base64").toString("utf8");
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function coerceNonEmptyString(value) {
  const s = value == null ? "" : String(value).trim();
  return s ? s : null;
}

function normalizeAppIdInput(value) {
  const raw = coerceNonEmptyString(value);
  if (!raw) return null;
  const unwrapped = raw.replace(/^[`"' \t\r\n]+|[`"' \t\r\n]+$/g, "").trim();
  if (!unwrapped) return null;

  const looksLikeUrl = /^https?:\/\//i.test(unwrapped) || unwrapped.includes("base44.app");
  if (!looksLikeUrl) return unwrapped;

  const parsed = (() => {
    try {
      return new URL(unwrapped);
    } catch {
      try {
        return new URL(`https://${unwrapped}`);
      } catch {
        return null;
      }
    }
  })();
  if (!parsed?.hostname) return unwrapped;

  const host = parsed.hostname.trim();
  const parts = String(parsed.pathname ?? "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const appsIdx = parts.findIndex((p) => p.toLowerCase() === "apps");
  if (appsIdx >= 0 && appsIdx + 1 < parts.length) {
    const fromPath = coerceNonEmptyString(parts[appsIdx + 1]);
    if (fromPath) return fromPath;
  }
<<<<<<< Updated upstream
  if (host.endsWith(".base44.app")) return host.slice(0, -".base44.app".length);
=======
  // Return subdomain host if present (e.g., slug.base44.app), else host
>>>>>>> Stashed changes
  return host;
}

function inferAppIdFromServiceToken(serviceToken) {
  const decoded = decodeJwtPayload(serviceToken);
  if (!decoded) return null;
  const candidates = [
    decoded.appId,
    decoded.app_id,
    decoded.applicationId,
    decoded.application_id,
    decoded.app,
    decoded.aid
  ];
  for (const c of candidates) {
    const s = coerceNonEmptyString(c);
    if (s) return s;
  }
  return null;
}

function parseApiKeyValue(raw) {
  const v = coerceNonEmptyString(raw);
  if (!v) return { appId: null, serviceToken: null };

  if (v.startsWith("{") && v.endsWith("}")) {
    try {
      const obj = JSON.parse(v);
      const appId = normalizeAppIdInput(obj?.appId ?? obj?.app_id ?? obj?.applicationId ?? obj?.application_id);
      const serviceToken = coerceNonEmptyString(obj?.serviceToken ?? obj?.service_token ?? obj?.token ?? obj?.apiKey ?? obj?.api_key);
      return { appId, serviceToken };
    } catch {
      return { appId: null, serviceToken: v };
    }
  }

  for (const sep of [":", "|", ",", ";"]) {
    const idx = v.indexOf(sep);
    if (idx > 0 && idx < v.length - 1) {
      const left = coerceNonEmptyString(v.slice(0, idx));
      const right = coerceNonEmptyString(v.slice(idx + 1));
      if (left && right) return { appId: left, serviceToken: right };
    }
  }

  return { appId: null, serviceToken: v };
}

function appIdEquivalent(a, b) {
  const na = normalizeAppIdInput(a);
  const nb = normalizeAppIdInput(b);
  if (!na || !nb) return false;
  // Accept equality between slug and slug.base44.app
  const toSlug = (v) => String(v).replace(/\.base44\.app$/i, "");
  return toSlug(na).toLowerCase() === toSlug(nb).toLowerCase();
}

function getOnlineAuth() {
  const envAppId = normalizeAppIdInput(process.env.BASE44_APP_ID);
  const envServiceToken = coerceNonEmptyString(process.env.BASE44_SERVICE_TOKEN);
<<<<<<< Updated upstream
  if (envAppId && envServiceToken) return { appId: envAppId, serviceToken: envServiceToken };
=======
  
  // Strict Identity Check with robust equivalence
  if (envAppId && envServiceToken) {
    const decoded = decodeJwtPayload(envServiceToken);
    if (decoded) {
      const tokenAppId = normalizeAppIdInput(decoded.appId ?? decoded.app_id ?? decoded.applicationId);
      if (tokenAppId && !appIdEquivalent(tokenAppId, envAppId)) {
        throw new Error(`Security Mismatch: BASE44_APP_ID (${envAppId}) does not match token's app_id (${tokenAppId})`);
      }
    }
    return { appId: envAppId, serviceToken: envServiceToken };
  }
>>>>>>> Stashed changes

  const apiKeyRaw = process.env.BASE44_API_KEY ?? process.env.BASE44_API_TOKEN ?? process.env.BASE44_KEY ?? null;
  const parsed = parseApiKeyValue(apiKeyRaw);

  const serviceToken = envServiceToken ?? parsed.serviceToken ?? null;
  const appId = envAppId ?? parsed.appId ?? (serviceToken ? inferAppIdFromServiceToken(serviceToken) : null);

  if (!appId) throw new Error("Missing required env var: BASE44_APP_ID");
  if (!serviceToken) throw new Error("Missing required env var: BASE44_SERVICE_TOKEN");

<<<<<<< Updated upstream
=======
  // Validate inferred match as well
  if (serviceToken) {
     const decoded = decodeJwtPayload(serviceToken);
     if (decoded) {
       const tokenAppId = normalizeAppIdInput(decoded.appId ?? decoded.app_id ?? decoded.applicationId);
       if (tokenAppId && !appIdEquivalent(tokenAppId, appId)) {
         throw new Error(`Security Mismatch: Inferred App ID (${appId}) does not match token's app_id (${tokenAppId})`);
       }
     }
  }

>>>>>>> Stashed changes
  return { appId, serviceToken };
}

export function buildBase44Client({ allowMissing = false, mode = "auto" } = {}) {
  const wantOffline =
    mode === "offline" ||
    (mode === "auto" && (getEnvBool("BASE44_OFFLINE", false) || getEnvBool("BASE44_OFFLINE_MODE", false)));
  if (wantOffline) return createOfflineClient({ filePath: getOfflineStorePath() });

  if (allowMissing) {
    try {
      getOnlineAuth();
    } catch {
      return null;
    }
  }
  return createOnlineClient();
}

export function buildBase44ServiceClient({ mode = "auto" } = {}) {
  return buildBase44Client({ allowMissing: false, mode });
}
