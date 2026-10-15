#!/usr/bin/env node
// S2-T04: generate-funnel-bottleneck-report.mjs — computes 6 transition drop-offs
// (stage i → stage i+1), refunds total, abandoned total, prints BOTTLENECK label stage.
// Exit 2 if no events (empty funnel).
import fs from "node:fs";
import path from "node:path";
const REPO = process.cwd();
const FUNNEL_PATH = process.env.FUNNEL_PATH || path.join(REPO, "data/out/funnel-events.ndjson");
const OUT_PATH = process.env.FUNNEL_REPORT_OUT || path.join(REPO, "data/out/funnel-bottleneck-report.json");
const STAGES = ["catalog_view","course_page_view","checkout_start","payment_attempt","verified_payment","successful_delivery","refund","abandoned_order"];

if (!fs.existsSync(FUNNEL_PATH)) {
  console.log("[funnel-report] no funnel-events file yet at", FUNNEL_PATH);
  console.log("EXIT=2 empty funnel — no bottle-neck measurable.");
  process.exit(2);
}
const content = fs.readFileSync(FUNNEL_PATH, "utf8").trim();
if (!content) { process.exit(2); }
const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
const counts = Object.fromEntries(STAGES.map(s => [s, 0]));
const bySession = new Map();
let refunds = 0;
let abandoned = 0;
for (const raw of lines) {
  try {
    const l = JSON.parse(raw);
    const stage = l.event?.stage;
    if (!stage || !STAGES.includes(stage)) continue;
    counts[stage] = (counts[stage]||0) + 1;
    if (stage === "refund") refunds++;
    if (stage === "abandoned_order") abandoned++;
    const sid = l.event.session_id;
    if (sid) {
      if (!bySession.has(sid)) bySession.set(sid, new Set());
      bySession.get(sid).add(stage);
    }
  } catch {}
}
const transitions = [];
let maxDrop = 0;
let bottleneck = null;
for (let i = 0; i < STAGES.length-1; i++) {
  const a = STAGES[i], b = STAGES[i+1];
  if (a === "successful_delivery" || a === "refund") continue; // only linear flow transitions catalog→delivery
  if (b === "refund" || b === "abandoned_order") continue;
  const ca = counts[a]||0;
  const cb = counts[b]||0;
  const dropPct = ca === 0 ? 0 : (100 * (ca - cb) / ca);
  const convPct = ca === 0 ? 0 : (100 * cb / ca);
  if (dropPct > maxDrop && ca > 0) { maxDrop = dropPct; bottleneck = `${a}→${b}`; }
  transitions.push({ from:a, to:b, from_count:ca, to_count:cb, drop_pct: +dropPct.toFixed(2), conversion_pct: +convPct.toFixed(2) });
}
const sessConv = {
  catalog_view_to_delivery_any: 0,
  catalog_view_total: 0,
};
for (const stages of bySession.values()) {
  if (stages.has("catalog_view")) {
    sessConv.catalog_view_total++;
    if (stages.has("successful_delivery")) sessConv.catalog_view_to_delivery_any++;
  }
}
const sessionConvPct = sessConv.catalog_view_total === 0 ? 0 : (100 * sessConv.catalog_view_to_delivery_any / sessConv.catalog_view_total);
const report = {
  schema: "funnel-bottleneck-report-v1",
  generated_at: new Date().toISOString(),
  stage_counts: counts,
  transition_matrix: transitions,
  totals: {
    refund_events_total: refunds,
    abandoned_order_events_total: abandoned,
    unique_sessions_with_catalog_view: sessConv.catalog_view_total,
    unique_sessions_with_successful_delivery: sessConv.catalog_view_to_delivery_any,
    catalog_to_delivery_session_conversion_pct: +sessionConvPct.toFixed(2),
  },
  bottleneck_label: bottleneck || "NO_DATA",
  bottleneck_drop_pct: +maxDrop.toFixed(2),
  diagnosis: bottleneck
    ? `Largest drop-off = ${bottleneck} at ${maxDrop.toFixed(2)}% — focus product/engineering work HERE before optimizing other stages.`
    : "Not enough funnel events yet. Recommend 50+ catalog views before diagnosing.",
};
const dir = path.dirname(OUT_PATH);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
console.log(`Funnel Report -> ${OUT_PATH}`);
console.log(`STAGE COUNTS:`, JSON.stringify(counts));
console.log(`BOTTLENECK: ${report.bottleneck_label} (drop=${report.bottleneck_drop_pct}%)`);
console.log(report.diagnosis);
process.exit(bottleneck ? 0 : 2);
