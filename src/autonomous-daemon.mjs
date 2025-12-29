import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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

function nowIso() {
  return new Date().toISOString();
}

function getEnvBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function envIsTrue(value, fallback = "true") {
  return String(value ?? fallback).toLowerCase() === "true";
}

function isPlaceholderValue(value) {
  if (value == null) return true;
  const v = String(value).trim();
  if (!v) return true;
  if (/^\s*<\s*YOUR_[A-Z0-9_]+\s*>\s*$/i.test(v)) return true;
  if (/^\s*YOUR_[A-Z0-9_]+\s*$/i.test(v)) return true;
  if (/^\s*(REPLACE_ME|CHANGEME|TODO)\s*$/i.test(v)) return true;
  return false;
}

function requireRealEnv(name) {
  const v = process.env[name];
  if (isPlaceholderValue(v)) throw new Error(`LIVE MODE NOT GUARANTEED (missing/placeholder env: ${name})`);
  return String(v);
}

function isUnsafePath(p) {
  const abs = path.resolve(process.cwd(), String(p ?? ""));
  const lower = abs.toLowerCase();
  const tmp = os.tmpdir().toLowerCase();
  if (tmp && lower.startsWith(tmp)) return true;
  const needles = ["\\test\\", "/test/", "\\mock\\", "/mock/", "\\tmp\\", "/tmp/", "\\temp\\", "/temp/"];
  return needles.some((n) => lower.includes(n));
}

function enforceSwarmLiveHardInvariant({ component, action }) {
  if (!envIsTrue(process.env.SWARM_LIVE, "false")) {
    throw new Error(`LIVE MODE NOT GUARANTEED (${component} ${action})`);
  }
  return { forced: false };
}

function isMoneyMovingTasks(cfg) {
  const t = cfg?.tasks ?? {};
  return (
    t.createPayoutBatches === true ||
    t.autoApprovePayoutBatches === true ||
    t.autoSubmitPayPalPayoutBatches === true ||
    t.autoExportPayoneerPayoutBatches === true ||
    t.syncPayPalLedgerBatches === true
  );
}

function verifyNoSandboxPayPal() {
  const paypalMode = String(process.env.PAYPAL_MODE ?? "live").toLowerCase();
  const paypalBase = String(process.env.PAYPAL_API_BASE_URL ?? "").toLowerCase();
  if (paypalMode === "sandbox" || paypalBase.includes("sandbox.paypal.com")) {
    throw new Error("LIVE MODE NOT GUARANTEED (PayPal sandbox configured)");
  }
}

function isPayPalPayoutSendEnabled() {
  const override = process.env.AUTONOMOUS_ALLOW_PAYPAL_PAYOUTS ?? process.env.BASE44_ALLOW_PAYPAL_PAYOUTS ?? null;
  if (override != null && String(override).trim() !== "") return String(override).toLowerCase() === "true";

  const approved = String(process.env.PAYPAL_PPP2_APPROVED ?? process.env.PPP2_APPROVED ?? "false").toLowerCase() === "true";
  const enableSend =
    String(process.env.PAYPAL_PPP2_ENABLE_SEND ?? process.env.PPP2_ENABLE_SEND ?? "false").toLowerCase() === "true";
  return approved && enableSend;
}

function hasAllowedPayPalRecipientsConfigured() {
  const csv =
    process.env.AUTONOMOUS_ALLOWED_PAYPAL_RECIPIENTS ??
    process.env.BASE44_ALLOWED_PAYPAL_RECIPIENTS ??
    process.env.PAYOUT_ALLOWED_PAYPAL_RECIPIENTS ??
    null;
  if (csv != null && String(csv).trim() && !isPlaceholderValue(csv)) return true;

  const json = process.env.AUTONOMOUS_ALLOWED_PAYOUT_RECIPIENTS_JSON ?? process.env.BASE44_ALLOWED_PAYOUT_RECIPIENTS_JSON ?? null;
  if (json == null || !String(json).trim() || isPlaceholderValue(json)) return false;
  try {
    const parsed = JSON.parse(String(json));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const paypal = parsed.paypal ?? parsed.paypal_email ?? parsed.paypalEmail ?? [];
    return Array.isArray(paypal) && paypal.length > 0;
  } catch {
    return false;
  }
}

function validateDaemonLiveModeOrThrow(cfg) {
  if (!envIsTrue(process.env.SWARM_LIVE, "false")) throw new Error("LIVE MODE NOT GUARANTEED (SWARM_LIVE not true)");
  if (cfg?.offline?.enabled === true) throw new Error("LIVE MODE NOT GUARANTEED (offline enabled)");
  if (cfg?.payout?.dryRun === true) throw new Error("LIVE MODE NOT GUARANTEED (dry-run enabled)");
  requireRealEnv("BASE44_APP_ID");
  requireRealEnv("BASE44_SERVICE_TOKEN");

  if (
    cfg?.tasks?.createPayoutBatches === true ||
    cfg?.tasks?.autoApprovePayoutBatches === true ||
    cfg?.tasks?.autoSubmitPayPalPayoutBatches === true ||
    cfg?.tasks?.autoExportPayoneerPayoutBatches === true ||
    cfg?.tasks?.syncPayPalLedgerBatches === true
  ) {
    if (!envIsTrue(process.env.BASE44_ENABLE_PAYOUT_LEDGER_WRITE, "false")) {
      throw new Error("LIVE MODE NOT GUARANTEED (BASE44_ENABLE_PAYOUT_LEDGER_WRITE not true)");
    }
  }

  if (cfg?.tasks?.autoExportPayoneerPayoutBatches === true && isUnsafePath(cfg?.payout?.export?.payoneerOutDir ?? "")) {
    throw new Error("LIVE MODE NOT GUARANTEED (unsafe Payoneer out dir)");
  }
  if (cfg?.tasks?.autoSubmitPayPalPayoutBatches === true || cfg?.tasks?.syncPayPalLedgerBatches === true) {
    verifyNoSandboxPayPal();
    requireRealEnv("PAYPAL_CLIENT_ID");
    requireRealEnv("PAYPAL_CLIENT_SECRET");
  }
  if (cfg?.tasks?.autoSubmitPayPalPayoutBatches === true && !isPayPalPayoutSendEnabled()) {
    throw new Error("LIVE MODE NOT GUARANTEED (PayPal payouts not enabled; set PAYPAL_PPP2_APPROVED=true and PAYPAL_PPP2_ENABLE_SEND=true)");
  }
  if (cfg?.tasks?.autoSubmitPayPalPayoutBatches === true && !hasAllowedPayPalRecipientsConfigured()) {
    throw new Error(
      "LIVE MODE NOT GUARANTEED (missing owner allowlist; set AUTONOMOUS_ALLOWED_PAYPAL_RECIPIENTS or AUTONOMOUS_ALLOWED_PAYOUT_RECIPIENTS_JSON)"
    );
  }
}

function normalizeIntervalMs(value, fallback) {
  const ms = Number(value);
  if (!ms || Number.isNaN(ms) || ms < 1000) return fallback;
  return Math.floor(ms);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeHourUtc(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const h = Math.floor(n);
  if (h < 0 || h > 23) return fallback;
  return h;
}

function isWithinWindowUtc({ startHourUtc, endHourUtc }, at = new Date()) {
  const start = Number(startHourUtc ?? 0);
  const end = Number(endHourUtc ?? 0);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  const s = Math.floor(start);
  const e = Math.floor(end);
  if (s === e) return true;
  const h = at.getUTCHours();
  if (s < e) return h >= s && h < e;
  return h >= s || h < e;
}

async function readJsonFile(filePath, fallback) {
  try {
    const txt = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(String(txt));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const text = `${JSON.stringify(value)}\n`;
  await fs.writeFile(tmp, text, "utf8");
  try {
    await fs.rename(tmp, filePath);
  } catch {
    await fs.copyFile(tmp, filePath);
    await fs.unlink(tmp).catch(() => {});
  }
}

async function withTempEnv(pairs, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(pairs ?? {})) {
    prev[k] = process.env[k];
    if (v == null) {
      delete process.env[k];
    } else {
      process.env[k] = String(v);
    }
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function deepMerge(a, b) {
  if (!b || typeof b !== "object") return a;
  const out = Array.isArray(a) ? [...a] : { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) {
    const av = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && av && typeof av === "object" && !Array.isArray(av)) {
      out[k] = deepMerge(av, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseJsonMaybe(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  const s = String(value).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function getTransactionLogConfigFromEnv() {
  const entityName = process.env.BASE44_LEDGER_TRANSACTION_LOG_ENTITY ?? "TransactionLog";
  const mapFromEnv = parseJsonMaybe(process.env.BASE44_LEDGER_TRANSACTION_LOG_FIELD_MAP);
  const fieldMap = mapFromEnv ?? {
    transactionType: "transaction_type",
    amount: "amount",
    description: "description",
    transactionDate: "transaction_date",
    category: "category",
    paymentMethod: "payment_method",
    referenceId: "reference_id",
    status: "status",
    payoutBatchId: "payout_batch_id",
    payoutItemId: "payout_item_id"
  };
  return { entityName, fieldMap };
}

async function loadAutonomousConfig({ configPath }) {
  const resolved = configPath ? path.resolve(process.cwd(), String(configPath)) : path.resolve(process.cwd(), "autonomous.txt");
  const raw = await fs.readFile(resolved, "utf8").catch(() => "");
  const trimmed = String(raw).trim();
  if (!trimmed) return { configPath: resolved, config: {} };
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object") return { configPath: resolved, config: {} };
  return { configPath: resolved, config: parsed };
}

function defaultConfig() {
  return {
    intervalMs: 60000,
    offline: {
      enabled: false,
      auto: true,
      storePath: ".base44-offline-store.json"
    },
    health: {
      requirePayPal: false
    },
    deadman: {
      intervalMs: 300000,
      thresholds: {
        webhookSilenceHours: 4,
        metricFailureCount: 3,
        metricWindowMinutes: 30
      }
    },
    payout: {
      settlementId: null,
      beneficiary: null,
      recipientType: null,
      dryRun: true,
      minAvailableBalance: 0,
      windowUtc: { startHourUtc: 0, endHourUtc: 0 },
      syncPayPalLimit: 25,
      syncPayPalMinAgeMinutes: 10,
      export: {
        payoneerOutDir: "out/payoneer"
      },
      autoApprove: { enabled: false, pendingAgeMinutes: 120, maxBatchAmount: null, totp: null }
    },
    tasks: {
      health: true,
      missionHealth: false,
      availableBalance: true,
      reportPendingApproval: true,
      reportStuckPayouts: true,
      deadman: true,
      createPayoutBatches: false,
      autoApprovePayoutBatches: false,
      autoSubmitPayPalPayoutBatches: false,
      syncPayPalLedgerBatches: false,
      autoExportPayoneerPayoutBatches: false
    },
    alerts: {
      enabled: false,
      cooldownMs: 900000
    },
    missionHealth: {
      missionId: null,
      limit: 50
    },
    state: {
      path: ".autonomous-state.json"
    },
    backoff: {
      maxMs: 300000
    }
  };
}

function resolveRuntimeConfig(args, fileCfg) {
  const cfg = deepMerge(defaultConfig(), fileCfg ?? {});

  const intervalMs = normalizeIntervalMs(args["interval-ms"] ?? args.intervalMs ?? process.env.AUTONOMOUS_INTERVAL_MS, cfg.intervalMs);

  const offlineEnabled =
    args.offline === true ||
    getEnvBool("BASE44_OFFLINE", false) ||
    getEnvBool("BASE44_OFFLINE_MODE", false) ||
    getEnvBool("npm_config_offline", false) ||
    getEnvBool("NPM_CONFIG_OFFLINE", false) ||
    cfg.offline?.enabled === true;

  const offlineStorePath =
    args["offline-store"] ??
    args.offlineStore ??
    process.env.BASE44_OFFLINE_STORE_PATH ??
    cfg.offline?.storePath ??
    ".base44-offline-store.json";

  const offlineAuto = cfg.offline?.auto !== false;

  const payoutSettlementId = args["payout-settlement-id"] ?? process.env.PAYOUT_SETTLEMENT_ID ?? cfg.payout?.settlementId ?? null;
  const payoutBeneficiary = args["payout-beneficiary"] ?? process.env.PAYOUT_BENEFICIARY ?? cfg.payout?.beneficiary ?? null;
  const payoutRecipientType = args["payout-recipient-type"] ?? process.env.PAYOUT_RECIPIENT_TYPE ?? cfg.payout?.recipientType ?? null;

  const payoneerOutDir =
    args["payoneer-out-dir"] ??
    args.payoneerOutDir ??
    process.env.AUTONOMOUS_PAYONEER_OUT_DIR ??
    cfg.payout?.export?.payoneerOutDir ??
    "out/payoneer";

  const payoutDryRun =
    args["payout-live"] === true
      ? false
      : cfg.payout?.dryRun !== false && getEnvBool("AUTONOMOUS_PAYOUT_LIVE", false) !== true;

  const minAvailableBalance = normalizeNumber(
    args["min-available-balance"] ?? process.env.AUTONOMOUS_MIN_AVAILABLE_BALANCE ?? cfg.payout?.minAvailableBalance ?? 0,
    0
  );

  const startHourUtc = normalizeHourUtc(
    args["payout-window-start-utc"] ?? process.env.AUTONOMOUS_PAYOUT_WINDOW_START_UTC ?? cfg.payout?.windowUtc?.startHourUtc ?? 0,
    0
  );
  const endHourUtc = normalizeHourUtc(
    args["payout-window-end-utc"] ?? process.env.AUTONOMOUS_PAYOUT_WINDOW_END_UTC ?? cfg.payout?.windowUtc?.endHourUtc ?? 0,
    0
  );

  const syncPayPalLedgerEnabled =
    args["sync-paypal-ledger"] === true ||
    getEnvBool("AUTONOMOUS_SYNC_PAYPAL_LEDGER", false) ||
    cfg.tasks?.syncPayPalLedgerBatches === true;
  const syncPayPalLimit = normalizeNumber(
    args["sync-paypal-limit"] ?? process.env.AUTONOMOUS_SYNC_PAYPAL_LIMIT ?? cfg.payout?.syncPayPalLimit ?? 25,
    25
  );
  const syncPayPalMinAgeMinutes = normalizeNumber(
    args["sync-paypal-min-age-minutes"] ?? process.env.AUTONOMOUS_SYNC_PAYPAL_MIN_AGE_MINUTES ?? cfg.payout?.syncPayPalMinAgeMinutes ?? 10,
    10
  );

  const createPayoutBatchesEnabled =
    args["create-payout-batches"] === true ||
    args.createPayoutBatches === true ||
    getEnvBool("AUTONOMOUS_CREATE_PAYOUT_BATCHES", false) ||
    cfg.tasks?.createPayoutBatches === true;

  const autoApproveEnabled =
    args["auto-approve-payouts"] === true ||
    getEnvBool("AUTONOMOUS_AUTO_APPROVE_PAYOUTS", false) ||
    cfg.payout?.autoApprove?.enabled === true;
  const autoApprovePayoutBatchesEnabled =
    args["auto-approve-payout-batches"] === true ||
    args.autoApprovePayoutBatches === true ||
    autoApproveEnabled === true ||
    getEnvBool("AUTONOMOUS_AUTO_APPROVE_PAYOUT_BATCHES", false) ||
    cfg.tasks?.autoApprovePayoutBatches === true;
  const pendingAgeMinutes = normalizeNumber(
    args["auto-approve-age-minutes"] ?? process.env.AUTONOMOUS_AUTO_APPROVE_AGE_MINUTES ?? cfg.payout?.autoApprove?.pendingAgeMinutes ?? 120,
    120
  );
  const maxBatchAmount = normalizeNumber(
    args["auto-approve-max-batch-amount"] ?? process.env.AUTONOMOUS_AUTO_APPROVE_MAX_BATCH_AMOUNT ?? cfg.payout?.autoApprove?.maxBatchAmount ?? "",
    null
  );
  const totp = (args.totp ?? args["totp"] ?? process.env.AUTONOMOUS_PAYOUT_TOTP ?? null) || null;

  const requirePayPal =
    args["require-paypal"] === true ||
    (args["skip-paypal"] === true ? false : getEnvBool("AUTONOMOUS_REQUIRE_PAYPAL", cfg.health?.requirePayPal !== false));

  const alertsEnabled = getEnvBool("BASE44_ENABLE_ALERTS", false) || cfg.alerts?.enabled === true;
  const alertCooldownMs = normalizeIntervalMs(process.env.ALERT_COOLDOWN_MS ?? cfg.alerts?.cooldownMs, 900000);

  const missionHealthEnabled =
    args["mission-health"] === true || getEnvBool("AUTONOMOUS_MISSION_HEALTH", false) || cfg.tasks?.missionHealth === true;
  const missionHealthMissionId = args["mission-id"] ?? args.missionId ?? process.env.AUTONOMOUS_MISSION_ID ?? cfg.missionHealth?.missionId ?? null;
  const missionHealthLimit = normalizeNumber(
    args["mission-limit"] ?? args.missionLimit ?? process.env.AUTONOMOUS_MISSION_LIMIT ?? cfg.missionHealth?.limit ?? 50,
    50
  );

  const deadmanEnabled = args.deadman === true || getEnvBool("AUTONOMOUS_DEADMAN", cfg.tasks?.deadman !== false);
  const deadmanIntervalMs = normalizeIntervalMs(
    args["deadman-interval-ms"] ?? process.env.AUTONOMOUS_DEADMAN_INTERVAL_MS ?? cfg.deadman?.intervalMs,
    300000
  );
  const deadmanThresholds = (() => {
    const fromEnv = parseJsonMaybe(process.env.AUTONOMOUS_DEADMAN_THRESHOLDS_JSON);
    if (fromEnv && typeof fromEnv === "object" && !Array.isArray(fromEnv)) return fromEnv;
    return cfg.deadman?.thresholds ?? {};
  })();
  const webhookSilenceHours = normalizeNumber(deadmanThresholds.webhookSilenceHours ?? process.env.AUTONOMOUS_DEADMAN_WEBHOOK_SILENCE_HOURS, 4);
  const metricFailureCount = Math.max(
    1,
    Math.floor(normalizeNumber(deadmanThresholds.metricFailureCount ?? process.env.AUTONOMOUS_DEADMAN_METRIC_FAILURE_COUNT, 3))
  );
  const metricWindowMinutes = Math.max(
    1,
    Math.floor(normalizeNumber(deadmanThresholds.metricWindowMinutes ?? process.env.AUTONOMOUS_DEADMAN_METRIC_WINDOW_MINUTES, 30))
  );

  const statePath = args["state-path"] ?? args.statePath ?? process.env.AUTONOMOUS_STATE_PATH ?? cfg.state?.path ?? ".autonomous-state.json";
  const backoffMaxMs = normalizeIntervalMs(process.env.AUTONOMOUS_BACKOFF_MAX_MS ?? cfg.backoff?.maxMs, 300000);

  const autoSubmitPayPalPayoutBatchesEnabled =
    args["auto-submit-paypal"] === true ||
    args["auto-submit-paypal-payout-batches"] === true ||
    args.autoSubmitPayPalPayoutBatches === true ||
    getEnvBool("AUTONOMOUS_AUTO_SUBMIT_PAYPAL_PAYOUT_BATCHES", false) ||
    cfg.tasks?.autoSubmitPayPalPayoutBatches === true;

  const autoExportPayoneerPayoutBatchesEnabled =
    args["auto-export-payoneer"] === true ||
    args["auto-export-payoneer-payout-batches"] === true ||
    args.autoExportPayoneerPayoutBatches === true ||
    getEnvBool("AUTONOMOUS_AUTO_EXPORT_PAYONEER_PAYOUT_BATCHES", false) ||
    cfg.tasks?.autoExportPayoneerPayoutBatches === true;

  return {
    intervalMs,
    offline: { enabled: offlineEnabled, auto: offlineAuto, storePath: String(offlineStorePath) },
    health: { requirePayPal: requirePayPal === true },
    payout: {
      settlementId: payoutSettlementId ? String(payoutSettlementId) : null,
      beneficiary: payoutBeneficiary ? String(payoutBeneficiary) : null,
      recipientType: payoutRecipientType ? String(payoutRecipientType) : null,
      dryRun: payoutDryRun,
      minAvailableBalance: Number(minAvailableBalance ?? 0),
      windowUtc: { startHourUtc, endHourUtc },
      syncPayPalLimit: Number(syncPayPalLimit ?? 25),
      syncPayPalMinAgeMinutes: Number(syncPayPalMinAgeMinutes ?? 10),
      export: { payoneerOutDir: String(payoneerOutDir) },
      autoApprove: {
        enabled: autoApproveEnabled === true,
        pendingAgeMinutes: Number(pendingAgeMinutes ?? 120),
        maxBatchAmount: maxBatchAmount == null ? null : Number(maxBatchAmount),
        totp: totp == null ? null : String(totp)
      }
    },
    deadman: {
      intervalMs: deadmanIntervalMs,
      thresholds: { webhookSilenceHours, metricFailureCount, metricWindowMinutes }
    },
    tasks: {
      health: cfg.tasks?.health !== false,
      missionHealth: missionHealthEnabled === true,
      availableBalance: cfg.tasks?.availableBalance !== false,
      reportPendingApproval: cfg.tasks?.reportPendingApproval !== false,
      reportStuckPayouts: cfg.tasks?.reportStuckPayouts !== false,
      deadman: deadmanEnabled === true,
      createPayoutBatches: createPayoutBatchesEnabled === true,
      autoApprovePayoutBatches: autoApprovePayoutBatchesEnabled === true,
      autoSubmitPayPalPayoutBatches: autoSubmitPayPalPayoutBatchesEnabled === true,
      syncPayPalLedgerBatches: syncPayPalLedgerEnabled === true,
      autoExportPayoneerPayoutBatches: autoExportPayoneerPayoutBatchesEnabled === true
    },
    alerts: { enabled: alertsEnabled, cooldownMs: alertCooldownMs },
    missionHealth: {
      missionId: missionHealthMissionId ? String(missionHealthMissionId) : null,
      limit: Number(missionHealthLimit ?? 50)
    },
    state: { path: String(statePath) },
    backoff: { maxMs: backoffMaxMs }
  };
}

async function runNodeScript(scriptRelPath, scriptArgs, { env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptRelPath, ...scriptArgs], {
      cwd: process.cwd(),
      env: { ...process.env, ...(env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let lastJson = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          lastJson = JSON.parse(lines[i]);
          break;
        } catch {}
      }
      resolve({ code: Number(code ?? 1), stdout, stderr, lastJson });
    });
  });
}

function inferOfflineRetry(errText) {
  const t = String(errText ?? "");
  const needles = [
    "ENOTFOUND",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "fetch failed",
    "network",
    "socket hang up",
    "Missing required env var: BASE44_APP_ID",
    "Missing required env var: BASE44_SERVICE_TOKEN",
    "Base44 client not configured"
  ];
  return needles.some((n) => t.includes(n));
}

async function runEmit(commandArgs, { offline, offlineStorePath }) {
  const env = {};
  const args = [];

  if (offline) {
    env.BASE44_OFFLINE = "true";
    env.BASE44_OFFLINE_STORE_PATH = String(offlineStorePath);
    args.push("--offline", "--offline-store", String(offlineStorePath));
  }

  args.push(...commandArgs);
  const res = await runNodeScript("./src/emit-revenue-events.mjs", args, { env });
  if (res.code === 0 && res.lastJson) return { ok: true, result: res.lastJson };

  const errJson = res.lastJson && res.lastJson.ok === false ? res.lastJson : null;
  const msg = errJson?.error ?? res.stderr ?? res.stdout ?? "";
  return { ok: false, error: String(msg).trim() || "emit command failed", raw: { code: res.code, lastJson: res.lastJson } };
}

async function runEmitWithOfflineFallback(commandArgs, cfg) {
  const primary = await runEmit(commandArgs, { offline: cfg.offline.enabled, offlineStorePath: cfg.offline.storePath });
  if (primary.ok) return { mode: cfg.offline.enabled ? "offline" : "online", ...primary };

  if (!cfg.offline.enabled && cfg.offline.auto && inferOfflineRetry(primary.error)) {
    const fallback = await runEmit(commandArgs, { offline: true, offlineStorePath: cfg.offline.storePath });
    return { mode: fallback.ok ? "offline" : "online", ...fallback, fallbackAttempted: true, primaryError: primary.error };
  }

  return { mode: cfg.offline.enabled ? "offline" : "online", ...primary };
}

async function runMonitorHealth(commandArgs, { offline, offlineStorePath }) {
  const env = {};
  const args = [];
  if (offline) {
    env.BASE44_OFFLINE = "true";
    env.BASE44_OFFLINE_STORE_PATH = String(offlineStorePath);
    args.push("--offline", "--offline-store", String(offlineStorePath));
  }
  env.BASE44_ENABLE_MISSION_HEALTH_WRITE = "true";
  args.push(...commandArgs);
  const res = await runNodeScript("./src/monitor-health.mjs", args, { env });
  if (res.code === 0 && res.lastJson) return { ok: true, result: res.lastJson };

  const errJson = res.lastJson && res.lastJson.ok === false ? res.lastJson : null;
  const msg = errJson?.error ?? res.stderr ?? res.stdout ?? "";
  return { ok: false, error: String(msg).trim() || "monitor-health command failed", raw: { code: res.code, lastJson: res.lastJson } };
}

async function runMonitorHealthWithOfflineFallback(commandArgs, cfg) {
  const primary = await runMonitorHealth(commandArgs, { offline: cfg.offline.enabled, offlineStorePath: cfg.offline.storePath });
  if (primary.ok) return { mode: cfg.offline.enabled ? "offline" : "online", ...primary };

  if (!cfg.offline.enabled && cfg.offline.auto && inferOfflineRetry(primary.error)) {
    const fallback = await runMonitorHealth(commandArgs, { offline: true, offlineStorePath: cfg.offline.storePath });
    return { mode: fallback.ok ? "offline" : "online", ...fallback, fallbackAttempted: true, primaryError: primary.error };
  }

  return { mode: cfg.offline.enabled ? "offline" : "online", ...primary };
}

async function checkHealthOnce(cfg) {
  let mode = cfg.offline.enabled ? "offline" : "auto";

  let paypalOk = false;
  let paypalErr = null;
  const wantPayPal = cfg.health?.requirePayPal === true;
  if (!wantPayPal) {
    paypalOk = true;
    paypalErr = "skipped";
  } else {
    try {
      const token = await getPayPalAccessToken();
      paypalOk = !!token;
      if (!token) paypalErr = "Missing token";
    } catch (e) {
      paypalOk = false;
      paypalErr = e?.message ?? String(e);
    }
  }

  let base44Ok = false;
  let base44Err = null;
  const base44Attempt = async () => {
    const base44 = buildBase44ServiceClient({ mode });
    const entityName = process.env.BASE44_HEALTH_PING_ENTITY ?? "RevenueEvent";
    const entity = base44.asServiceRole.entities[entityName];
    await entity.list("-created_date", 1, 0, ["id"]);
  };

  try {
    await withTempEnv(
      cfg.offline.enabled ? { BASE44_OFFLINE: "true", BASE44_OFFLINE_STORE_PATH: cfg.offline.storePath } : {},
      base44Attempt
    );
    base44Ok = true;
  } catch (e) {
    base44Ok = false;
    base44Err = e?.message ?? String(e);
  }

  if (!base44Ok && !cfg.offline.enabled && cfg.offline.auto && inferOfflineRetry(base44Err)) {
    try {
      mode = "offline";
      await withTempEnv({ BASE44_OFFLINE: "true", BASE44_OFFLINE_STORE_PATH: cfg.offline.storePath }, base44Attempt);
      base44Ok = true;
      base44Err = null;
    } catch (e2) {
      base44Ok = false;
      base44Err = e2?.message ?? String(e2);
    }
  }

  const payload = {
    at: nowIso(),
    ok: paypalOk && base44Ok,
    paypalOk,
    base44Ok,
    details: {
      paypal: paypalOk ? "ok" : paypalErr,
      base44: base44Ok ? "ok" : base44Err,
      base44Mode: mode
    }
  };

  return payload;
}

async function maybeAlertOnFailure(cfg, health, state) {
  if (!cfg.alerts.enabled) return;
  if (health.ok) return;
  const now = Date.now();
  if (now - state.lastAlertAt < cfg.alerts.cooldownMs) return;
  state.lastAlertAt = now;

  try {
    const mode = cfg.offline.enabled ? "offline" : "auto";
    await withTempEnv(
      cfg.offline.enabled ? { BASE44_OFFLINE: "true", BASE44_OFFLINE_STORE_PATH: cfg.offline.storePath } : {},
      async () => {
        const base44 = buildBase44ServiceClient({ mode });
        await maybeSendAlert(base44, {
          subject: "Swarm Autonomous Alert",
          body: JSON.stringify(health, null, 2)
        });
      }
    );
  } catch {}
}

async function maybeAlertOnAutoApproval(cfg, summary, state) {
  if (!cfg.alerts.enabled) return;
  if (!summary || summary.ok === true) return;
  const now = Date.now();
  if (now - state.lastApprovalAlertAt < cfg.alerts.cooldownMs) return;
  state.lastApprovalAlertAt = now;

  try {
    const mode = cfg.offline.enabled ? "offline" : "auto";
    await withTempEnv(
      cfg.offline.enabled ? { BASE44_OFFLINE: "true", BASE44_OFFLINE_STORE_PATH: cfg.offline.storePath } : {},
      async () => {
        const base44 = buildBase44ServiceClient({ mode });
        await maybeSendAlert(base44, { subject: "Swarm Auto-Approval Needs Review", body: JSON.stringify(summary, null, 2) });
      }
    );
  } catch {}
}

function getBatchId(rec) {
  return rec?.batch_id ?? rec?.batchId ?? rec?.batch ?? null;
}

function getBatchAmount(rec) {
  const v = rec?.total_amount ?? rec?.totalAmount ?? rec?.amount ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getBatchCreatedAtMs(rec) {
  const v = rec?.created_date ?? rec?.createdAt ?? rec?.created_at ?? null;
  const ms = Date.parse(String(v ?? ""));
  return Number.isNaN(ms) ? null : ms;
}

function effectiveOk(result) {
  if (!result || typeof result !== "object") return false;
  if (result.ok !== true) return false;
  const innerOk = result.result?.ok;
  if (innerOk === false) return false;
  return true;
}

function isFreezeActive(state) {
  return state?.freeze?.active === true;
}

function freezeSkip(state, reason, extra = null) {
  const base = { ok: true, skipped: true, reason, freeze: state?.freeze ?? { active: true } };
  if (!extra || typeof extra !== "object") return base;
  return { ...base, ...extra };
}

function parseMaybeDateMs(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isNaN(ms) ? null : ms;
}

async function deadmanFetchLastWebhook(base44) {
  const entityName = process.env.BASE44_PAYPAL_EVENT_ENTITY ?? "PayPalWebhookEvent";
  const entity = base44.asServiceRole.entities[entityName];
  const fields = ["id", "created_date", "created_at", "event_id", "event_type"];
  const rows = await entity.list("-created_date", 1, 0, fields);
  const rec = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const at = rec?.created_at ?? rec?.created_date ?? null;
  const atMs = parseMaybeDateMs(at);
  return rec && atMs != null
    ? { ok: true, atMs, atRaw: at, eventId: rec?.event_id ?? null, eventType: rec?.event_type ?? null }
    : { ok: false };
}

async function deadmanFetchRecentMetrics(base44, limit = 25) {
  const entityName = process.env.BASE44_PAYPAL_METRIC_ENTITY ?? "PayPalMetric";
  const entity = base44.asServiceRole.entities[entityName];
  const mapFromEnv = parseJsonMaybe(process.env.BASE44_PAYPAL_METRIC_FIELD_MAP);
  const fieldMap = mapFromEnv ?? { at: "at", kind: "kind", ok: "ok", summary: "summary" };
  const fields = ["id", "created_date", fieldMap.at, fieldMap.kind, fieldMap.ok, fieldMap.summary].filter(Boolean);
  const rows = await entity.list("-created_date", Math.max(1, Math.floor(Number(limit ?? 25))), 0, fields);
  return { fieldMap, rows: Array.isArray(rows) ? rows : [] };
}

function computeDeadmanViolations({ lastWebhook, metrics, cfg, nowMs }) {
  const violations = [];
  const thresholds = cfg.deadman?.thresholds ?? {};

  if (lastWebhook?.ok === true) {
    const hoursSilent = (nowMs - lastWebhook.atMs) / (1000 * 60 * 60);
    if (Number.isFinite(hoursSilent) && hoursSilent > Number(thresholds.webhookSilenceHours ?? 4)) {
      violations.push({
        type: "webhook_silence",
        severity: "critical",
        message: `No PayPal webhooks for ${hoursSilent.toFixed(2)} hours`,
        lastWebhookAt: lastWebhook.atRaw,
        lastWebhookEventId: lastWebhook.eventId ?? null,
        lastWebhookEventType: lastWebhook.eventType ?? null
      });
    }
  } else {
    violations.push({ type: "webhook_missing", severity: "high", message: "No PayPal webhooks observed" });
  }

  const windowMinutes = Number(thresholds.metricWindowMinutes ?? 30);
  const windowMs = Math.max(1, windowMinutes) * 60 * 1000;
  const failureCountThreshold = Math.max(1, Math.floor(Number(thresholds.metricFailureCount ?? 3)));
  const { fieldMap, rows } = metrics ?? { fieldMap: { at: "at", kind: "kind", ok: "ok" }, rows: [] };
  const withinWindow = rows.filter((r) => {
    const at = r?.[fieldMap.at] ?? r?.created_date ?? null;
    const atMs = parseMaybeDateMs(at);
    return atMs != null && nowMs - atMs <= windowMs;
  });

  let consecutiveFailures = 0;
  for (const r of withinWindow) {
    const ok = r?.[fieldMap.ok];
    const isOk = ok === true || String(ok).toLowerCase() === "true";
    if (isOk) break;
    consecutiveFailures += 1;
  }

  if (consecutiveFailures >= failureCountThreshold) {
    const kinds = withinWindow.slice(0, consecutiveFailures).map((r) => r?.[fieldMap.kind] ?? null).filter(Boolean);
    violations.push({
      type: "paypal_metric_failures",
      severity: "critical",
      message: `${consecutiveFailures} consecutive PayPal metrics failures within ${windowMinutes} minutes`,
      kinds
    });
  }

  return violations;
}

async function recordFreezeIncident(base44, violations) {
  const txCfg = getTransactionLogConfigFromEnv();
  const txEntity = base44.asServiceRole.entities[txCfg.entityName];
  const now = nowIso();
  const desc = `Freeze: ${violations.map((v) => v.type).join(", ")}`;
  try {
    const created = await txEntity.create({
      [txCfg.fieldMap.transactionType]: "SYSTEM_INCIDENT",
      [txCfg.fieldMap.amount]: 0,
      [txCfg.fieldMap.description]: desc,
      [txCfg.fieldMap.transactionDate]: now,
      [txCfg.fieldMap.category]: "incident",
      [txCfg.fieldMap.paymentMethod]: "system",
      [txCfg.fieldMap.referenceId]: `deadman:${Date.now()}`,
      [txCfg.fieldMap.status]: "incident",
      violations
    });
    return { ok: true, id: created?.id ?? null };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function summarizeMissionHealthForFreeze(res) {
  const outerOk = effectiveOk(res);
  if (!outerOk) {
    return {
      ok: false,
      violations: [
        { type: "mission_health_failed", severity: "critical", message: res?.error ?? res?.result?.error ?? "Mission health check failed" }
      ]
    };
  }

  const results = res?.result?.results;
  const list = Array.isArray(results) ? results : [];
  const violations = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    if (r.ok !== true) {
      violations.push({
        type: "mission_health_error",
        severity: "critical",
        message: r.error ?? "Mission health error",
        missionId: r.missionId ?? null
      });
      continue;
    }
    if (r.deployable !== true) {
      violations.push({
        type: "mission_not_deployable",
        severity: "critical",
        message: "Mission is not deployable under evidence-gated health",
        missionId: r.missionId ?? null,
        classKey: r.classKey ?? null,
        healthScore: r.healthScore ?? null
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

async function maybeActivateFreezeFromMissionHealth(cfg, state, missionHealthRes) {
  if (!envIsTrue(process.env.SWARM_LIVE, "false")) return { ok: true, skipped: true, reason: "not_live" };
  if (cfg.offline.enabled) return { ok: true, skipped: true, reason: "offline_mode" };

  const summary = summarizeMissionHealthForFreeze(missionHealthRes);
  if (summary.ok) return { ok: true, violations: [] };

  const now = nowIso();
  const previous = state.freeze?.active === true;
  const nextViolations = summary.violations;
  state.freeze = {
    active: true,
    since: previous && state.freeze?.since ? state.freeze.since : now,
    violations: nextViolations,
    source: "mission_health",
    updatedAt: now
  };

  let incident = null;
  try {
    const base44 = buildBase44ServiceClient({ mode: "auto" });
    incident = await recordFreezeIncident(base44, nextViolations);
    if (cfg.alerts.enabled) {
      try {
        await maybeSendAlert(base44, {
          subject: "Swarm Freeze Activated (Mission Health)",
          body: JSON.stringify({ at: now, violations: nextViolations, incident }, null, 2)
        });
      } catch {}
    }
  } catch {}

  return { ok: false, freeze: true, violations: nextViolations, incident };
}

async function runDeadmanOnce(cfg, state) {
  const nowMs = Date.now();
  const lastAt = Number(state.lastDeadmanAt ?? 0) || 0;
  const intervalMs = Number(cfg.deadman?.intervalMs ?? 300000) || 300000;
  if (nowMs - lastAt < intervalMs) {
    return { ok: true, skipped: true, reason: "interval", nextInMs: Math.max(0, intervalMs - (nowMs - lastAt)) };
  }
  state.lastDeadmanAt = nowMs;

  if (!envIsTrue(process.env.SWARM_LIVE, "false")) return { ok: true, skipped: true, reason: "not_live" };
  if (cfg.offline.enabled) return { ok: true, skipped: true, reason: "offline_mode" };

  let base44 = null;
  try {
    base44 = buildBase44ServiceClient({ mode: "auto" });
  } catch (e) {
    return { ok: true, skipped: true, reason: "base44_unavailable", error: e?.message ?? String(e) };
  }

  const [lastWebhook, metrics] = await Promise.all([
    deadmanFetchLastWebhook(base44).catch((e) => ({ ok: false, error: e?.message ?? String(e) })),
    deadmanFetchRecentMetrics(base44, 25).catch((e) => ({
      fieldMap: { at: "at", kind: "kind", ok: "ok" },
      rows: [],
      error: e?.message ?? String(e)
    }))
  ]);

  const violations = computeDeadmanViolations({ lastWebhook, metrics, cfg, nowMs });
  if (violations.length === 0) return { ok: true, at: nowIso(), violations: [] };

  state.freeze = { active: true, since: nowIso(), violations };
  const incident = await recordFreezeIncident(base44, violations);
  if (cfg.alerts.enabled) {
    try {
      await maybeSendAlert(base44, { subject: "Swarm Deadman Freeze Activated", body: JSON.stringify({ at: nowIso(), violations, incident }, null, 2) });
    } catch {}
  }
  return { ok: false, at: nowIso(), violations, freeze: true, incident };
}

async function recordDeploymentOnce(cfg) {
  const mode = cfg.offline.enabled ? "offline" : "auto";
  const base44 = buildBase44ServiceClient({ mode });
  const txCfg = getTransactionLogConfigFromEnv();
  const txEntity = base44.asServiceRole.entities[txCfg.entityName];

  const fileList = [
    "package.json",
    "src/emit-revenue-events.mjs",
    "src/paypal-webhook-server.mjs",
    "src/autonomous-daemon.mjs",
    "src/monitor-health.mjs",
    "src/sbds-enforcer.mjs"
  ];

  const fileHashes = [];
  for (const rel of fileList) {
    const abs = path.resolve(process.cwd(), rel);
    const content = await fs.readFile(abs);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    fileHashes.push({ file: rel, sha256: hash });
  }
  fileHashes.sort((a, b) => a.file.localeCompare(b.file));

  const artifactHash = crypto.createHash("sha256").update(JSON.stringify(fileHashes)).digest("hex");
  const now = nowIso();
  const ref = `deploy:${artifactHash.slice(0, 12)}:${Date.now()}`;

  const created = await txEntity.create({
    [txCfg.fieldMap.transactionType]: "SYSTEM_DEPLOYMENT",
    [txCfg.fieldMap.amount]: 0,
    [txCfg.fieldMap.description]: `Deployment record ${artifactHash}`,
    [txCfg.fieldMap.transactionDate]: now,
    [txCfg.fieldMap.category]: "deployment",
    [txCfg.fieldMap.paymentMethod]: "system",
    [txCfg.fieldMap.referenceId]: ref,
    [txCfg.fieldMap.status]: "completed",
    metadata: {
      at: now,
      artifact_hash: artifactHash,
      file_hashes: fileHashes,
      truth_only_ui_enabled: getEnvBool("BASE44_ENABLE_TRUTH_ONLY_UI", false),
      sbds_policy_active: true,
      swarm_live: envIsTrue(process.env.SWARM_LIVE, "false")
    }
  });

  return { ok: true, artifactHash, referenceId: ref, id: created?.id ?? null, mode };
}

async function runAllGoodOnce(cfg, state) {
  const at = nowIso();
  const readinessEnv = cfg.offline.enabled
    ? { BASE44_OFFLINE: "true", BASE44_OFFLINE_STORE_PATH: String(cfg.offline.storePath) }
    : {};
  const readinessRes = await runNodeScript("./src/monitor-health.mjs", ["--readiness", "--ping"], { env: readinessEnv });
  const readiness = readinessRes.lastJson ?? { ok: false, error: "readiness_failed" };

  const missionArgs = ["--mission-health", "--once"];
  if (cfg.missionHealth?.missionId) missionArgs.push("--mission-id", String(cfg.missionHealth.missionId));
  if (cfg.missionHealth?.limit != null) missionArgs.push("--mission-limit", String(cfg.missionHealth.limit));
  const missionHealth = await runMonitorHealthWithOfflineFallback(missionArgs, cfg);

  const simulation = await runEmitWithOfflineFallback(["--check-simulation", "--scan-limit", "200"], cfg);
  const payoutTruth = await runEmitWithOfflineFallback(["--export-payout-truth", "--only-real", "--limit", "5"], cfg);

  const deadman = cfg.tasks.deadman ? await runDeadmanOnce(cfg, state) : { ok: true, skipped: true, reason: "disabled" };

  const missionFreeze = await maybeActivateFreezeFromMissionHealth(cfg, state, missionHealth).catch((e) => ({
    ok: false,
    error: e?.message ?? String(e)
  }));

  const mhSummary = summarizeMissionHealthForFreeze(missionHealth);
  const simulationOk = effectiveOk(simulation) && simulation?.result?.ok === true;
  const payoutTruthOk = effectiveOk(payoutTruth);
  const deadmanOk = deadman?.ok !== false;
  const readinessOk = readiness?.ok === true;
  const paypalOk = readiness?.ping?.paypalOk === true;
  const base44Ok = readiness?.ping?.base44Ok === true;
  const freezeActive = isFreezeActive(state) === true;
  const missionFreezeOk = missionFreeze?.ok !== false;

  const failures = [];
  if (!readinessOk) failures.push("readiness");
  if (!paypalOk) failures.push("paypal_ping");
  if (!base44Ok) failures.push("base44_ping");
  if (!mhSummary.ok) failures.push("mission_health");
  if (!simulationOk) failures.push("simulation_artifacts");
  if (!payoutTruthOk) failures.push("payout_truth");
  if (freezeActive) failures.push("freeze_active");
  if (!deadmanOk) failures.push("deadman");
  if (!missionFreezeOk) failures.push("freeze_activation");

  const ok =
    readinessOk &&
    paypalOk &&
    base44Ok &&
    mhSummary.ok === true &&
    simulationOk &&
    payoutTruthOk &&
    freezeActive !== true &&
    deadmanOk &&
    missionFreezeOk;

  return {
    ok,
    at,
    summary: {
      ok,
      failures,
      readinessOk,
      paypalOk,
      base44Ok,
      missionHealthOk: mhSummary.ok === true,
      simulationOk,
      payoutTruthOk,
      freezeActive,
      deadmanOk,
      missionFreezeOk
    },
    readiness,
    missionHealth,
    missionHealthSummary: mhSummary,
    simulation,
    payoutTruth,
    deadman,
    freeze: state.freeze ?? { active: false }
  };
}

async function runTick(cfg, state) {
  const startedAt = nowIso();
  const out = { ok: true, at: startedAt, mode: cfg.offline.enabled ? "offline" : "auto", results: {}, meta: {} };
  out.meta.policy = {
    truthOnlyUiEnabled: getEnvBool("BASE44_ENABLE_TRUTH_ONLY_UI", false),
    allowlists: {
      paypalConfigured: hasAllowedPayPalRecipientsConfigured()
    }
  };
  out.meta.freeze = state.freeze ?? { active: false };

  if (isMoneyMovingTasks(cfg)) {
    if (!envIsTrue(process.env.SWARM_LIVE, "false")) {
      throw new Error("LIVE MODE NOT GUARANTEED (SWARM_LIVE downgraded)");
    }
  }

  if (cfg.tasks.deadman) {
    out.results.deadman = await runDeadmanOnce(cfg, state);
    out.meta.freeze = state.freeze ?? out.meta.freeze;
  }

  if (cfg.tasks.health) {
    const health = await checkHealthOnce(cfg);
    out.results.health = health;
    await maybeAlertOnFailure(cfg, health, state);
  }

  if (cfg.tasks.missionHealth) {
    const args = ["--mission-health", "--once"];
    if (cfg.missionHealth?.missionId) args.push("--mission-id", String(cfg.missionHealth.missionId));
    if (cfg.missionHealth?.limit != null) args.push("--mission-limit", String(cfg.missionHealth.limit));
    out.results.missionHealth = await runMonitorHealthWithOfflineFallback(args, cfg);
    out.results.missionFreeze = await maybeActivateFreezeFromMissionHealth(cfg, state, out.results.missionHealth).catch((e) => ({
      ok: false,
      error: e?.message ?? String(e)
    }));
    out.meta.freeze = state.freeze ?? out.meta.freeze;
  }

  if (cfg.tasks.availableBalance) {
    out.results.availableBalance = await runEmitWithOfflineFallback(["--available-balance"], cfg);
  }

  if (cfg.tasks.reportPendingApproval) {
    out.results.pendingApproval = await runEmitWithOfflineFallback(["--report-pending-approval"], cfg);
  }

  if (cfg.tasks.reportStuckPayouts) {
    out.results.stuckPayouts = await runEmitWithOfflineFallback(["--report-stuck-payouts"], cfg);
  }

  if (cfg.tasks.createPayoutBatches) {
    if (isFreezeActive(state)) {
      out.results.createPayoutBatches = freezeSkip(state, "freeze_active");
    } else {
    const windowOk = isWithinWindowUtc(cfg.payout?.windowUtc ?? { startHourUtc: 0, endHourUtc: 0 });
    if (!windowOk) {
      out.results.createPayoutBatches = { ok: true, skipped: true, reason: "outside_payout_window_utc", windowUtc: cfg.payout?.windowUtc ?? null };
    } else {
      let bal = null;
      const balRes = out.results.availableBalance;
      if (effectiveOk(balRes)) bal = balRes.result;
      if (!bal && !cfg.tasks.availableBalance) {
        const fetched = await runEmitWithOfflineFallback(["--available-balance"], cfg);
        out.results.availableBalance = fetched;
        if (effectiveOk(fetched)) bal = fetched.result;
      }

      const avail = Number(bal?.availableBalance ?? "");
      if (Number.isFinite(cfg.payout?.minAvailableBalance) && Number.isFinite(avail) && avail < cfg.payout.minAvailableBalance) {
        out.results.createPayoutBatches = {
          ok: true,
          skipped: true,
          reason: "below_min_available_balance",
          availableBalance: avail,
          minAvailableBalance: cfg.payout.minAvailableBalance
        };
      } else {
        const args = [];
        if (cfg.payout.dryRun) args.push("--dry-run");
        args.push("--create-payout-batches");
        if (cfg.payout.settlementId) args.push("--payout-settlement-id", cfg.payout.settlementId);
        if (cfg.payout.beneficiary) args.push("--payout-beneficiary", cfg.payout.beneficiary);
        if (cfg.payout.recipientType) args.push("--payout-recipient-type", cfg.payout.recipientType);
        out.results.createPayoutBatches = await runEmitWithOfflineFallback(args, cfg);
      }
    }
    }
  }

  if (cfg.tasks.autoApprovePayoutBatches && cfg.payout?.autoApprove?.enabled === true) {
    if (isFreezeActive(state)) {
      out.results.autoApproval = freezeSkip(state, "freeze_active");
    } else {
    let pending = null;
    const pendingRes = out.results.pendingApproval;
    if (effectiveOk(pendingRes)) pending = pendingRes.result;
    if (!pending && !cfg.tasks.reportPendingApproval) {
      const fetched = await runEmitWithOfflineFallback(["--report-pending-approval"], cfg);
      out.results.pendingApproval = fetched;
      if (effectiveOk(fetched)) pending = fetched.result;
    }

    const batches = Array.isArray(pending?.batches) ? pending.batches : [];
    const nowMs = Date.now();
    const thresholdMs = Math.max(0, Number(cfg.payout.autoApprove.pendingAgeMinutes ?? 120)) * 60 * 1000;
    const twoFaThreshold = Number(process.env.PAYOUT_APPROVAL_2FA_THRESHOLD ?? "500");
    const approvals = [];
    const needsReview = [];

    for (const b of batches) {
      const batchId = getBatchId(b);
      const createdAtMs = getBatchCreatedAtMs(b);
      const amount = getBatchAmount(b);
      if (!batchId) continue;
      if (createdAtMs == null) {
        needsReview.push({ batchId, reason: "missing_created_date", amount });
        continue;
      }
      if (nowMs - createdAtMs < thresholdMs) continue;
      if (amount == null) {
        needsReview.push({ batchId, reason: "missing_amount" });
        continue;
      }
      if (Number.isFinite(twoFaThreshold) && twoFaThreshold > 0 && amount > twoFaThreshold) {
        needsReview.push({ batchId, reason: "above_2fa_threshold", amount, threshold: twoFaThreshold });
        continue;
      }
      if (cfg.payout.autoApprove.maxBatchAmount != null && amount != null && amount > cfg.payout.autoApprove.maxBatchAmount) {
        needsReview.push({ batchId, reason: "amount_above_max", amount, max: cfg.payout.autoApprove.maxBatchAmount });
        continue;
      }

      const approveArgs = [];
      if (cfg.payout.dryRun) approveArgs.push("--dry-run");
      approveArgs.push("--approve-payout-batch", "--batch-id", String(batchId));
      if (cfg.payout.autoApprove.totp) approveArgs.push("--totp", String(cfg.payout.autoApprove.totp));
      const res = await runEmitWithOfflineFallback(approveArgs, cfg);
      approvals.push({ batchId, res });
      if (!effectiveOk(res)) {
        needsReview.push({ batchId, reason: "approve_failed", error: res?.error ?? null });
      }
    }

    const summary = {
      ok: needsReview.length === 0,
      approvedCount: approvals.length - needsReview.filter((x) => x.reason === "approve_failed").length,
      attemptedCount: approvals.length,
      needsReviewCount: needsReview.length,
      needsReview
    };
    out.results.autoApproval = summary;
    await maybeAlertOnAutoApproval(cfg, summary, state);
    }
  }

  if (cfg.tasks.autoSubmitPayPalPayoutBatches) {
    if (isFreezeActive(state)) {
      out.results.autoSubmitPayPal = freezeSkip(state, "freeze_active");
    } else {
    const windowOk = isWithinWindowUtc(cfg.payout?.windowUtc ?? { startHourUtc: 0, endHourUtc: 0 });
    if (!windowOk) {
      out.results.autoSubmitPayPal = { ok: true, skipped: true, reason: "outside_payout_window_utc", windowUtc: cfg.payout?.windowUtc ?? null };
    } else if (cfg.tasks.health && out.results.health && out.results.health.paypalOk === false) {
      out.results.autoSubmitPayPal = { ok: true, skipped: true, reason: "paypal_unhealthy", health: out.results.health };
    } else if (cfg.payout?.dryRun) {
      out.results.autoSubmitPayPal = { ok: true, skipped: true, reason: "payout_dry_run_enabled" };
    } else {
      const repairLimit = Math.max(1, Math.floor(Number(cfg.payout?.repairTruthLimit ?? 250)));
      out.results.repairPayoutTruth = await runEmitWithOfflineFallback(["--repair-payout-truth", "--limit", String(repairLimit)], cfg);

      const approvedRes = await runEmitWithOfflineFallback(["--report-approved-batches"], cfg);
      out.results.approvedBatches = approvedRes;
      const batches = effectiveOk(approvedRes) ? (approvedRes.result?.batches ?? []) : [];
      const attempts = [];
      for (const b of Array.isArray(batches) ? batches : []) {
        const batchId = getBatchId(b);
        const notesRaw = b?.notes ?? b?.Notes ?? null;
        const notes = parseJsonMaybe(notesRaw) ?? notesRaw;
        const recipientType = String(notes?.recipient_type ?? notes?.recipientType ?? "").toLowerCase();
        const providerId = notes?.paypal_payout_batch_id ?? notes?.paypalPayoutBatchId ?? null;
        if (!batchId) continue;
        if (providerId) continue;
        if (recipientType && recipientType !== "paypal" && recipientType !== "paypal_email") continue;
        const res = await runEmitWithOfflineFallback(["--submit-payout-batch", "--batch-id", String(batchId)], cfg);
        attempts.push({ batchId, res });
      }
      const failures = attempts.filter((a) => !effectiveOk(a.res));
      out.results.autoSubmitPayPal = {
        ok: failures.length === 0,
        attemptedCount: attempts.length,
        failedCount: failures.length,
        failures,
        attempts
      };
    }
    }
  }

  if (cfg.tasks.autoExportPayoneerPayoutBatches) {
    if (isFreezeActive(state)) {
      out.results.autoExportPayoneer = freezeSkip(state, "freeze_active");
    } else {
    const windowOk = isWithinWindowUtc(cfg.payout?.windowUtc ?? { startHourUtc: 0, endHourUtc: 0 });
    if (!windowOk) {
      out.results.autoExportPayoneer = { ok: true, skipped: true, reason: "outside_payout_window_utc", windowUtc: cfg.payout?.windowUtc ?? null };
    } else {
      const approvedRes = await runEmitWithOfflineFallback(["--report-approved-batches"], cfg);
      out.results.approvedBatchesForPayoneer = approvedRes;
      const batches = effectiveOk(approvedRes) ? (approvedRes.result?.batches ?? []) : [];
      const attempts = [];
      const outDir = cfg.payout?.export?.payoneerOutDir ? String(cfg.payout.export.payoneerOutDir) : "out/payoneer";
      const absOutDir = path.resolve(process.cwd(), outDir);
      await fs.mkdir(absOutDir, { recursive: true });
      const exported = state.exportedPayoneerBatches && typeof state.exportedPayoneerBatches === "object" ? state.exportedPayoneerBatches : {};
      state.exportedPayoneerBatches = exported;

      for (const b of Array.isArray(batches) ? batches : []) {
        const batchId = getBatchId(b);
        const notesRaw = b?.notes ?? b?.Notes ?? null;
        const notes = parseJsonMaybe(notesRaw) ?? notesRaw;
        const recipientType = String(notes?.recipient_type ?? notes?.recipientType ?? "").toLowerCase();
        if (!batchId) continue;
        if (recipientType !== "payoneer" && recipientType !== "payoneer_id") continue;

        const outPath = path.join(absOutDir, `payoneer_payout_${String(batchId)}.csv`);
        const already = exported[String(batchId)]?.outPath ? String(exported[String(batchId)].outPath) : null;
        if (already && (await fileExists(already))) continue;
        if (!already && (await fileExists(outPath))) {
          exported[String(batchId)] = { outPath, exportedAt: nowIso() };
          continue;
        }

        const res = await runEmitWithOfflineFallback(["--export-payoneer-batch", "--batch-id", String(batchId), "--out", outPath], cfg);
        attempts.push({ batchId, outPath, res });
        if (effectiveOk(res)) {
          exported[String(batchId)] = { outPath, exportedAt: nowIso() };
        }
      }

      const failures = attempts.filter((a) => !effectiveOk(a.res));
      out.results.autoExportPayoneer = {
        ok: failures.length === 0,
        attemptedCount: attempts.length,
        failedCount: failures.length,
        failures,
        attempts
      };
    }
    }
  }

  if (cfg.tasks.syncPayPalLedgerBatches) {
    if (isFreezeActive(state)) {
      out.results.syncPayPalLedger = freezeSkip(state, "freeze_active");
    } else {
    if (cfg.tasks.health && out.results.health && out.results.health.paypalOk === false) {
      out.results.syncPayPalLedger = { ok: true, skipped: true, reason: "paypal_unhealthy", health: out.results.health };
    } else {
    const limit = Math.max(1, Math.floor(Number(cfg.payout?.syncPayPalLimit ?? 25)));
    const minAgeMs = Math.max(0, Number(cfg.payout?.syncPayPalMinAgeMinutes ?? 10)) * 60 * 1000;
    const truthArgs = [];
    if (cfg.payout.dryRun) truthArgs.push("--dry-run");
    truthArgs.push("--export-payout-truth", "--limit", String(limit));
    const truthRes = await runEmitWithOfflineFallback(truthArgs, cfg);
    out.results.payoutTruth = truthRes;

    const rows = effectiveOk(truthRes) ? (truthRes.result?.rows ?? []) : [];
    const nowMs = Date.now();
    const attempts = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const internalBatchId = r?.internalPayoutBatchId ?? null;
      const externalProviderId = r?.externalProviderId ?? null;
      const truthStatus = r?.truthStatus ?? null;
      if (!internalBatchId) continue;
      if (!externalProviderId || String(externalProviderId) === "NOT_SUBMITTED") continue;
      if (String(truthStatus) === "COMPLETED") continue;
      const lastAt = r?.lastProviderSyncAt ?? null;
      if (lastAt && minAgeMs > 0) {
        const ms = Date.parse(String(lastAt));
        if (!Number.isNaN(ms) && nowMs - ms < minAgeMs) continue;
      }

      const syncArgs = [];
      if (cfg.payout.dryRun) syncArgs.push("--dry-run");
      syncArgs.push("--sync-paypal-ledger-batch", "--batch-id", String(internalBatchId));
      const res = await runEmitWithOfflineFallback(syncArgs, cfg);
      attempts.push({ batchId: String(internalBatchId), res });
    }
    out.results.syncPayPalLedger = { ok: true, attemptedCount: attempts.length, attempts };
    }
    }
  }

  out.ok = true;
  if (cfg.tasks.health && out.results.health?.ok === false) out.ok = false;
  for (const v of Object.values(out.results)) {
    if (v && typeof v === "object" && v.ok === false) out.ok = false;
    if (v && typeof v === "object" && v.result?.ok === false) out.ok = false;
  }

  process.stdout.write(`${JSON.stringify(out)}\n`);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const once = args.once === true;

  const loaded = await loadAutonomousConfig({ configPath: args.config ?? args["config"] ?? null });
  let cfg = resolveRuntimeConfig(args, loaded.config);

  if (isMoneyMovingTasks(cfg)) {
    enforceSwarmLiveHardInvariant({ component: "autonomous-daemon", action: "startup" });
    validateDaemonLiveModeOrThrow(cfg);
    const health = await checkHealthOnce({
      ...cfg,
      health: { requirePayPal: cfg.health?.requirePayPal === true || cfg.tasks?.autoSubmitPayPalPayoutBatches === true || cfg.tasks?.syncPayPalLedgerBatches === true }
    });
    if (!health.ok) throw new Error("LIVE MODE NOT GUARANTEED (endpoints/credentials)");
  }

  const statePath = path.resolve(process.cwd(), cfg.state.path);
  const persisted = await readJsonFile(statePath, null);
  const state = {
    lastAlertAt: Number(persisted?.lastAlertAt ?? 0) || 0,
    lastApprovalAlertAt: Number(persisted?.lastApprovalAlertAt ?? 0) || 0,
    lastDeadmanAt: Number(persisted?.lastDeadmanAt ?? 0) || 0,
    consecutiveFailures: Number(persisted?.consecutiveFailures ?? 0) || 0,
    freeze: persisted?.freeze && typeof persisted.freeze === "object" ? persisted.freeze : { active: false },
    exportedPayoneerBatches: persisted?.exportedPayoneerBatches && typeof persisted.exportedPayoneerBatches === "object" ? persisted.exportedPayoneerBatches : {}
  };

  const allGood = args["all-good"] === true || args.allGood === true;
  if (args["record-deployment"] === true || args.recordDeployment === true) {
    const out = await recordDeploymentOnce(cfg);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }
  if (allGood) {
    const safeCfg = {
      ...cfg,
      tasks: {
        ...cfg.tasks,
        createPayoutBatches: false,
        autoApprovePayoutBatches: false,
        autoSubmitPayPalPayoutBatches: false,
        autoExportPayoneerPayoutBatches: false,
        syncPayPalLedgerBatches: false,
        health: true,
        missionHealth: true,
        deadman: true
      }
    };
    const out = await runAllGoodOnce(safeCfg, state);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exitCode = out.ok ? 0 : 2;
    await atomicWriteJson(statePath, {
      lastAlertAt: state.lastAlertAt,
      lastApprovalAlertAt: state.lastApprovalAlertAt,
      lastDeadmanAt: state.lastDeadmanAt,
      consecutiveFailures: state.consecutiveFailures,
      freeze: state.freeze,
      exportedPayoneerBatches: state.exportedPayoneerBatches,
      updatedAt: nowIso()
    }).catch(() => {});
    return;
  }

  process.stdout.write(`${JSON.stringify({ ok: true, daemon: true, once, configPath: loaded.configPath, cfg })}\n`);

  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
  });
  process.on("SIGTERM", () => {
    stop = true;
  });

  do {
    try {
      const out = await runTick(cfg, state);
      state.consecutiveFailures = out.ok ? 0 : state.consecutiveFailures + 1;
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (String(msg).includes("LIVE MODE NOT GUARANTEED")) {
        process.stderr.write(`${JSON.stringify({ ok: false, at: nowIso(), error: msg })}\n`);
        process.exitCode = 1;
        break;
      }
      process.stderr.write(`${JSON.stringify({ ok: false, at: nowIso(), error: e?.message ?? String(e) })}\n`);
      state.consecutiveFailures += 1;
    }
    await atomicWriteJson(statePath, {
      lastAlertAt: state.lastAlertAt,
      lastApprovalAlertAt: state.lastApprovalAlertAt,
      lastDeadmanAt: state.lastDeadmanAt,
      consecutiveFailures: state.consecutiveFailures,
      freeze: state.freeze,
      exportedPayoneerBatches: state.exportedPayoneerBatches,
      updatedAt: nowIso()
    }).catch(() => {});
    if (once) break;
    const base = Number(cfg.intervalMs);
    const max = Number(cfg.backoff?.maxMs ?? 300000);
    const exp = state.consecutiveFailures <= 0 ? 1 : Math.min(8, Math.pow(2, state.consecutiveFailures));
    const delay = Math.min(max, Math.max(1000, Math.floor(base * exp)));
    await sleep(delay);
  } while (!stop);
}

const selfPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isMain = argvPath && path.resolve(selfPath) === argvPath;

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
    process.exitCode = 1;
  });
}

export { resolveRuntimeConfig, isWithinWindowUtc };
