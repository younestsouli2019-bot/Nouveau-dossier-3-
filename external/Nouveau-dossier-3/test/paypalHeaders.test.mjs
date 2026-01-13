import test from "node:test";
import assert from "node:assert/strict";

import { extractPayPalWebhookHeaders } from "../src/paypal-api.mjs";

test("extractPayPalWebhookHeaders reads lower-case header keys", () => {
  const headers = {
    "paypal-transmission-id": "tid",
    "paypal-transmission-time": "ttime",
    "paypal-transmission-sig": "tsig",
    "paypal-cert-url": "curl",
    "paypal-auth-algo": "algo"
  };
  assert.deepEqual(extractPayPalWebhookHeaders(headers), {
    transmissionId: "tid",
    transmissionTime: "ttime",
    transmissionSig: "tsig",
    certUrl: "curl",
    authAlgo: "algo"
  });
});

test("extractPayPalWebhookHeaders reads mixed-case header keys", () => {
  const headers = {
    "PayPal-Transmission-Id": "tid",
    "PayPal-Transmission-Time": "ttime",
    "PayPal-Transmission-Sig": "tsig",
    "PayPal-Cert-Url": "curl",
    "PayPal-Auth-Algo": "algo"
  };
  assert.deepEqual(extractPayPalWebhookHeaders(headers), {
    transmissionId: "tid",
    transmissionTime: "ttime",
    transmissionSig: "tsig",
    certUrl: "curl",
    authAlgo: "algo"
  });
});

