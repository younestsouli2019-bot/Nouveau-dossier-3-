import test from "node:test";
import assert from "node:assert/strict";

import { acquireWorkLease } from "../src/base44-work-lease.mjs";

function makeCfg() {
  return {
    entityName: "WorkLease",
    fieldMap: {
      key: "key",
      holder: "holder",
      claimedAt: "claimed_at",
      expiresAt: "expires_at",
      status: "status",
      meta: "meta"
    }
  };
}

test("acquireWorkLease creates lease when missing", async () => {
  let created = null;
  const base44 = {
    asServiceRole: {
      entities: {
        WorkLease: {
          filter: async () => [],
          create: async (data) => {
            created = data;
            return { id: "new", ...data };
          }
        }
      }
    }
  };

  const out = await acquireWorkLease(base44, makeCfg(), {
    key: "k",
    holder: "h",
    ttlMs: 10_000,
    now: () => 1_000
  });
  assert.equal(out.acquired, true);
  assert.equal(out.id, "new");
  assert.equal(created.key, "k");
  assert.equal(created.holder, "h");
});

test("acquireWorkLease denies when lease is active and held by another", async () => {
  const base44 = {
    asServiceRole: {
      entities: {
        WorkLease: {
          filter: async () => [
            { id: "lease1", key: "k", holder: "other", expires_at: new Date(10_000).toISOString() }
          ]
        }
      }
    }
  };

  const out = await acquireWorkLease(base44, makeCfg(), {
    key: "k",
    holder: "me",
    ttlMs: 10_000,
    now: () => 1_000
  });
  assert.equal(out.acquired, false);
  assert.equal(out.id, "lease1");
  assert.equal(out.holder, "other");
});

test("acquireWorkLease updates when expired", async () => {
  let updatedArgs = null;
  const base44 = {
    asServiceRole: {
      entities: {
        WorkLease: {
          filter: async () => [
            { id: "lease1", key: "k", holder: "other", expires_at: new Date(500).toISOString() }
          ],
          update: async (id, data) => {
            updatedArgs = { id, data };
            return { id, ...data };
          }
        }
      }
    }
  };

  const out = await acquireWorkLease(base44, makeCfg(), {
    key: "k",
    holder: "me",
    ttlMs: 10_000,
    now: () => 1_000
  });
  assert.equal(out.acquired, true);
  assert.equal(out.id, "lease1");
  assert.equal(updatedArgs.id, "lease1");
  assert.equal(updatedArgs.data.holder, "me");
});

