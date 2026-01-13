import crypto from "node:crypto";

function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

export function getRevenueConfigFromEnv() {
  const entityName = process.env.BASE44_REVENUE_ENTITY ?? "RevenueEvent";
  const defaultCurrency = process.env.BASE44_DEFAULT_CURRENCY ?? "USD";
  const allowNonPositiveAmounts =
    (process.env.BASE44_ALLOW_NON_POSITIVE_REVENUE ?? "false").toLowerCase() === "true";
  const mapFromEnv = safeJsonParse(process.env.BASE44_REVENUE_FIELD_MAP, null);

  const fieldMap = mapFromEnv ?? {
    amount: "amount",
    currency: "currency",
    occurredAt: "occurred_at",
    source: "source",
    externalId: "external_id",
    status: "status",
    payoutBatchId: "payout_batch_id",
    eventHash: "event_hash",
    missionId: "mission_id",
    missionTitle: "mission_title",
    agentIds: "agent_ids",
    metadata: "metadata"
  };

  return { entityName, defaultCurrency, allowNonPositiveAmounts, fieldMap };
}

function normalizeIsoDate(value) {
  const raw = value == null ? "" : String(value);
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  return new Date(t).toISOString();
}

function normalizeAmountString(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function computeEventHash({ sourceId, amount, confirmationDateIso, sourceType, recipientOrDescription }) {
  const parts = [
    String(sourceId ?? ""),
    String(amount ?? ""),
    String(confirmationDateIso ?? ""),
    String(sourceType ?? ""),
    String(recipientOrDescription ?? "")
  ];
  const input = parts.join("|");
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function buildRevenueData(cfg, event) {
  const data = {};
  const { fieldMap } = cfg;

  if (event.amount == null || Number.isNaN(event.amount)) {
    throw new Error("Revenue event requires a numeric amount");
  }

  if (!cfg.allowNonPositiveAmounts && event.amount <= 0) {
    throw new Error("Revenue event amount must be > 0");
  }

  data[fieldMap.amount] = event.amount;
  data[fieldMap.currency] = event.currency;
  data[fieldMap.occurredAt] = event.occurredAt;
  data[fieldMap.source] = event.source;
  data[fieldMap.externalId] = event.externalId;
  data[fieldMap.metadata] = event.metadata ?? {};

  if (fieldMap.status && event.status != null) data[fieldMap.status] = event.status;
  if (fieldMap.payoutBatchId && event.payoutBatchId != null) data[fieldMap.payoutBatchId] = event.payoutBatchId;

  if (fieldMap.eventHash) {
    const occurredAtIso = normalizeIsoDate(event.occurredAt);
    const amountStr = normalizeAmountString(event.amount);
    const recipientOrDescription =
      event?.metadata?.recipient_id ??
      event?.metadata?.recipient ??
      event?.metadata?.description ??
      event?.missionId ??
      event?.missionTitle ??
      "";

    data[fieldMap.eventHash] = computeEventHash({
      sourceId: event.externalId,
      amount: amountStr,
      confirmationDateIso: occurredAtIso,
      sourceType: event.source,
      recipientOrDescription
    });
  }

  if (event.missionId) data[fieldMap.missionId] = event.missionId;
  if (event.missionTitle) data[fieldMap.missionTitle] = event.missionTitle;
  if (event.agentIds) data[fieldMap.agentIds] = event.agentIds;

  return data;
}

async function findExistingId(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]?.id) return existing[0].id;
  return null;
}

export async function createBase44RevenueEvent(base44, cfg, event, { dryRun } = {}) {
  const data = buildRevenueData(cfg, event);

  if (dryRun) return { dryRun: true, entity: cfg.entityName, data };

  if (!base44) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  const entity = base44.asServiceRole.entities[cfg.entityName];
  return entity.create(data);
}

export async function createBase44RevenueEventIdempotent(base44, cfg, event, { dryRun } = {}) {
  const data = buildRevenueData(cfg, event);

  if (dryRun) return { dryRun: true, entity: cfg.entityName, data };

  if (!base44) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  const entity = base44.asServiceRole.entities[cfg.entityName];
  const filter = { [cfg.fieldMap.externalId]: event.externalId };
  if (cfg.fieldMap.source && event.source != null) filter[cfg.fieldMap.source] = event.source;

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
