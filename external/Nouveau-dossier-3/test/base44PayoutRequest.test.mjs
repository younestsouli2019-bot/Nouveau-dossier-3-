import test from "node:test";
import assert from "node:assert/strict";

import { createBase44PayoutRequestIdempotent } from "../src/base44-payout-request.mjs";

function makeCfg() {
  return {
    payoutEntityName: "PayoutRequest",
    fieldMap: {
      amount: "amount",
      currency: "currency",
      status: "status",
      source: "source",
      externalId: "external_id",
      occurredAt: "occurred_at",
      destinationSummary: "destination_summary",
      metadata: "metadata"
    }
  };
}

function makePayload(overrides = {}) {
  return {
    amount: 10,
    currency: "USD",
    status: "READY_FOR_REVIEW",
    source: "ap2",
    externalId: "x1",
    occurredAt: "2025-01-01T00:00:00.000Z",
    destinationSummary: {},
    metadata: {},
    ...overrides
  };
}

test("createBase44PayoutRequestIdempotent dedupes by external_id", async () => {
  const base44 = {
    asServiceRole: {
      entities: {
        PayoutRequest: {
          filter: async () => [{ id: "existing" }],
          create: async () => ({ id: "new" })
        }
      }
    }
  };

  const prev = process.env.BASE44_ENABLE_PAYOUT_REQUESTS;
  process.env.BASE44_ENABLE_PAYOUT_REQUESTS = "true";
  try {
    const out = await createBase44PayoutRequestIdempotent(base44, makeCfg(), makePayload(), { dryRun: false });
    assert.deepEqual(out, { id: "existing", deduped: true });
  } finally {
    process.env.BASE44_ENABLE_PAYOUT_REQUESTS = prev;
  }
});

