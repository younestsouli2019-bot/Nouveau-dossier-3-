import test from "node:test";
import assert from "node:assert/strict";

import { resolveRecipientAddress } from "../src/emit-revenue-events.mjs";

test("resolveRecipientAddress resolves payoneer recipient from payoneer_id", () => {
  const recipient = resolveRecipientAddress("payoneer", { payoneer_id: "user@example.com" }, null);
  assert.equal(recipient, "user@example.com");
});

test("resolveRecipientAddress returns null when payoneer recipient missing", () => {
  const recipient = resolveRecipientAddress("payoneer", {}, "not-an-email");
  assert.equal(recipient, null);
});

