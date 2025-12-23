import test from "node:test";
import assert from "node:assert/strict";

import { mapPayPalWebhookToRevenueEvent } from "../src/paypal-event-mapper.mjs";

test("maps PAYMENT.CAPTURE.COMPLETED to a revenue event", () => {
  const evt = {
    id: "WH-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: "2025-12-21T00:00:00Z",
    resource: {
      id: "CAP-1",
      status: "COMPLETED",
      amount: { value: "12.34", currency_code: "USD" },
      custom_id: "swarm_123"
    }
  };

  const out = mapPayPalWebhookToRevenueEvent(evt, { defaultCurrency: "EUR" });
  assert.ok(out);
  assert.equal(out.amount, 12.34);
  assert.equal(out.currency, "USD");
  assert.equal(out.source, "paypal");
  assert.equal(out.externalId, "WH-1");
  assert.equal(out.metadata.paypal_capture_id, "CAP-1");
});

test("returns null for non-capture events", () => {
  const out = mapPayPalWebhookToRevenueEvent(
    { id: "WH-2", event_type: "CHECKOUT.ORDER.APPROVED" },
    { defaultCurrency: "USD" }
  );
  assert.equal(out, null);
});

