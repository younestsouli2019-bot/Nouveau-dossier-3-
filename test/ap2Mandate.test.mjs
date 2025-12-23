import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { mandatePayloadHash, signMandatePayload, verifyMandateEnvelope } from "../src/ap2-mandate.mjs";

test("mandatePayloadHash is stable across key order", () => {
  const a = { b: 1, a: { y: 2, x: 3 } };
  const b = { a: { x: 3, y: 2 }, b: 1 };
  assert.equal(mandatePayloadHash(a), mandatePayloadHash(b));
});

test("signMandatePayload and verifyMandateEnvelope succeed with Ed25519 keypair", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const payload = {
    type: "ap2.intent",
    id: "urn:uuid:test",
    iss: "did:swarm:cp:test",
    sub: "did:swarm:sa:*",
    aud: "did:swarm:me:test",
    iat: new Date().toISOString(),
    exp: new Date(Date.now() + 60_000).toISOString()
  };

  const env = signMandatePayload(payload, { kid: "k1", privateKey });
  const out = verifyMandateEnvelope(env, {
    resolvePublicKey: () => publicKey,
    clockSkewMs: 0
  });

  assert.equal(out.ok, true);
  assert.equal(out.kid, "k1");
  assert.equal(out.payloadHash, mandatePayloadHash(payload));
});

test("verifyMandateEnvelope fails on signature mismatch", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const payload = { type: "ap2.intent", id: "urn:uuid:test2", iat: new Date().toISOString() };
  const env = signMandatePayload(payload, { kid: "k1", privateKey });
  env.payload = { ...env.payload, id: "urn:uuid:changed" };

  const out = verifyMandateEnvelope(env, { resolvePublicKey: () => publicKey });
  assert.equal(out.ok, false);
  assert.ok(out.violations.includes("bad_signature"));
});

