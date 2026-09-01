import "dotenv/config";
import { CryptoRailManager } from "../src/crypto/crypto-rail.mjs";

function hasEnv(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== "";
}

function mask(value, keep = 4) {
  const s = String(value ?? "");
  if (s.length <= keep * 2) return s.replace(/./g, "*");
  return `${s.slice(0, keep)}...${s.slice(-2)} (len=${s.length})`;
}

async function probeWise() {
  const token = process.env.OWNER_WISE_API_TOKEN || process.env.WISE_API_TOKEN || "";
  if (!hasEnv("OWNER_WISE_API_TOKEN") && !hasEnv("WISE_API_TOKEN")) {
    return { rail: "wise", ok: false, reason: "no token configured" };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    const resp = await fetch("https://api.transferwise.com/v1/profiles", {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctl.signal,
    });
    clearTimeout(timer);
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
  const manager = new CryptoRailManager();
  const result = await manager.checkRails();
  return {
    rail: "crypto",
    enabled: result.enabled,
    destination: result.destination,
    allowedAddressCount: result.allowedAddressCount,
    minWithdraw: result.minWithdraw,
    maxWithdraw: result.maxWithdraw,
    priority: result.priority,
    bybit: result.rails.bybit,
    bitget: result.rails.bitget,
  };
}

async function probePayPal() {
  const cid = process.env.PAYPAL_CLIENT_ID || "";
  if (!hasEnv("PAYPAL_CLIENT_ID") || !hasEnv("PAYPAL_CLIENT_SECRET")) {
    return { rail: "paypal", ok: false, reason: "no credentials configured" };
  }
  const base = String(process.env.PAYPAL_API_BASE_URL || "").replace(/\/+$/, "") || "https://api-m.paypal.com";
  const basic = Buffer.from(`${cid}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    const resp = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: ctl.signal,
    });
    clearTimeout(timer);
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

async function main() {
  const [wise, crypto, paypal] = await Promise.all([probeWise(), probeCrypto(), probePayPal()]);
  const all = [wise, crypto, paypal];
  const ok = all.every((r) => r.ok !== false);
  process.stdout.write(JSON.stringify({ ok, checkedAt: new Date().toISOString(), rails: all }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

main();
