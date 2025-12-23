import test from "node:test";
import assert from "node:assert/strict";

import { getMandateStoreConfigFromEnv, writeBase44MandateIdempotent } from "../src/base44-mandate-store.mjs";

function makeEnvelope(id) {
  return {
    protected: { kid: "k1", alg: "Ed25519", typ: "AP2-MANDATE", v: 1 },
    payload: {
      type: "ap2.intent",
      id,
      iss: "did:swarm:cp:test",
      sub: "did:swarm:sa:*",
      aud: "did:swarm:me:test",
      iat: "2025-01-01T00:00:00.000Z",
      exp: "2025-01-02T00:00:00.000Z"
    },
    signature: "sig"
  };
}

test("writeBase44MandateIdempotent dedupes by mandate_id", async () => {
  const cfg = getMandateStoreConfigFromEnv();
  const base44 = {
    asServiceRole: {
      entities: {
        [cfg.entityName]: {
          filter: async () => [{ id: "existing" }]
        }
      }
    }
  };

  const out = await writeBase44MandateIdempotent(base44, cfg, makeEnvelope("urn:uuid:a"), { dryRun: false });
  assert.deepEqual(out, { id: "existing", deduped: true });
});

test("writeBase44MandateIdempotent creates when missing", async () => {
  const cfg = getMandateStoreConfigFromEnv();
  let created = false;
  const base44 = {
    asServiceRole: {
      entities: {
        [cfg.entityName]: {
          filter: async () => [],
          create: async () => {
            created = true;
            return { id: "new" };
          }
        }
      }
    }
  };

  const out = await writeBase44MandateIdempotent(base44, cfg, makeEnvelope("urn:uuid:b"), { dryRun: false });
  assert.equal(out.id, "new");
  assert.equal(created, true);
});

