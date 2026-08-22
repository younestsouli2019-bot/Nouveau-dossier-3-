#!/usr/bin/env node
/**
 * Non-interactive Base44 key verifier.
 *
 * Usage:
 *   node scripts/verify-base44-key.mjs <api-key>
 *   BASE44_API_KEY=xxxx node scripts/verify-base44-key.mjs
 *
 * Exits 0 if the key works (HTTP 200), non-zero otherwise.
 */

const key = process.argv[2] || process.env.BASE44_API_KEY;
if (!key) {
  console.error("Usage: node scripts/verify-base44-key.mjs <api-key>");
  console.error("   or: BASE44_API_KEY=xxxx node scripts/verify-base44-key.mjs");
  process.exit(2);
}

if (!/^[a-f0-9]{32}$/.test(key)) {
  console.error(`Key shape invalid: expected 32 lowercase hex chars, got ${key.length} chars.`);
  console.error(`Masked: ${key.slice(0, 6)}…${key.slice(-4)}`);
  process.exit(2);
}

console.log(`Key shape valid: ${key.slice(0, 6)}…${key.slice(-4)}`);
console.log("Hitting Base44 with GET /entities/Agent?limit=1 ...");

const url = "https://agent-swarm-efe0bd7e.base44.app/api/entities/Agent?limit=1";
const res = await fetch(url, {
  headers: {
    "Content-Type": "application/json",
    api_key: key,
  },
});

console.log(`HTTP ${res.status} ${res.statusText}`);
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

if (res.status === 200) {
  console.log("✓ PASS — Base44 reachable, key works.");
  if (Array.isArray(body)) {
    console.log(`  Agent records returned: ${body.length}`);
  } else if (body && typeof body === "object" && "items" in body) {
    console.log(`  Agent records returned: ${body.items?.length || 0}`);
  }
  process.exit(0);
} else if (res.status === 401 || res.status === 403) {
  console.error("✗ FAIL — Base44 rejected the key.");
  console.error("  Response body:", JSON.stringify(body).slice(0, 300));
  console.error("");
  console.error("  This usually means:");
  console.error("    1. The key is revoked or expired, OR");
  console.error("    2. The Base44 app is private and the key lacks owner access.");
  console.error("");
  console.error("  Fix: visit https://agent-swarm-efe0bd7e.base44.app and either:");
  console.error("    - Rotate the key in app settings, OR");
  console.error("    - Change app visibility from private to public.");
  process.exit(1);
} else {
  console.error(`✗ FAIL — unexpected HTTP ${res.status}.`);
  console.error("  Response body:", JSON.stringify(body).slice(0, 300));
  process.exit(1);
}
