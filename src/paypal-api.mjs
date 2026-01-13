const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE_URL ??
  ((process.env.PAYPAL_MODE ?? "live").toLowerCase() === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com");

function isPlaceholderValue(value) {
  if (value == null) return true;
  const v = String(value).trim();
  if (!v) return true;
  if (/^\s*<\s*YOUR_[A-Z0-9_]+\s*>\s*$/i.test(v)) return true;
  if (/^\s*YOUR_[A-Z0-9_]+\s*$/i.test(v)) return true;
  if (/^\s*(REPLACE_ME|CHANGEME|TODO)\s*$/i.test(v)) return true;
  return false;
}

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") throw new Error(`Missing required env var: ${name}`);
  if (isPlaceholderValue(v)) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getHttpTimeoutMs() {
  const ms = Number(process.env.PAYPAL_HTTP_TIMEOUT_MS ?? "10000");
  if (!ms || Number.isNaN(ms) || ms < 1000) return 10000;
  return ms;
}

function base64BasicAuth(clientId, clientSecret) {
  const token = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function getPayPalAccessToken() {
  const clientId = getEnvOrThrow("PAYPAL_CLIENT_ID");
  const clientSecret = getEnvOrThrow("PAYPAL_CLIENT_SECRET");
  const live = String(process.env.SWARM_LIVE ?? "false").toLowerCase() === "true";
  const paypalMode = String(process.env.PAYPAL_MODE ?? "live").toLowerCase();
  const paypalBase = String(process.env.PAYPAL_API_BASE_URL ?? "").toLowerCase();
  if (live && (paypalMode === "sandbox" || paypalBase.includes("sandbox.paypal.com"))) {
    throw new Error("LIVE MODE NOT GUARANTEED (PayPal sandbox configured)");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getHttpTimeoutMs());
  let res;
  try {
    res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: base64BasicAuth(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal token request failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (!json?.access_token) throw new Error("PayPal token response missing access_token");
  return json.access_token;
}

export async function paypalRequest(path, { method = "GET", token, headers, body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getHttpTimeoutMs());
  let res;
  try {
    res = await fetch(`${PAYPAL_API_BASE}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(headers ?? {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal request failed (${res.status}) ${method} ${path}: ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

export function extractPayPalWebhookHeaders(reqHeaders) {
  const headers = reqHeaders ?? {};
  const get = (name) => {
    const target = String(name).toLowerCase();
    for (const k of Object.keys(headers)) {
      if (String(k).toLowerCase() === target) return headers[k];
    }
    return null;
  };

  const transmissionId = get("paypal-transmission-id");
  const transmissionTime = get("paypal-transmission-time");
  const transmissionSig = get("paypal-transmission-sig");
  const certUrl = get("paypal-cert-url");
  const authAlgo = get("paypal-auth-algo");

  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

export async function verifyPayPalWebhookSignature({
  webhookId,
  headers,
  rawBody,
  webhookEvent
}) {
  const token = await getPayPalAccessToken();
  const evt = webhookEvent ?? (() => {
    try {
      return JSON.parse(rawBody);
    } catch {
      throw new Error("Invalid JSON webhook body");
    }
  })();
  const body = {
    auth_algo: headers.authAlgo,
    cert_url: headers.certUrl,
    transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig,
    transmission_time: headers.transmissionTime,
    webhook_id: webhookId,
    webhook_event: evt
  };

  const result = await paypalRequest("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    token,
    body
  });

  return result;
}

export async function getPayoutBatchDetails(batchId) {
  const token = await getPayPalAccessToken();
  return paypalRequest(`/v1/payments/payouts/${encodeURIComponent(batchId)}`, { token });
}

export async function createPayPalPayoutBatch({ senderBatchId, items, emailSubject, emailMessage } = {}) {
  const token = await getPayPalAccessToken();
  const body = {
    sender_batch_header: {
      sender_batch_id: String(senderBatchId ?? ""),
      ...(emailSubject ? { email_subject: String(emailSubject) } : {}),
      ...(emailMessage ? { email_message: String(emailMessage) } : {})
    },
    items: Array.isArray(items) ? items : []
  };
  return paypalRequest("/v1/payments/payouts", { method: "POST", token, body });
}

export async function getPayPalBalance() {
  const token = await getPayPalAccessToken();
  try {
    const res = await paypalRequest("/v1/reporting/balances", { token });
    return res;
  } catch (e) {
    throw new Error(e?.message ?? String(e));
  }
}
