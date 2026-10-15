import "dotenv/config";

function hasEnv(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== "";
}

function mask(value, keep = 4) {
  const s = String(value ?? "");
  if (s.length <= keep * 2) return s.replace(/./g, "*");
  return `${s.slice(0, keep)}...${s.slice(-2)} (len=${s.length})`;
}

async function fetchWithBackoff(url, opts = {}, { timeouts = [25000, 40000, 60000], retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const ms = timeouts[attempt] ?? timeouts[timeouts.length - 1];
    const timer = setTimeout(() => ctl.abort(new Error(`fetch timeout after ${ms}ms (attempt ${attempt + 1}/${retries + 1})`)), ms);
    try {
      const resp = await fetch(url, { ...opts, signal: ctl.signal });
      clearTimeout(timer);
      return { resp, attempt, timeoutMs: ms };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        const backoffMs = 200 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("fetchWithBackoff exhausted");
}

async function probeWise() {
  const token = process.env.OWNER_WISE_API_TOKEN || process.env.WISE_API_TOKEN || "";
  if (!hasEnv("OWNER_WISE_API_TOKEN") && !hasEnv("WISE_API_TOKEN")) {
    return { rail: "wise", ok: false, reason: "no token configured" };
  }
  try {
    const { resp } = await fetchWithBackoff("https://api.transferwise.com/v1/profiles", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      const profiles = await resp.json();
      return { rail: "wise", ok: true, token: mask(token), profiles: profiles.length };
    }
    const body = await resp.text().catch(() => "");
    return { rail: "wise", ok: false, token: mask(token), http: resp.status, body: body.slice(0, 160) };
  } catch (e) {
    return { rail: "wise", ok: false, token: mask(token), error: e?.message ?? String(e) };
  }
}

async function probeCrypto() {
  try {
    const { CryptoRailManager } = await import("../src/crypto/crypto-rail.mjs").catch(() => ({ CryptoRailManager: null }));
    if (!CryptoRailManager) {
      return {
        rail: "crypto",
        ok: false,
        error: "CryptoRailManager unavailable: @binance/connector or crypto-rail module missing (fail-soft, other probes preserved)",
      };
    }
    const manager = new CryptoRailManager();
    const result = await manager.checkRails();
    return {
      rail: "crypto",
      ok: true,
      enabled: result.enabled,
      destination: result.destination,
      allowedAddressCount: result.allowedAddressCount,
      minWithdraw: result.minWithdraw,
      maxWithdraw: result.maxWithdraw,
      priority: result.priority,
      networks: result.networks,
      directDepositEnabled: result.directDepositEnabled,
      destinationL2: result.destinationL2,
      bybit: result.rails.bybit,
      bitget: result.rails.bitget,
    };
  } catch (e) {
    return { rail: "crypto", ok: false, error: e?.message ?? String(e) };
  }
}

async function probePayPal() {
  const cid = process.env.PAYPAL_CLIENT_ID || "";
  if (!hasEnv("PAYPAL_CLIENT_ID") || !hasEnv("PAYPAL_CLIENT_SECRET")) {
    return { rail: "paypal", ok: false, reason: "no credentials configured" };
  }
  const base = String(process.env.PAYPAL_API_BASE_URL || "").replace(/\/+$/, "") || "https://api-m.paypal.com";
  const basic = Buffer.from(`${cid}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  try {
    const { resp } = await fetchWithBackoff(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (resp.ok) {
      const j = await resp.json();
      const scopes = (j.scope ?? "").split(" ");
      return {
        rail: "paypal",
        ok: true,
        clientId: mask(cid),
        mode: process.env.PAYPAL_MODE || "live",
        hasPayoutsScope: scopes.includes("https://uri.paypal.com/payments/payouts"),
      };
    }
    const body = await resp.text().catch(() => "");
    return { rail: "paypal", ok: false, clientId: mask(cid), http: resp.status, body: body.slice(0, 160) };
  } catch (e) {
    return { rail: "paypal", ok: false, clientId: mask(cid), error: e?.message ?? String(e) };
  }
}

function unwrapSettled(settled, railName) {
  if (settled.status === "fulfilled") return settled.value;
  const reason = settled.reason;
  return { rail: railName, ok: false, error: reason?.message ?? String(reason) };
}

async function main() {
  const [wiseS, cryptoS, paypalS] = await Promise.allSettled([probeWise(), probeCrypto(), probePayPal()]);
  const wise = unwrapSettled(wiseS, "wise");
  const crypto = unwrapSettled(cryptoS, "crypto");
  const paypal = unwrapSettled(paypalS, "paypal");
  const all = [wise, crypto, paypal];
  const ok = all.every((r) => r.ok !== false);
  process.stdout.write(JSON.stringify({ ok, checkedAt: new Date().toISOString(), rails: all }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

main();
