/**
 * Seed the offline Base44 store with sample entities.
 *
 * Run:  npx tsx scripts/seed-offline-store.ts
 *
 * Idempotent: skips entities that already exist (matched by event_id /
 * mission_id / item_id / etc.).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const STORE_DIR = join(process.cwd(), "db");
const STORE_PATH = join(STORE_DIR, "base44-offline-store.json");

interface OfflineRecord {
  _id: string;
  _created_date: string;
  _updated_date: string;
  [key: string]: unknown;
}

interface OfflineStore {
  version: 1;
  entities: Record<string, OfflineRecord[]>;
}

function loadStore(): OfflineStore {
  if (!existsSync(STORE_PATH)) {
    return { version: 1, entities: {} };
  }
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as OfflineStore;
    return parsed && parsed.entities ? parsed : { version: 1, entities: {} };
  } catch {
    return { version: 1, entities: {} };
  }
}

function saveStore(store: OfflineStore) {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function nowISO() {
  return new Date().toISOString();
}

function rec(data: Record<string, unknown>): OfflineRecord {
  return {
    _id: randomUUID(),
    _created_date: nowISO(),
    _updated_date: nowISO(),
    ...data,
  };
}

function findExisting(store: OfflineStore, entity: string, field: string, value: string): OfflineRecord | undefined {
  const arr = store.entities[entity] || [];
  return arr.find((r) => r[field] === value);
}

function upsertBy(store: OfflineStore, entity: string, field: string, data: Record<string, unknown>): OfflineRecord {
  if (!store.entities[entity]) store.entities[entity] = [];
  const existing = findExisting(store, entity, field, String(data[field]));
  if (existing) {
    Object.assign(existing, data, { _updated_date: nowISO() });
    return existing;
  }
  const newRec = rec(data);
  store.entities[entity].push(newRec);
  return newRec;
}

function main() {
  const store = loadStore();
  let added = 0;
  let skipped = 0;

  // ─── Agents ─────────────────────────────────────────────────────────
  const agents = [
    { name: "Atlas", type: "orchestrator", status: "active", system_prompt: "Top-level orchestrator", performance_metrics: { revenue_generated: 12500, tasks_completed: 87, success_rate: 94 } },
    { name: "Hermes", type: "social_media", status: "active", system_prompt: "Social media specialist", performance_metrics: { revenue_generated: 3200, tasks_completed: 142, success_rate: 91 } },
    { name: "Vesta", type: "content_creation", status: "active", system_prompt: "Content creator", performance_metrics: { revenue_generated: 5800, tasks_completed: 64, success_rate: 88 } },
    { name: "Morpheus", type: "data_analysis", status: "paused", system_prompt: "Data analyst", performance_metrics: { revenue_generated: 2400, tasks_completed: 38, success_rate: 86 } },
    { name: "Iris", type: "customer_outreach", status: "active", system_prompt: "Customer outreach", performance_metrics: { revenue_generated: 4100, tasks_completed: 96, success_rate: 92 } },
  ];
  for (const a of agents) {
    const before = (store.entities.Agent || []).length;
    upsertBy(store, "Agent", "name", a);
    if ((store.entities.Agent || []).length > before) added++;
    else skipped++;
  }

  // ─── Missions ──────────────────────────────────────────────────────
  const missions = [
    { mission_id: "M-Q1-001", title: "Q1 Revenue Push", type: "revenue_generation", priority: "high", status: "in_progress", revenue_generated: 8500, deadline: "2026-09-30" },
    { mission_id: "M-Q1-002", title: "Affiliate Program Launch", type: "market_expansion", priority: "medium", status: "queued", revenue_generated: 0, deadline: "2026-10-15" },
    { mission_id: "M-Q1-003", title: "Etsy POD Catalog Refresh", type: "revenue_generation", priority: "high", status: "in_progress", revenue_generated: 3200, deadline: "2026-09-10" },
    { mission_id: "M-Q1-004", title: "KDP Q4 Catalog", type: "product_development", priority: "medium", status: "deployed", revenue_generated: 1800, deadline: "2026-09-20" },
  ];
  for (const m of missions) {
    const before = (store.entities.Mission || []).length;
    upsertBy(store, "Mission", "mission_id", m);
    if ((store.entities.Mission || []).length > before) added++;
    else skipped++;
  }

  // ─── Tasks ─────────────────────────────────────────────────────────
  const tasks = [
    { title: "Draft affiliate onboarding email", type: "customer_outreach", priority: "high", status: "completed", due_date: "2026-08-15" },
    { title: "Generate 5 Etsy POD designs", type: "content_creation", priority: "medium", status: "in_progress", due_date: "2026-08-22" },
    { title: "Analyze Q1 conversion funnel", type: "data_analysis", priority: "high", status: "pending", due_date: "2026-08-25" },
    { title: "Publish KDP Q4 listing batch 1", type: "marketplace_listing", priority: "medium", status: "completed", due_date: "2026-08-12" },
    { title: "Reply to 12 customer inquiries", type: "customer_outreach", priority: "urgent", status: "in_progress", due_date: "2026-08-19" },
    { title: "Quality-review 8 submitted designs", type: "quality_review", priority: "medium", status: "pending", due_date: "2026-08-21" },
    { title: "Schedule 7 social posts for next week", type: "social_posting", priority: "high", status: "completed", due_date: "2026-08-17" },
    { title: "Setup Stripe webhook route", type: "automation_setup", priority: "high", status: "failed", due_date: "2026-08-14" },
  ];
  for (const t of tasks) {
    const before = (store.entities.Task || []).length;
    upsertBy(store, "Task", "title", t);
    if ((store.entities.Task || []).length > before) added++;
    else skipped++;
  }

  // ─── Revenue Streams ───────────────────────────────────────────────
  const streams = [
    { name: "Etsy POD Storefront", type: "etsy_pod", status: "active", target_monthly_revenue: 5000, available_for_payout: 1250, payout_status: "pending" },
    { name: "Amazon KDP Catalog", type: "amazon_kdp", status: "active", target_monthly_revenue: 3000, available_for_payout: 800, payout_status: "idle" },
    { name: "Affiliate Program", type: "affiliate", status: "setup", target_monthly_revenue: 1500, available_for_payout: 0, payout_status: "idle" },
    { name: "Udemy Course Sales", type: "course_sales", status: "active", target_monthly_revenue: 1200, available_for_payout: 400, payout_status: "processing" },
  ];
  for (const s of streams) {
    const before = (store.entities.RevenueStream || []).length;
    upsertBy(store, "RevenueStream", "name", s);
    if ((store.entities.RevenueStream || []).length > before) added++;
    else skipped++;
  }

  // ─── Revenue Events (truth-guarded — only "projected" without proof)
  // Note: we deliberately do NOT seed any "paid_out" events — that would
  // require proof_hash + verified_at + proof_source from an external witness.
  // Projected revenue is safe to seed for dashboard demo purposes.
  // ──────────────────────────────────────────────────────────────────
  const revenueEvents = [
    { event_id: "REV-Q1-001", source: "mission_completed", amount: 850.00, currency: "USD", status: "projected", description: "Q1 Revenue Push milestone 1", source_id: "M-Q1-001" },
    { event_id: "REV-Q1-002", source: "course_sale", amount: 149.00, currency: "USD", status: "confirmed", description: "Udemy course bundle sale", confirmation_date: nowISO() },
    { event_id: "REV-Q1-003", source: "affiliate_commission", amount: 78.50, currency: "USD", status: "projected", description: "Affiliate signup bonus" },
    { event_id: "REV-Q1-004", source: "product_sale", amount: 312.00, currency: "USD", status: "confirmed", description: "Etsy POD batch 8/15", confirmation_date: nowISO() },
    { event_id: "REV-Q1-005", source: "mission_completed", amount: 1200.00, currency: "USD", status: "projected", description: "Etsy POD Catalog Refresh milestone 2", source_id: "M-Q1-003" },
  ];
  for (const e of revenueEvents) {
    const before = (store.entities.RevenueEvent || []).length;
    upsertBy(store, "RevenueEvent", "event_id", e);
    if ((store.entities.RevenueEvent || []).length > before) added++;
    else skipped++;
  }

  // ─── Payout Batches (draft / pending_approval only — never completed) ──
  const batches = [
    { batch_id: "PB-2026-08-001", status: "pending_approval", total_amount: 1250.00, currency: "USD", item_count: 1, recipient_count: 1, notes: "August payout — awaiting approval" },
    { batch_id: "PB-2026-08-002", status: "draft", total_amount: 400.00, currency: "USD", item_count: 1, recipient_count: 1, notes: "Udemy course payout (draft)" },
  ];
  for (const b of batches) {
    const before = (store.entities.PayoutBatch || []).length;
    upsertBy(store, "PayoutBatch", "batch_id", b);
    if ((store.entities.PayoutBatch || []).length > before) added++;
    else skipped++;
  }

  // ─── Payout Items (pending only — never success without proof) ─────
  const items = [
    { item_id: "PI-2026-08-001", batch_id: "PB-2026-08-001", recipient_name: "Younes T", recipient: "younestsouli2019@gmail.com", recipient_type: "paypal_email", amount: 1250.00, currency: "USD", status: "pending" },
    { item_id: "PI-2026-08-002", batch_id: "PB-2026-08-002", recipient_name: "Younes T", recipient: "younestsouli2019@gmail.com", recipient_type: "paypal_email", amount: 400.00, currency: "USD", status: "pending" },
  ];
  for (const it of items) {
    const before = (store.entities.PayoutItem || []).length;
    upsertBy(store, "PayoutItem", "item_id", it);
    if ((store.entities.PayoutItem || []).length > before) added++;
    else skipped++;
  }

  // ─── Payout Recipients (KYC stub) ──────────────────────────────────
  const recipients = [
    { name: "Younes T", recipient_type: "paypal_email", currency: "USD", country: "MA", account_identifier: "younestsouli2019@gmail.com", is_default: true, notes: "Owner / primary recipient" },
  ];
  for (const r of recipients) {
    const before = (store.entities.PayoutRecipient || []).length;
    upsertBy(store, "PayoutRecipient", "account_identifier", r);
    if ((store.entities.PayoutRecipient || []).length > before) added++;
    else skipped++;
  }

  // ─── Agent Thresholds ──────────────────────────────────────────────
  const thresholds = [
    { agent_id: "atlas", agent_name: "Atlas", pause_below_revenue: 500, activate_above_revenue: 1000, min_success_rate: 80, enabled: true, last_action: "none" },
    { agent_id: "hermes", agent_name: "Hermes", pause_below_revenue: 200, activate_above_revenue: 500, min_success_rate: 75, enabled: true, last_action: "activated", last_action_at: nowISO() },
  ];
  for (const t of thresholds) {
    const before = (store.entities.AgentThreshold || []).length;
    upsertBy(store, "AgentThreshold", "agent_id", t);
    if ((store.entities.AgentThreshold || []).length > before) added++;
    else skipped++;
  }

  // ─── Workflows ─────────────────────────────────────────────────────
  const workflows = [
    { name: "Daily Social Post Sweep", description: "Schedule 7 social posts every morning", category: "social_media", status: "active" },
    { name: "Weekly KPI Rollup", description: "Aggregate weekly KPIs and emit report", category: "analytics", status: "active" },
    { name: "Affiliate Onboarding", description: "Send welcome email sequence to new affiliates", category: "customer_engagement", status: "draft" },
  ];
  for (const w of workflows) {
    const before = (store.entities.Workflow || []).length;
    upsertBy(store, "Workflow", "name", w);
    if ((store.entities.Workflow || []).length > before) added++;
    else skipped++;
  }

  saveStore(store);

  console.log("Offline store seeded.");
  console.log("  added:  " + added);
  console.log("  skipped (already existed): " + skipped);
  console.log("  store:  " + STORE_PATH);
  console.log();
  console.log("Entity counts:");
  for (const [entity, records] of Object.entries(store.entities)) {
    console.log("  " + entity + ": " + records.length);
  }
  console.log();
  console.log("Note: revenue events are seeded in projected/confirmed status only.");
  console.log("      Payout items are seeded in pending status only.");
  console.log("      No fabricated paid_out / success / completed records exist.");
  console.log("      Truth-guard is enforced identically in offline mode.");
}

main();
