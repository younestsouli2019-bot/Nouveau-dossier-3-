import crypto from "node:crypto";

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(s) {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = `${s}${"=".repeat(padLen)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function stableStringify(value) {
  if (value == null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}

export function sha256Hex(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function mandatePayloadHash(payload) {
  return `sha256:${sha256Hex(stableStringify(payload))}`;
}

function parseKeyLike(value, kind) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`Missing ${kind} key`);
  if (raw.includes("-----BEGIN")) return raw;
  throw new Error(`Unsupported ${kind} key format (expected PEM)`);
}

export function getPrivateKeyFromEnv() {
  const pem = parseKeyLike(process.env.AP2_PRIVATE_KEY, "AP2_PRIVATE_KEY");
  return crypto.createPrivateKey(pem);
}

export function getPublicKeyFromEnvKid(kid) {
  const k = String(kid ?? "").trim();
  if (!k) throw new Error("Missing kid");

  const directJson = process.env.AP2_PUBLIC_KEYS_JSON;
  if (directJson) {
    let map = null;
    try {
      map = JSON.parse(directJson);
    } catch {
      throw new Error("Invalid AP2_PUBLIC_KEYS_JSON (expected JSON object)");
    }
    const pem = map?.[k];
    if (pem) return crypto.createPublicKey(parseKeyLike(pem, `AP2_PUBLIC_KEYS_JSON[${k}]`));
  }

  const envKey = `AP2_PUBLIC_KEY_${k.replace(/[^A-Za-z0-9]/g, "_")}`;
  const pem = process.env[envKey];
  if (!pem) throw new Error(`Missing public key for kid=${k} (set ${envKey} or AP2_PUBLIC_KEYS_JSON)`);
  return crypto.createPublicKey(parseKeyLike(pem, envKey));
}

export function signMandatePayload(payload, { kid, privateKey = null, protectedHeader = {} } = {}) {
  const k = String(kid ?? "").trim();
  if (!k) throw new Error("kid is required");

  const header = {
    v: 1,
    typ: "AP2-MANDATE",
    alg: "Ed25519",
    kid: k,
    ...protectedHeader
  };

  const payloadStr = stableStringify(payload);
  const sig = crypto.sign(null, Buffer.from(payloadStr, "utf8"), privateKey ?? getPrivateKeyFromEnv());
  return { protected: header, payload, signature: base64UrlEncode(sig) };
}

export function verifyMandateEnvelope(
  envelope,
  {
    now = () => Date.now(),
    clockSkewMs = 5 * 60 * 1000,
    resolvePublicKey = (kid) => getPublicKeyFromEnvKid(kid)
  } = {}
) {
  const violations = [];
  const protectedHeader = envelope?.protected ?? null;
  const payload = envelope?.payload ?? null;
  const signature = envelope?.signature ?? null;

  if (!protectedHeader || typeof protectedHeader !== "object") violations.push("missing_protected");
  if (!payload || typeof payload !== "object") violations.push("missing_payload");
  if (!signature || typeof signature !== "string") violations.push("missing_signature");

  const kid = protectedHeader?.kid ?? null;
  if (!kid || typeof kid !== "string") violations.push("missing_kid");
  if (protectedHeader?.alg && protectedHeader.alg !== "Ed25519") violations.push("unsupported_alg");

  if (payload?.iat) {
    const t = Date.parse(payload.iat);
    if (!t || Number.isNaN(t)) violations.push("invalid_iat");
    else if (t - now() > clockSkewMs) violations.push("iat_in_future");
  }

  if (payload?.exp) {
    const t = Date.parse(payload.exp);
    if (!t || Number.isNaN(t)) violations.push("invalid_exp");
    else if (t + clockSkewMs < now()) violations.push("expired");
  }

  let sigOk = false;
  if (violations.length === 0) {
    const pub = resolvePublicKey(kid);
    const payloadStr = stableStringify(payload);
    sigOk = crypto.verify(null, Buffer.from(payloadStr, "utf8"), pub, base64UrlDecode(signature));
    if (!sigOk) violations.push("bad_signature");
  }

  return {
    ok: violations.length === 0,
    violations,
    kid: kid ?? null,
    payloadHash: payload ? mandatePayloadHash(payload) : null
  };
}

export function buildMandateChainHash(prevEnvelope) {
  const payload = prevEnvelope?.payload ?? null;
  if (!payload || typeof payload !== "object") throw new Error("Invalid previous mandate");
  return mandatePayloadHash(payload);
}

