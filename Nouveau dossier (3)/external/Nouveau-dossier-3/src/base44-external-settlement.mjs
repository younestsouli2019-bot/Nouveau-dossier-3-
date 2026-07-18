function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

export function getExternalSettlementConfigFromEnv() {
  const entityName = process.env.BASE44_EXTERNAL_SETTLEMENT_ENTITY ?? "ExternalSettlement";
  const mapFromEnv = safeJsonParse(process.env.BASE44_EXTERNAL_SETTLEMENT_FIELD_MAP, null);

  const fieldMap = mapFromEnv ?? {
    settlementId: "settlement_id",
    periodStart: "period_start",
    periodEnd: "period_end",
    beneficiary: "beneficiary",
    currency: "currency",
    amount: "amount",
    status: "status",
    referenceId: "reference_id",
    items: "items",
    metadata: "metadata"
  };

  return { entityName, fieldMap };
}

async function findExistingId(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]?.id) return existing[0].id;
  return null;
}

function buildSettlementData(cfg, settlement) {
  const map = cfg.fieldMap;
  const settlementId = settlement.settlementId ?? settlement.settlement_id ?? null;
  if (!settlementId) throw new Error("External settlement requires settlementId");

  const amount = Number(settlement.amount);
  if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error("External settlement amount must be > 0");

  return {
    [map.settlementId]: String(settlementId),
    [map.periodStart]: settlement.periodStart ?? settlement.period_start ?? null,
    [map.periodEnd]: settlement.periodEnd ?? settlement.period_end ?? null,
    [map.beneficiary]: settlement.beneficiary ?? null,
    [map.currency]: settlement.currency ?? null,
    [map.amount]: amount,
    [map.status]: settlement.status ?? "issued",
    [map.referenceId]: settlement.referenceId ?? settlement.reference_id ?? null,
    [map.items]: Array.isArray(settlement.items) ? settlement.items : [],
    [map.metadata]: settlement.metadata ?? {}
  };
}

export async function createBase44ExternalSettlementIdempotent(
  base44,
  cfg,
  settlement,
  { dryRun = false } = {}
) {
  const data = buildSettlementData(cfg, settlement);
  if (dryRun) return { dryRun: true, entity: cfg.entityName, data };

  if (!base44) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  const enable = (process.env.BASE44_ENABLE_EXTERNAL_SETTLEMENT_WRITES ?? "false").toLowerCase() === "true";
  if (!enable) {
    throw new Error("Refusing to create external settlements without BASE44_ENABLE_EXTERNAL_SETTLEMENT_WRITES=true");
  }

  const entity = base44.asServiceRole.entities[cfg.entityName];
  const existingId = await findExistingId(entity, { [cfg.fieldMap.settlementId]: data[cfg.fieldMap.settlementId] });
  if (existingId) return { id: existingId, deduped: true };

  try {
    return await entity.create(data);
  } catch (err) {
    const racedId = await findExistingId(entity, { [cfg.fieldMap.settlementId]: data[cfg.fieldMap.settlementId] }).catch(
      () => null
    );
    if (racedId) return { id: racedId, deduped: true };
    throw err;
  }
}

