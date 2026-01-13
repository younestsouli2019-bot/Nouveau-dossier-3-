import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { createDedupeStore } from "../src/dedupe-store.mjs";

test("dedupe store persists and reloads within ttl", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarm_dedupe_"));
  const filePath = path.join(dir, "store.json");
  let t = 1000;
  const now = () => t;

  const s1 = createDedupeStore({ filePath, ttlMs: 5000, maxEntries: 10, flushIntervalMs: 1000, now });
  await s1.load();
  s1.markDone("k1");
  await s1.flush();

  const s2 = createDedupeStore({ filePath, ttlMs: 5000, maxEntries: 10, flushIntervalMs: 1000, now });
  await s2.load();
  assert.equal(s2.isRecentlyDone("k1"), true);

  t = 7000;
  assert.equal(s2.isRecentlyDone("k1"), false);
});

test("dedupe store enforces max entries and keeps newest", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarm_dedupe_"));
  const filePath = path.join(dir, "store.json");
  let t = 0;
  const now = () => t;

  const s = createDedupeStore({ filePath, ttlMs: 60000, maxEntries: 2, flushIntervalMs: 1000, now });
  await s.load();

  t = 1;
  s.markDone("a");
  t = 2;
  s.markDone("b");
  t = 3;
  s.markDone("c");

  assert.equal(s.isRecentlyDone("a"), false);
  assert.equal(s.isRecentlyDone("b"), true);
  assert.equal(s.isRecentlyDone("c"), true);

  await s.flush();

  const s2 = createDedupeStore({ filePath, ttlMs: 60000, maxEntries: 2, flushIntervalMs: 1000, now });
  await s2.load();
  assert.equal(s2.isRecentlyDone("a"), false);
  assert.equal(s2.isRecentlyDone("b"), true);
  assert.equal(s2.isRecentlyDone("c"), true);
});

