import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
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

function normalizeIntervalMs(value, fallback) {
  const ms = Number(value);
  if (!ms || Number.isNaN(ms) || ms < 1000) return fallback;
  return Math.floor(ms);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    payout: {
      settlementId: null,
      beneficiary: null,
      recipientType: null,
      dryRun: true,
      minAvailableBalance: 0,
      windowUtc: { startHourUtc: 0, endHourUtc: 0 },
      syncPayPalLimit: 25,
      syncPayPalMinAgeMinutes: 10,
      autoApprove: { enabled: false, pendingAgeMinutes: 120, maxBatchAmount: null, totp: null }
    },
    tasks: {
      health: true,
      availableBalance: true,
      reportPendingApproval: true,
      reportStuckPayouts: true,
      createPayoutBatches: false,
      autoApprovePayoutBatches: false,
      autoSubmitPayPalPayoutBatches: false,
      syncPayPalLedgerBatches: false
    },
    alerts: {
      enabled: false,
      cooldownMs: 900000
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

  const autoApproveEnabled =
    args["auto-approve-payouts"] === true ||
    getEnvBool("AUTONOMOUS_AUTO_APPROVE_PAYOUTS", false) ||
    cfg.payout?.autoApprove?.enabled === true;
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

  const statePath = args["state-path"] ?? args.statePath ?? process.env.AUTONOMOUS_STATE_PATH ?? cfg.state?.path ?? ".autonomous-state.json";
  const backoffMaxMs = normalizeIntervalMs(process.env.AUTONOMOUS_BACKOFF_MAX_MS ?? cfg.backoff?.maxMs, 300000);

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
      autoApprove: {
        enabled: autoApproveEnabled === true,
        pendingAgeMinutes: Number(pendingAgeMinutes ?? 120),
        maxBatchAmount: maxBatchAmount == null ? null : Number(maxBatchAmount),
        totp: totp == null ? null : String(totp)
      }
    },
    tasks: {
      health: cfg.tasks?.health !== false,
      availableBalance: cfg.tasks?.availableBalance !== false,
      reportPendingApproval: cfg.tasks?.reportPendingApproval !== false,
      reportStuckPayouts: cfg.tasks?.reportStuckPayouts !== false,
      createPayoutBatches: cfg.tasks?.createPayoutBatches === true,
      autoApprovePayoutBatches: cfg.tasks?.autoApprovePayoutBatches === true,
      autoSubmitPayPalPayoutBatches: cfg.tasks?.autoSubmitPayPalPayoutBatches === true,
      syncPayPalLedgerBatches: syncPayPalLedgerEnabled === true
    },
    alerts: { enabled: alertsEnabled, cooldownMs: alertCooldownMs },
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

async function runTick(cfg, state) {
  const startedAt = nowIso();
  const out = { ok: true, at: startedAt, mode: cfg.offline.enabled ? "offline" : "auto", results: {}, meta: {} };

  if (cfg.tasks.health) {
    const health = await checkHealthOnce(cfg);
    out.results.health = health;
    await maybeAlertOnFailure(cfg, health, state);
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

  if (cfg.tasks.autoApprovePayoutBatches && cfg.payout?.autoApprove?.enabled === true) {
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

  if (cfg.tasks.autoSubmitPayPalPayoutBatches) {
    const windowOk = isWithinWindowUtc(cfg.payout?.windowUtc ?? { startHourUtc: 0, endHourUtc: 0 });
    if (!windowOk) {
      out.results.autoSubmitPayPal = { ok: true, skipped: true, reason: "outside_payout_window_utc", windowUtc: cfg.payout?.windowUtc ?? null };
    } else if (cfg.payout?.dryRun) {
      out.results.autoSubmitPayPal = { ok: true, skipped: true, reason: "payout_dry_run_enabled" };
    } else {
      const approvedRes = await runEmitWithOfflineFallback(["--report-approved-batches"], cfg);
      out.results.approvedBatches = approvedRes;
      const batches = effectiveOk(approvedRes) ? (approvedRes.result?.batches ?? []) : [];
      const attempts = [];
      for (const b of Array.isArray(batches) ? batches : []) {
        const batchId = getBatchId(b);
        const notes = b?.notes ?? b?.Notes ?? null;
        const recipientType = String(notes?.recipient_type ?? notes?.recipientType ?? "").toLowerCase();
        if (!batchId) continue;
        if (recipientType && recipientType !== "paypal" && recipientType !== "paypal_email") continue;
        const res = await runEmitWithOfflineFallback(["--submit-payout-batch", "--batch-id", String(batchId)], cfg);
        attempts.push({ batchId, res });
      }
      out.results.autoSubmitPayPal = { ok: true, attemptedCount: attempts.length, attempts };
    }
  }

  if (cfg.tasks.syncPayPalLedgerBatches) {
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
  const cfg = resolveRuntimeConfig(args, loaded.config);

  const statePath = path.resolve(process.cwd(), cfg.state.path);
  const persisted = await readJsonFile(statePath, null);
  const state = {
    lastAlertAt: Number(persisted?.lastAlertAt ?? 0) || 0,
    lastApprovalAlertAt: Number(persisted?.lastApprovalAlertAt ?? 0) || 0,
    consecutiveFailures: Number(persisted?.consecutiveFailures ?? 0) || 0
  };
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
      process.stderr.write(`${JSON.stringify({ ok: false, at: nowIso(), error: e?.message ?? String(e) })}\n`);
      state.consecutiveFailures += 1;
    }
    await atomicWriteJson(statePath, {
      lastAlertAt: state.lastAlertAt,
      lastApprovalAlertAt: state.lastApprovalAlertAt,
      consecutiveFailures: state.consecutiveFailures,
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

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
