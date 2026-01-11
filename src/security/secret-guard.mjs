import crypto from "node:crypto";
import { threatMonitor } from "./threat-monitor.mjs";
 
function randomToken(len = 48) {
  return crypto.randomBytes(Math.max(16, Math.floor(len / 2))).toString("hex").slice(0, len);
}
 
function getSecrets() {
  const sensitiveKeywords = ["KEY", "SECRET", "TOKEN", "PASSWORD", "PASS", "PRIVATE"];
  const out = [];
  for (const k in process.env) {
    const upperK = k.toUpperCase();
    if (sensitiveKeywords.some(keyword => upperK.includes(keyword))) {
      const v = process.env[k];
      if (v && String(v).trim()) {
        out.push(String(v).trim());
      }
    }
  }
  return out;
}
 
function buildMatchers(values) {
  const m = [];
  for (const v of values) {
    const s = String(v);
    m.push({ re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), mask: "***" });
    if (s.length >= 16) {
      const head = s.slice(0, 8);
      const tail = s.slice(-8);
      m.push({ re: new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), mask: "****" });
      m.push({ re: new RegExp(tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), mask: "****" });
    }
  }
  m.push({ re: /[A-Za-z0-9]{40,}/g, mask: "[REDACTED]" });
  return m;
}
 
function maskText(s, matchers) {
  if (!s || typeof s !== "string") return s;
  let out = s;
  for (const { re, mask } of matchers) {
    out = out.replace(re, mask);
  }
  return out;
}
 
function patchConsole(matchers) {
  if (globalThis.__SECRET_GUARD_CONSOLE__) return;
  const names = ["log", "info", "warn", "error"];
  for (const n of names) {
    const orig = console[n];
    console[n] = (...args) => {
      const safe = args.map((a) => (typeof a === "string" ? maskText(a, matchers) : a));
      return orig(...safe);
    };
  }
  globalThis.__SECRET_GUARD_CONSOLE__ = true;
}
 
function patchFetch(honey) {
  if (globalThis.__SECRET_GUARD_FETCH__) return;
  const orig = globalThis.fetch;
  if (!orig) return;
  globalThis.fetch = async (input, init = {}) => {
    try {
      const headers = new Map();
      const h = init?.headers;
      if (h && typeof h === "object") {
        for (const [k, v] of Object.entries(h)) {
          headers.set(String(k).toLowerCase(), String(v));
        }
      }
      const vals = Array.from(headers.values()).join(" ");
      if (vals.includes(honey.value) || vals.includes(honey.decoyBinanceKey) || vals.includes(honey.decoyBinanceSecret)) {
        threatMonitor.reportError("exfil_attempt", new Error("Honeytoken triggered"));
      }
    } catch {}
    return orig(input, init);
  };
  globalThis.__SECRET_GUARD_FETCH__ = true;
}
 
function enableHoneytokens() {
  const honey = {
    value: `HONEY_${randomToken(24)}`,
    decoyBinanceKey: `BINANCE_DECOY_${randomToken(24)}`,
    decoyBinanceSecret: `BINANCE_DECOY_${randomToken(24)}`
  };
  if (!process.env.SWARM_HONEYTOKEN) process.env.SWARM_HONEYTOKEN = honey.value;
  if (!process.env.BINANCE_API_KEY_DECOY) process.env.BINANCE_API_KEY_DECOY = honey.decoyBinanceKey;
  if (!process.env.BINANCE_API_SECRET_DECOY && !process.env.BINANCE_SECRET_KEY_DECOY) {
    process.env.BINANCE_API_SECRET_DECOY = honey.decoyBinanceSecret;
  }
  return honey;
}
 
export function initSecretGuard() {
  if (globalThis.__SECRET_GUARD_ACTIVE__) return;
  const secrets = getSecrets();
  const matchers = buildMatchers(secrets);
  const honey = enableHoneytokens();
  patchConsole(matchers);
  patchFetch(honey);
  globalThis.__SECRET_GUARD_ACTIVE__ = true;
}
