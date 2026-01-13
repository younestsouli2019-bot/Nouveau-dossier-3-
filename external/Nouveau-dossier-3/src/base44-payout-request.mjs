function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

export function getPayoutRequestConfigFromEnv() {
  const payoutEntityName = process.env.BASE44_PAYOUT_ENTITY ?? "PayoutRequest";
  const mapFromEnv = safeJsonParse(process.env.BASE44_PAYOUT_FIELD_MAP, null);

  const fieldMap = mapFromEnv ?? {
    amount: "amount",
    currency: "currency",
    status: "status",
    source: "source",
    externalId: "external_id",
    occurredAt: "occurred_at",
    destinationSummary: "destination_summary",
    metadata: "metadata"
  };

  return { payoutEntityName, fieldMap };
}

async function findExistingId(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]?.id) return existing[0].id;
  return null;
}

function buildPayoutData(cfg, payload) {
  const data = {};
  const map = cfg.fieldMap;

  if (payload.amount == null || Number.isNaN(payload.amount)) {
    throw new Error("Payout request requires a numeric amount");
  }
  if (payload.amount <= 0) throw new Error("Payout request amount must be > 0");

  data[map.amount] = payload.amount;
  data[map.currency] = payload.currency;
  data[map.status] = payload.status;
  data[map.source] = payload.source;
  data[map.externalId] = payload.externalId;
  data[map.occurredAt] = payload.occurredAt;
  data[map.destinationSummary] = payload.destinationSummary;
  data[map.metadata] = payload.metadata ?? {};

  return data;
}

export async function createBase44PayoutRequestIdempotent(base44, cfg, payload, { dryRun = false } = {}) {
  const data = buildPayoutData(cfg, payload);
  if (dryRun) return { dryRun: true, entity: cfg.payoutEntityName, data };

  if (!base44) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  const enable = (process.env.BASE44_ENABLE_PAYOUT_REQUESTS ?? "false").toLowerCase() === "true";
  if (!enable) {
    throw new Error("Refusing to create payout requests without BASE44_ENABLE_PAYOUT_REQUESTS=true");
  }

  const entity = base44.asServiceRole.entities[cfg.payoutEntityName];
  const map = cfg.fieldMap;

  const filter = { [map.externalId]: payload.externalId };
  if (map.source && payload.source != null) filter[map.source] = payload.source;

  const existingId = await findExistingId(entity, filter);
  if (existingId) return { id: existingId, deduped: true };

  try {
    return await entity.create(data);
  } catch (err) {
    const racedId = await findExistingId(entity, filter).catch(() => null);
    if (racedId) return { id: racedId, deduped: true };
    throw err;
  }
}

