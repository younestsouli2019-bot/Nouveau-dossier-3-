function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

export function getWorkLeaseConfigFromEnv() {
  const entityName = process.env.AP2_LEASE_ENTITY ?? "WorkLease";
  const mapFromEnv = safeJsonParse(process.env.AP2_LEASE_FIELD_MAP, null);

  const fieldMap = mapFromEnv ?? {
    key: "key",
    holder: "holder",
    claimedAt: "claimed_at",
    expiresAt: "expires_at",
    status: "status",
    meta: "meta"
  };

  return { entityName, fieldMap };
}

function parseTimeMs(value) {
  const t = Date.parse(String(value ?? ""));
  return Number.isNaN(t) ? null : t;
}

async function findExisting(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]?.id) return existing[0];
  return null;
}

export async function acquireWorkLease(
  base44,
  cfg,
  { key, holder, ttlMs = 60_000, now = () => Date.now(), meta = null } = {}
) {
  const k = String(key ?? "").trim();
  if (!k) throw new Error("Lease key is required");
  const h = String(holder ?? "").trim();
  if (!h) throw new Error("Lease holder is required");

  if (!base44) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  const entity = base44.asServiceRole.entities[cfg.entityName];
  const map = cfg.fieldMap;

  const existing = await findExisting(entity, { [map.key]: k });
  const nowMs = now();
  const claimedAtIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + Math.max(1000, Number(ttlMs) || 60_000)).toISOString();

  const desiredData = {
    [map.key]: k,
    [map.holder]: h,
    [map.claimedAt]: claimedAtIso,
    [map.expiresAt]: expiresAtIso,
    [map.status]: "CLAIMED",
    ...(meta != null ? { [map.meta]: meta } : {})
  };

  if (!existing) {
    try {
      const created = await entity.create(desiredData);
      return { acquired: true, id: created?.id ?? null, expiresAt: expiresAtIso, holder: h };
    } catch (err) {
      const raced = await findExisting(entity, { [map.key]: k }).catch(() => null);
      if (!raced?.id) throw err;
      const racedExpires = parseTimeMs(raced[map.expiresAt]);
      const racedHolder = raced[map.holder] ?? null;
      if (racedExpires != null && racedExpires > nowMs && racedHolder !== h) {
        return { acquired: false, id: raced.id, expiresAt: raced[map.expiresAt] ?? null, holder: racedHolder };
      }
      return { acquired: racedHolder === h, id: raced.id, expiresAt: raced[map.expiresAt] ?? null, holder: racedHolder };
    }
  }

  const expiresMs = parseTimeMs(existing[map.expiresAt]);
  const existingHolder = existing[map.holder] ?? null;
  const isExpired = expiresMs == null || expiresMs <= nowMs;

  if (!isExpired && existingHolder !== h) {
    return { acquired: false, id: existing.id, expiresAt: existing[map.expiresAt] ?? null, holder: existingHolder };
  }

  const updated = await entity.update(existing.id, desiredData);
  const updatedHolder = updated?.[map.holder] ?? desiredData[map.holder];
  const updatedExpires = updated?.[map.expiresAt] ?? desiredData[map.expiresAt];
  return { acquired: updatedHolder === h, id: updated?.id ?? existing.id, expiresAt: updatedExpires, holder: updatedHolder };
}

