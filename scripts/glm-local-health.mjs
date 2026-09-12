#!/usr/bin/env node
// Phase-4 self-hosted inference health probe.
// Verifies the local GLM-5.3-Flash engine (vLLM / SGLang / OpenClaw) answers an
// OpenAI-compatible /chat/completions call, and that the swarm router would use
// it first.
//
// USAGE:
//   node scripts/glm-local-health.mjs
//   npm run inference:health
//
// Reads GLM_LOCAL_BASE_URL and GLM_LOCAL_API_KEY from the environment (.env).
// Never prints the API key.
import "dotenv/config";

const base = (process.env.GLM_LOCAL_BASE_URL ?? "http://localhost:8000/v1").replace(/\/$/, "");
const apiKey = process.env.GLM_LOCAL_API_KEY ?? "local";

function suffix(v) {
  if (!v) return "";
  const s = String(v);
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : "…";
}

async function main() {
  const checks = [];

  // 1) basic reachability of the engine base URL
  try {
    const r = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.text().catch(() => "");
    checks.push({
      name: `engine reachable (${base})`,
      ok: r.ok,
      detail: r.ok ? `HTTP ${r.status}, models listed` : `HTTP ${r.status}: ${body.slice(0, 120)}`,
    });
  } catch (e) {
    checks.push({ name: `engine reachable (${base})`, ok: false, detail: e.message });
  }

  // 2) actual chat completion round-trip
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "glm-5.3-flash",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content ?? "";
    checks.push({
      name: "chat completion round-trip",
      ok: r.ok && /ok/i.test(content),
      detail: r.ok ? `HTTP 200, model replied: "${content.trim().slice(0, 40)}"` : `HTTP ${r.status}`,
    });
  } catch (e) {
    checks.push({ name: "chat completion round-trip", ok: false, detail: e.message });
  }

  // 3) swarm router would route here first
  try {
    const { getRoutePreview } = await import("../src/lib/dynamic-router.ts");
    const preview = getRoutePreview([{ role: "user", content: "hello" }]);
    checks.push({
      name: "swarm router prefers local engine",
      ok: preview.selectedModel.id === "local-glm-5.3-flash",
      detail: `router selected: ${preview.selectedModel.id} (first in fallback chain: ${preview.fallbackChain[0]})`,
    });
  } catch (e) {
    checks.push({ name: "swarm router prefers local engine", ok: false, detail: `router probe failed: ${e.message}` });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("\nGLM local engine health — GLM_LOCAL_BASE_URL=" + base);
  console.log(`                       GLM_LOCAL_API_KEY=${suffix(apiKey)}`);
  console.log("-".repeat(72));
  for (const c of checks) {
    console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`        ${c.detail}`);
  }
  console.log("-".repeat(72));
  console.log(
    failed.length === 0
      ? "ALL CHECKS PASSED — swarm is serving inference from its own engine."
      : `${failed.length} check(s) FAILED — see above; engine may still be pulling weights or not started.`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});