import test from "node:test";
import assert from "node:assert/strict";

import {
  createBase44ExternalSettlementIdempotent,
  getExternalSettlementConfigFromEnv
} from "../src/base44-external-settlement.mjs";

test("createBase44ExternalSettlementIdempotent creates when enabled", async () => {
  const cfg = getExternalSettlementConfigFromEnv();
  const base44 = {
    asServiceRole: {
      entities: {
        [cfg.entityName]: {
          filter: async () => [],
          create: async (data) => ({ id: "new", ...data })
        }
      }
    }
  };

  const prev = process.env.BASE44_ENABLE_EXTERNAL_SETTLEMENT_WRITES;
  process.env.BASE44_ENABLE_EXTERNAL_SETTLEMENT_WRITES = "true";
  try {
    const out = await createBase44ExternalSettlementIdempotent(
      base44,
      cfg,
      {
        settlementId: "SETTLE_1",
        periodStart: "2025-12-01",
        periodEnd: "2025-12-31",
        beneficiary: "YOUNES",
        currency: "USD",
        amount: 100,
        status: "issued",
        items: []
      },
      { dryRun: false }
    );
    assert.equal(out.id, "new");
  } finally {
    process.env.BASE44_ENABLE_EXTERNAL_SETTLEMENT_WRITES = prev;
  }
});

