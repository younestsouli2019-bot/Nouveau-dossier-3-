import { buildBase44ServiceClient } from "./base44-client.mjs";
import { getPayPalAccessToken } from "./paypal-api.mjs";
import { maybeSendAlert } from "./alerts.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function getIntervalMs() {
  const raw = process.env.HEALTH_INTERVAL_MS ?? "30000";
  const ms = Number(raw);
  if (!ms || Number.isNaN(ms) || ms < 1000) return 30000;
  return ms;
}

function getHealthEntityConfig() {
  return {
    entity: process.env.BASE44_HEALTH_ENTITY ?? "SystemHealth",
    fieldMap: {
      at: process.env.BASE44_HEALTH_FIELD_AT ?? "at",
      ok: process.env.BASE44_HEALTH_FIELD_OK ?? "ok",
      paypalOk: process.env.BASE44_HEALTH_FIELD_PAYPAL_OK ?? "paypal_ok",
      base44Ok: process.env.BASE44_HEALTH_FIELD_BASE44_OK ?? "base44_ok",
      details: process.env.BASE44_HEALTH_FIELD_DETAILS ?? "details"
    }
  };
}

async function writeHealth(base44, cfg, payload) {
  const map = cfg.fieldMap;
  const entity = base44.asServiceRole.entities[cfg.entity];
  const data = {
    [map.at]: payload.at,
    [map.ok]: payload.ok,
    [map.paypalOk]: payload.paypalOk,
    [map.base44Ok]: payload.base44Ok,
    [map.details]: payload.details
  };
  return entity.create(data);
}

async function checkBase44(base44) {
  try {
    const entityName = process.env.BASE44_HEALTH_PING_ENTITY ?? "RevenueEvent";
    const entity = base44.asServiceRole.entities[entityName];
    await entity.list("-created_date", 1, 0, ["id"]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function checkPayPal() {
  try {
    const token = await getPayPalAccessToken();
    if (!token) return { ok: false, error: "Missing token" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function main() {
  const base44 = buildBase44ServiceClient();
  const cfg = getHealthEntityConfig();

  const intervalMs = getIntervalMs();
  const enableWrite = (process.env.BASE44_ENABLE_HEALTH_WRITE ?? "false").toLowerCase() === "true";
  const enableAlerts = (process.env.BASE44_ENABLE_ALERTS ?? "false").toLowerCase() === "true";

  process.stdout.write(`${JSON.stringify({ ok: true, monitoring: true, intervalMs })}\n`);

  let lastAlertAt = 0;
  const alertCooldownMs = Number(process.env.ALERT_COOLDOWN_MS ?? "900000") || 900000;

  while (true) {
    const at = nowIso();
    const paypal = await checkPayPal();
    const base44Ping = await checkBase44(base44);

    const payload = {
      at,
      ok: paypal.ok && base44Ping.ok,
      paypalOk: paypal.ok,
      base44Ok: base44Ping.ok,
      details: {
        paypal: paypal.ok ? "ok" : paypal.error,
        base44: base44Ping.ok ? "ok" : base44Ping.error
      }
    };

    if (enableWrite) {
      await writeHealth(base44, cfg, payload);
    }

    process.stdout.write(`${JSON.stringify({ ok: true, health: payload })}\n`);

    if (enableAlerts && !payload.ok) {
      const now = Date.now();
      if (now - lastAlertAt >= alertCooldownMs) {
        lastAlertAt = now;
        await maybeSendAlert(base44, {
          subject: "Swarm Health Alert",
          body: JSON.stringify(payload, null, 2)
        });
      }
    }

    await sleep(intervalMs);
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});

