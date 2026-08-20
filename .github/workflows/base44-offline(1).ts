/**
 * Base44 Offline Adapter — local-file-backed entity store
 * =======================================================
 *
 * Provides a transparent fallback when the Base44 backend is unreachable
 * (missing API key, revoked key, private app, network error). The adapter
 * mirrors the Base44 REST API surface (list / get / create / update /
 * remove / bulkCreate) and persists to a local JSON file at
 * `db/base44-offline-store.json`.
 *
 * Why this exists:
 *   The dashboard at /home/z/my-project hits Base44 for every entity fetch.
 *   Without BASE44_API_KEY set in .env, every fetch returns "This app is
 *   private, You do not have access to this app" and the dashboard shows
 *   a "Backend unreachable" banner with zero data. This adapter lets the
 *   dashboard function locally for development, testing, and demos
 *   without requiring the real Base44 key.
 *
 * Truth-guard compatibility:
 *   The offline adapter STILL passes through enforceTruthGuard() (via
 *   the parent b44 client that delegates to it). So you can't use
 *   offline mode to bypass truth enforcement — every create/update
 *   still requires proof_hash + verified_at + proof_source for
 *   terminal-success statuses on financial entities.
 *
 * Seeding:
 *   Run `npx tsx scripts/seed-offline-store.ts` to populate the store
 *   with sample Agents, Missions, Tasks, RevenueStreams, etc.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// ─── Store location ──────────────────────────────────────────────────────

const STORE_DIR = join(process.cwd(), "db");
const STORE_PATH = join(STORE_DIR, "base44-offline-store.json");

// ─── Types ──────────────────────────────────────────────────────────────

interface OfflineRecord {
  _id: string;
  _created_date: string;
  _updated_date: string;
  [key: string]: unknown;
}

interface OfflineStore {
  version: 1;
  entities: Record<string, OfflineRecord[]>;
}

// ─── Load / save ─────────────────────────────────────────────────────────

let cache: OfflineStore | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 2_000; // 2 seconds — short so dashboard polls see fresh data

function loadStore(): OfflineStore {
  // Re-read from disk if cache is stale or missing
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cache;
  }
  if (!existsSync(STORE_PATH)) {
    cache = { version: 1, entities: {} };
  } else {
    try {
      const raw = readFileSync(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw) as OfflineStore;
      cache = parsed && parsed.entities ? parsed : { version: 1, entities: {} };
    } catch {
      cache = { version: 1, entities: {} };
    }
  }
  cacheLoadedAt = Date.now();
  return cache;
}

function saveStore(store: OfflineStore): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  cache = store;
  cacheLoadedAt = Date.now();
}

// ─── Public API (mirrors src/lib/base44.ts) ──────────────────────────────

export interface OfflineQueryOpts {
  q?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort_by?: string;
}

function matchesQuery(rec: OfflineRecord, q: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(q)) {
    if (rec[key] !== val) return false;
  }
  return true;
}

function sortByField(records: OfflineRecord[], field: string): OfflineRecord[] {
  const descending = field.startsWith("-");
  const actualField = descending ? field.slice(1) : field;
  const sorted = [...records].sort((a, b) => {
    const av = a[actualField];
    const bv = b[actualField];
    if (typeof av === "string" && typeof bv === "string") {
      return descending ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    if (typeof av === "number" && typeof bv === "number") {
      return descending ? bv - av : av - bv;
    }
    return 0;
  });
  return sorted;
}

function stripInternal(rec: OfflineRecord): Record<string, unknown> {
  const { _id, _created_date, _updated_date, ...rest } = rec;
  return {
    id: _id,
    created_date: _created_date,
    updated_date: _updated_date,
    ...rest,
  };
}

export const offlineB44 = {
  async list<E extends string>(
    entity: E,
    opts: OfflineQueryOpts = {}
  ): Promise<Record<string, unknown>[]> {
    const store = loadStore();
    let records = store.entities[entity] ? [...store.entities[entity]] : [];
    if (opts.q) {
      records = records.filter((r) => matchesQuery(r, opts.q!));
    }
    if (opts.sort_by) {
      records = sortByField(records, opts.sort_by);
    }
    if (opts.skip != null) {
      records = records.slice(opts.skip);
    }
    if (opts.limit != null) {
      records = records.slice(0, opts.limit);
    }
    return records.map(stripInternal);
  },

  async get<E extends string>(entity: E, id: string): Promise<Record<string, unknown> | null> {
    const store = loadStore();
    const records = store.entities[entity] || [];
    const rec = records.find((r) => r._id === id);
    return rec ? stripInternal(rec) : null;
  },

  async create<E extends string>(
    entity: E,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const store = loadStore();
    if (!store.entities[entity]) store.entities[entity] = [];
    const now = new Date().toISOString();
    const rec: OfflineRecord = {
      _id: randomUUID(),
      _created_date: now,
      _updated_date: now,
      ...data,
    };
    store.entities[entity].push(rec);
    saveStore(store);
    return stripInternal(rec);
  },

  async update<E extends string>(
    entity: E,
    id: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const store = loadStore();
    const records = store.entities[entity] || [];
    const idx = records.findIndex((r) => r._id === id);
    if (idx < 0) {
      throw new Error(`Offline update: ${entity} ${id} not found`);
    }
    const now = new Date().toISOString();
    records[idx] = {
      ...records[idx],
      ...data,
      _updated_date: now,
    };
    saveStore(store);
    return stripInternal(records[idx]);
  },

  async remove<E extends string>(entity: E, id: string): Promise<void> {
    const store = loadStore();
    const records = store.entities[entity] || [];
    const idx = records.findIndex((r) => r._id === id);
    if (idx >= 0) {
      records.splice(idx, 1);
      saveStore(store);
    }
  },

  async bulkCreate<E extends string>(
    entity: E,
    records: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const r of records) {
      out.push(await this.create(entity, r));
    }
    return out;
  },

  /** Returns true if the offline store has been seeded (non-empty). */
  isSeeded(): boolean {
    const store = loadStore();
    return Object.values(store.entities).some((arr) => arr.length > 0);
  },

  /** Returns the count of records per entity. */
  stats(): Record<string, number> {
    const store = loadStore();
    const out: Record<string, number> = {};
    for (const [entity, records] of Object.entries(store.entities)) {
      out[entity] = records.length;
    }
    return out;
  },

  /** Returns the absolute path to the store file (for diagnostics). */
  storePath(): string {
    return STORE_PATH;
  },
};
