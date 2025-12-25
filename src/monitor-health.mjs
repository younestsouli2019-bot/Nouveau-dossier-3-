import { buildBase44ServiceClient } from "./base44-client.mjs";
import { getPayPalAccessToken } from "./paypal-api.mjs";
import { maybeSendAlert } from "./alerts.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function hasEnv(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== "";
}

function getEnvBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function canBuildBase44() {
  try {
    buildBase44ServiceClient();
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
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
  if (!hasEnv("PAYPAL_CLIENT_ID") || !hasEnv("PAYPAL_CLIENT_SECRET")) {
    return { ok: false, error: "Missing PayPal credentials (PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET)" };
  }
  try {
    const token = await getPayPalAccessToken();
    if (!token) return { ok: false, error: "Missing token" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function buildReadinessSummary() {
  const live = getEnvBool("SWARM_LIVE", false);
  const base44Build = canBuildBase44();
  const base44Configured = base44Build.ok;
  const paypalConfigured = hasEnv("PAYPAL_CLIENT_ID") && hasEnv("PAYPAL_CLIENT_SECRET");
  const webhookConfigured = hasEnv("PAYPAL_WEBHOOK_ID");
  const paypalMode = String(process.env.PAYPAL_MODE ?? "live").toLowerCase();
  const paypalApiBaseUrl = String(process.env.PAYPAL_API_BASE_URL ?? "");

  const flags = {
    BASE44_ENABLE_PAYPAL_WEBHOOK_WRITE: getEnvBool("BASE44_ENABLE_PAYPAL_WEBHOOK_WRITE", false),
    BASE44_ENABLE_REVENUE_FROM_PAYPAL: getEnvBool("BASE44_ENABLE_REVENUE_FROM_PAYPAL", false),
    BASE44_ENABLE_PAYPAL_PAYOUT_STATUS_WRITE: getEnvBool("BASE44_ENABLE_PAYPAL_PAYOUT_STATUS_WRITE", false),
    BASE44_ENABLE_PAYOUT_LEDGER_WRITE: getEnvBool("BASE44_ENABLE_PAYOUT_LEDGER_WRITE", false),
    BASE44_ENABLE_PAYPAL_METRICS: getEnvBool("BASE44_ENABLE_PAYPAL_METRICS", false)
  };

  const warnings = [];
  if (live && (paypalMode === "sandbox" || paypalApiBaseUrl.toLowerCase().includes("sandbox.paypal.com"))) {
    warnings.push("SWARM_LIVE=true but PayPal is configured for sandbox");
  }

  const missing = [];
  if (!live) missing.push("SWARM_LIVE");
  if (!paypalConfigured) missing.push("PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET");
  if (!webhookConfigured) missing.push("PAYPAL_WEBHOOK_ID");
  if (!base44Configured) missing.push("BASE44_APP_ID/BASE44_SERVICE_TOKEN");
  if (!flags.BASE44_ENABLE_REVENUE_FROM_PAYPAL) missing.push("BASE44_ENABLE_REVENUE_FROM_PAYPAL");

  const nextSteps = [];
  if (!live) nextSteps.push('PowerShell: $env:SWARM_LIVE="true"');
  if (!paypalConfigured) nextSteps.push("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
  if (!webhookConfigured) nextSteps.push("Set PAYPAL_WEBHOOK_ID");
  if (!base44Configured) nextSteps.push("Set BASE44_APP_ID and BASE44_SERVICE_TOKEN (BASE44_APP_ID accepts a Base44 app URL)");
  if (!flags.BASE44_ENABLE_REVENUE_FROM_PAYPAL) nextSteps.push('PowerShell: $env:BASE44_ENABLE_REVENUE_FROM_PAYPAL="true"');
  if (warnings.length) nextSteps.push('PowerShell: $env:PAYPAL_MODE="live" (or unset PAYPAL_API_BASE_URL sandbox)');

  return {
    ok: missing.length === 0,
    live,
    base44Configured,
    base44Error: base44Build.ok ? null : base44Build.error,
    paypalConfigured,
    webhookConfigured,
    paypalMode,
    paypalApiBaseUrl: paypalApiBaseUrl ? "(set)" : "(default)",
    flags,
    warnings,
    nextSteps,
    missing
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const once = args.once === true;
  const readiness = args.readiness === true || args["live-readiness"] === true;
  const ping = args.ping === true;

  const intervalMs = getIntervalMs();
  const enableWrite = (process.env.BASE44_ENABLE_HEALTH_WRITE ?? "false").toLowerCase() === "true";
  const enableAlerts = (process.env.BASE44_ENABLE_ALERTS ?? "false").toLowerCase() === "true";

  if (readiness) {
    const summary = buildReadinessSummary();
    if (!ping) {
      process.stdout.write(`${JSON.stringify({ ok: true, readiness: summary })}\n`, () => process.exit(0));
      return;
    }

    const at = nowIso();
    const paypal = await checkPayPal();
    let base44Client = null;
    let base44ClientErr = null;
    try {
      base44Client = buildBase44ServiceClient();
    } catch (e) {
      base44ClientErr = e?.message ?? String(e);
    }
    const base44Ping = base44Client ? await checkBase44(base44Client) : { ok: false, error: base44ClientErr ?? "Missing Base44 credentials" };
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        at,
        readiness: summary,
        ping: { paypalOk: paypal.ok, base44Ok: base44Ping.ok, details: { paypal: paypal.ok ? "ok" : paypal.error, base44: base44Ping.ok ? "ok" : base44Ping.error } }
      })}\n`,
      () => process.exit(0)
    );
    return;
  }

  const base44 = buildBase44ServiceClient();
  const cfg = getHealthEntityConfig();

  process.stdout.write(`${JSON.stringify({ ok: true, monitoring: true, intervalMs, once })}\n`);

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

    if (once) break;
    await sleep(intervalMs);
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
