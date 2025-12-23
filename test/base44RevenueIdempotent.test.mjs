import test from "node:test";
import assert from "node:assert/strict";

import { createBase44RevenueEventIdempotent } from "../src/base44-revenue.mjs";

function makeCfg() {
  return {
    entityName: "RevenueEvent",
    defaultCurrency: "USD",
    allowNonPositiveAmounts: false,
    fieldMap: {
      amount: "amount",
      currency: "currency",
      occurredAt: "occurred_at",
      source: "source",
      externalId: "external_id",
      missionId: "mission_id",
      missionTitle: "mission_title",
      agentIds: "agent_ids",
      metadata: "metadata"
    }
  };
}

function makeEvent(overrides = {}) {
  return {
    amount: 10,
    currency: "USD",
    occurredAt: "2025-01-01T00:00:00.000Z",
    source: "paypal",
    externalId: "evt_1",
    metadata: {},
    ...overrides
  };
}

test("createBase44RevenueEventIdempotent returns existing id when found", async () => {
  let created = false;
  const base44 = {
    asServiceRole: {
      entities: {
        RevenueEvent: {
          filter: async () => [{ id: "existing" }],
          create: async () => {
            created = true;
            return { id: "new" };
          }
        }
      }
    }
  };

  const out = await createBase44RevenueEventIdempotent(base44, makeCfg(), makeEvent(), { dryRun: false });
  assert.deepEqual(out, { id: "existing", deduped: true });
  assert.equal(created, false);
});

test("createBase44RevenueEventIdempotent creates when no existing record", async () => {
  let filterCalls = 0;
  let createCalls = 0;
  const base44 = {
    asServiceRole: {
      entities: {
        RevenueEvent: {
          filter: async () => {
            filterCalls++;
            return [];
          },
          create: async () => {
            createCalls++;
            return { id: "created" };
          }
        }
      }
    }
  };

  const out = await createBase44RevenueEventIdempotent(base44, makeCfg(), makeEvent(), { dryRun: false });
  assert.equal(out?.id, "created");
  assert.equal(out?.deduped, undefined);
  assert.equal(filterCalls, 1);
  assert.equal(createCalls, 1);
});

test("createBase44RevenueEventIdempotent re-checks on create error and dedupes", async () => {
  let filterCalls = 0;
  const base44 = {
    asServiceRole: {
      entities: {
        RevenueEvent: {
          filter: async () => {
            filterCalls++;
            return filterCalls === 1 ? [] : [{ id: "existing_after_race" }];
          },
          create: async () => {
            throw new Error("duplicate");
          }
        }
      }
    }
  };

  const out = await createBase44RevenueEventIdempotent(base44, makeCfg(), makeEvent(), { dryRun: false });
  assert.deepEqual(out, { id: "existing_after_race", deduped: true });
  assert.equal(filterCalls, 2);
});

