import { mandatePayloadHash } from "./ap2-mandate.mjs";

function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

export function getMandateStoreConfigFromEnv() {
  const entityName = process.env.AP2_MANDATE_ENTITY ?? "Mandate";
  const mapFromEnv = safeJsonParse(process.env.AP2_MANDATE_FIELD_MAP, null);

  const fieldMap = mapFromEnv ?? {
    type: "type",
    mandateId: "mandate_id",
    payload: "payload",
    payloadHash: "payload_hash",
    signature: "signature",
    kid: "kid",
    iss: "iss",
    sub: "sub",
    aud: "aud",
    iat: "iat",
    exp: "exp",
    prevHash: "prev_hash",
    status: "status",
    verification: "verification"
  };

  return { entityName, fieldMap };
}

async function findExistingId(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]?.id) return existing[0].id;
  return null;
}

function buildMandateData(cfg, envelope, { verification = null, status = null } = {}) {
  const payload = envelope?.payload ?? null;
  const protectedHeader = envelope?.protected ?? null;
  const signature = envelope?.signature ?? null;

  if (!payload || typeof payload !== "object") throw new Error("Mandate payload is required");
  if (!protectedHeader || typeof protectedHeader !== "object") throw new Error("Mandate protected header is required");
  if (!signature || typeof signature !== "string") throw new Error("Mandate signature is required");

  const map = cfg.fieldMap;
  const payloadHash = mandatePayloadHash(payload);

  return {
    [map.type]: payload.type ?? null,
    [map.mandateId]: payload.id ?? null,
    [map.payload]: payload,
    [map.payloadHash]: payloadHash,
    [map.signature]: signature,
    [map.kid]: protectedHeader.kid ?? null,
    [map.iss]: payload.iss ?? null,
    [map.sub]: payload.sub ?? null,
    [map.aud]: payload.aud ?? null,
    [map.iat]: payload.iat ?? null,
    [map.exp]: payload.exp ?? null,
    [map.prevHash]: payload.prev_hash ?? null,
    ...(status != null ? { [map.status]: status } : {}),
    ...(verification != null ? { [map.verification]: verification } : {})
  };
}

export async function writeBase44MandateIdempotent(
  base44,
  cfg,
  envelope,
  { verification = null, status = null, dryRun = false } = {}
) {
  const data = buildMandateData(cfg, envelope, { verification, status });
  if (dryRun) return { dryRun: true, entity: cfg.entityName, data };

  if (!base44) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  const entity = base44.asServiceRole.entities[cfg.entityName];
  const map = cfg.fieldMap;

  const mandateId = data[map.mandateId];
  const payloadHash = data[map.payloadHash];

  const primaryFilter = mandateId ? { [map.mandateId]: mandateId } : { [map.payloadHash]: payloadHash };
  const existingId = await findExistingId(entity, primaryFilter);
  if (existingId) return { id: existingId, deduped: true };

  try {
    return await entity.create(data);
  } catch (err) {
    const racedId = await findExistingId(entity, primaryFilter).catch(() => null);
    if (racedId) return { id: racedId, deduped: true };
    throw err;
  }
}

