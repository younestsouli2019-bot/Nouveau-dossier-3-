function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

export function getSettlementIndexConfigFromEnv() {
  const entityName = process.env.AP2_SETTLEMENT_ITEM_ENTITY ?? "SettlementItem";
  const mapFromEnv = safeJsonParse(process.env.AP2_SETTLEMENT_ITEM_FIELD_MAP, null);

  const fieldMap = mapFromEnv ?? {
    revenueExternalId: "revenue_external_id",
    paymentMandateId: "payment_mandate_id",
    occurredAt: "occurred_at",
    amount: "amount",
    currency: "currency",
    meta: "meta"
  };

  return { entityName, fieldMap };
}

async function findExistingId(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]?.id) return existing[0].id;
  return null;
}

export async function isRevenueExternalIdSettled(base44, cfg, revenueExternalId) {
  const id = String(revenueExternalId ?? "").trim();
  if (!id) return false;
  const entity = base44.asServiceRole.entities[cfg.entityName];
  const map = cfg.fieldMap;
  const existingId = await findExistingId(entity, { [map.revenueExternalId]: id });
  return !!existingId;
}

export async function markRevenueSettledIdempotent(
  base44,
  cfg,
  { revenueExternalId, paymentMandateId, occurredAt, amount, currency, meta = null }
) {
  const id = String(revenueExternalId ?? "").trim();
  if (!id) throw new Error("revenueExternalId is required");
  const entity = base44.asServiceRole.entities[cfg.entityName];
  const map = cfg.fieldMap;

  const filter = { [map.revenueExternalId]: id };
  const existingId = await findExistingId(entity, filter);
  if (existingId) return { id: existingId, deduped: true };

  const data = {
    [map.revenueExternalId]: id,
    [map.paymentMandateId]: paymentMandateId ?? null,
    [map.occurredAt]: occurredAt ?? new Date().toISOString(),
    [map.amount]: amount ?? null,
    [map.currency]: currency ?? null,
    ...(meta != null ? { [map.meta]: meta } : {})
  };

  try {
    return await entity.create(data);
  } catch (err) {
    const racedId = await findExistingId(entity, filter).catch(() => null);
    if (racedId) return { id: racedId, deduped: true };
    throw err;
  }
}

