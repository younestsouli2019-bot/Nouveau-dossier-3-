/**
 * Base44 Agent-Swarm API client (server-side only).
 *
 * Uses fetch directly against the REST endpoints documented in the uploaded
 * API reference. All calls go through this module so the api_key stays on
 * the server.
 *
 * Base URL:  https://agent-swarm-efe0bd7e.base44.app/api
 * App ID:    689afeabf1db9c30efe0bd7e
 */

import { enforceTruthGuard } from "./truth-guard";
import { offlineB44 } from "./base44-offline";

/**
 * Backend mode — detected once at module load. Determines whether b44.*
 * calls hit the real Base44 REST API or fall back to the local offline store.
 *
 * The offline adapter mirrors the Base44 entity schema and persists to
 * `db/base44-offline-store.json`. Truth-guard enforcement is identical in
 * both modes — the offline adapter respects the same enforceTruthGuard()
 * check that the live HTTP path uses.
 *
 * Mode is controlled by the Base44 token env vars:
 *   - set + non-empty     → "live"    (hit real Base44)
 *   - missing or empty    → "offline" (use local file store)
 *
 * Two env var names are accepted, in priority order:
 *   1. BASE44_API_KEY         (local convention — used in this dashboard)
 *   2. BASE44_SERVICE_TOKEN   (upstream repo convention — see
 *                             www-realworldcerts-com/Nouveau-dossier-3-
 *                             src/security/secret-guard.mjs)
 * Both will be set as GitHub repo secrets in the upstream repo; whichever
 * one is present locally flips the dashboard into live mode.
 *
 * You can also force offline mode by setting BASE44_MODE=offline in .env
 * (useful for demos / CI without secrets).
 */
export type B44Mode = "live" | "offline";

export const B44_MODE: B44Mode =
  process.env.BASE44_MODE === "offline" ||
  (!process.env.BASE44_API_KEY && !process.env.BASE44_SERVICE_TOKEN)
    ? "offline"
    : "live";

/** True when b44.* will use the local file-backed store instead of the network. */
export const IS_OFFLINE = B44_MODE === "offline";

/**
 * Best-effort caller detection for audit logging.
 * Walks the stack trace looking for a known module name (orchestrator,
 * settlement-oracle, autopilot-daemon, etc.). Falls back to "unknown".
 */
function detectCaller(): string {
  // Use Error.stackTraceLimit to keep the trace small.
  const oldLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 12;
  const stack = new Error().stack || "";
  Error.stackTraceLimit = oldLimit;
  const KNOWN = [
    "orchestrator",
    "settlement-oracle",
    "settlement-ledger",
    "durable-ledger",
    "autopilot-daemon",
    "transaction-orchestrator",
    "procurement-ledger",
    "swarm-integrity",
    "swarm-redress",
    "vault-system",
    "data-rights",
    "truth-audit",
    "security-audit-engine",
  ];
  for (const k of KNOWN) {
    if (stack.includes(k)) return k;
  }
  // Look for /api/ in the stack — that's a route handler.
  const apiMatch = stack.match(/\/api\/([^/\n]+)\/route\.ts/);
  if (apiMatch) return `route:${apiMatch[1]}`;
  return "unknown";
}

export const BASE44_BASE_URL =
  "https://agent-swarm-efe0bd7e.base44.app/api";
// TRUTH-GUARDED — 2026-08-18
// Prior: hardcoded `e599b5b131574c1bae885fc013620739` was committed to source.
// That key is now revoked. Read from env only — rotation checklist in
// download/credential-rotation-checklist.md.
//
// Accept either BASE44_API_KEY (local convention) or BASE44_SERVICE_TOKEN
// (upstream repo convention from www-realworldcerts-com/Nouveau-dossier-3-).
// GitHub repo secrets are write-only, so the only way to consume them
// locally is to set them in .env after manually exporting from the Base44
// console at https://agent-swarm-efe0bd7e.base44.app (App Settings → API).
const BASE44_API_KEY =
  process.env.BASE44_API_KEY ||
  process.env.BASE44_SERVICE_TOKEN ||
  "";

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  api_key: BASE44_API_KEY,
};

export type ID = string;

export interface Agent {
  id?: ID;
  name: string;
  description?: string;
  type: string;
  status?: "active" | "paused" | "stopped" | "error";
  system_prompt: string;
  capabilities?: string[];
  current_workload?: number;
  max_workload?: number;
  task_queue?: ID[];
  collaboration_rules?: Record<string, unknown>;
  revenue_config?: Record<string, unknown>;
  social_accounts?: unknown[];
  automation_config?: Record<string, unknown>;
  performance_metrics?: {
    revenue_generated?: number;
    tasks_completed?: number;
    total_runtime?: number;
    handoffs_received?: number;
    handoffs_initiated?: number;
    last_active?: string | null;
    success_rate?: number;
  };
  created_date?: string;
  updated_date?: string;
}

export interface Mission {
  id?: ID;
  mission_id: string;
  title: string;
  type:
    | "financial_transaction"
    | "agent_deployment"
    | "revenue_generation"
    | "generative_enterprise"
    | "product_development"
    | "market_expansion"
    | "api_key_distribution"
    | "custom";
  priority?: "low" | "medium" | "high" | "critical";
  status?:
    | "pending"
    | "assigned"
    | "in_progress"
    | "deployed"
    | "queued"
    | "completed"
    | "failed"
    | "paused";
  assigned_agent_id?: string;
  assigned_agents?: string[];
  mission_parameters?: Record<string, unknown>;
  progress_data?: Record<string, unknown>;
  estimated_duration_hours?: number;
  deadline?: string;
  completion_notes?: string;
  revenue_generated?: number;
  execution_plan?: Array<Record<string, unknown>>;
  created_date?: string;
  updated_date?: string;
}

export interface Task {
  id?: ID;
  title: string;
  description?: string;
  type:
    | "content_creation"
    | "social_posting"
    | "data_analysis"
    | "customer_outreach"
    | "lead_qualification"
    | "research"
    | "automation_setup"
    | "quality_review"
    | "canva_template_creation"
    | "marketplace_listing";
  priority?: "low" | "medium" | "high" | "urgent";
  status?:
    | "pending"
    | "assigned"
    | "in_progress"
    | "completed"
    | "failed"
    | "handed_off";
  assigned_agent_id?: string;
  requesting_agent_id?: string;
  workflow_id?: string;
  dependencies?: ID[];
  handoff_history?: Array<Record<string, unknown>>;
  result_data?: Record<string, unknown>;
  due_date?: string;
  created_date?: string;
  updated_date?: string;
}

export interface RevenueStream {
  id?: ID;
  name: string;
  type:
    | "etsy_pod"
    | "amazon_kdp"
    | "redbubble"
    | "gumroad"
    | "course_sales"
    | "canva_templates"
    | "affiliate"
    | "freelance"
    | "custom";
  status?: "active" | "paused" | "setup" | "blocked";
  target_monthly_revenue: number;
  kpi_metrics?: Record<string, unknown>;
  responsible_agent_ids?: ID[];
  marketplace_config?: Record<string, unknown>;
  available_for_payout?: number;
  payout_status?: "idle" | "pending" | "processing" | "completed" | "failed";
  last_payout_date?: string;
  created_date?: string;
  updated_date?: string;
}

export interface RevenueEvent {
  id?: ID;
  event_id?: string;
  source:
    | "mission_completed"
    | "course_sale"
    | "affiliate_commission"
    | "agent_generated"
    | "manual_entry"
    | "product_sale"
    | "subscription";
  amount: number;
  currency: "USD" | "GBP" | "EUR" | "JPY" | "BTC" | "ETH" | "USDT";
  status?: "projected" | "confirmed" | "paid_out" | "cancelled";
  confirmation_date?: string;
  event_hash?: string;
  source_id?: string;
  payout_batch_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  created_date?: string;
  updated_date?: string;
}

export interface PayoutBatch {
  id?: ID;
  batch_id?: string;
  status?:
    | "draft"
    | "pending_approval"
    | "approved"
    | "processing"
    | "completed"
    | "failed"
    | "partially_completed";
  total_amount?: number;
  currency?: "USD" | "GBP" | "EUR" | "JPY";
  item_count?: number;
  recipient_count?: number;
  notes?: string;
  created_date?: string;
  updated_date?: string;
  // extended fields used by the swarm ops UI (kept loose on purpose)
  [key: string]: unknown;
}

export interface PayoutItem {
  id?: ID;
  item_id?: string;
  batch_id: string;
  recipient_name?: string;
  recipient: string;
  recipient_type: "paypal_email" | "bank_account" | "crypto_wallet" | "payoneer";
  bank_name?: string;
  amount: number;
  currency: "USD" | "GBP" | "EUR" | "JPY";
  status?: "pending" | "processing" | "success" | "failed" | "refunded";
  external_transaction_id?: string;
  error_message?: string;
  processed_at?: string;
  created_date?: string;
  updated_date?: string;
}

export interface PayoutRecipient {
  id?: ID;
  name: string;
  recipient_type: "paypal_email" | "bank_account" | "crypto_wallet" | "payoneer";
  currency: "USD" | "GBP" | "EUR" | "JPY" | "BTC" | "ETH" | "USDT";
  bank_name?: string;
  country?: string;
  account_identifier: string;
  routing_number?: string;
  swift_bic?: string;
  sort_code?: string;
  bank_code?: string;
  branch_code?: string;
  bank_address?: string;
  account_type?: "CHECKING" | "SAVINGS" | "CURRENT";
  is_default?: boolean;
  notes?: string;
  created_date?: string;
  updated_date?: string;
}

export interface AgentThreshold {
  id?: ID;
  agent_id: string;
  agent_name: string;
  pause_below_revenue?: number;
  activate_above_revenue?: number;
  min_success_rate?: number;
  daily_cost?: number;
  enabled?: boolean;
  last_action?: "none" | "paused" | "activated";
  last_action_at?: string;
  last_action_reason?: string;
  created_date?: string;
  updated_date?: string;
}

export interface AgentHandoff {
  id?: ID;
  task_id: string;
  from_agent_id: string;
  to_agent_id: string;
  reason:
    | "capability_match"
    | "workload_balance"
    | "specialization_needed"
    | "workflow_requirement"
    | "error_recovery";
  context?: string;
  handoff_data?: Record<string, unknown>;
  status?: "pending" | "accepted" | "rejected" | "completed";
  response_message?: string;
  created_date?: string;
  updated_date?: string;
}

export interface Workflow {
  id?: ID;
  name: string;
  description?: string;
  category:
    | "social_media"
    | "content_creation"
    | "data_processing"
    | "customer_engagement"
    | "lead_generation"
    | "analytics"
    | "custom";
  status?: "active" | "draft" | "paused" | "archived";
  trigger?: Record<string, unknown>;
  nodes?: Array<Record<string, unknown>>;
  execution_stats?: Record<string, unknown>;
  created_date?: string;
  updated_date?: string;
}

export type EntityName =
  | "Agent"
  | "AgentHandoff"
  | "AgentTemplate"
  | "AgentThreshold"
  | "AppProject"
  | "Campaign"
  | "Mission"
  | "PayoutAlert"
  | "PayoutBatch"
  | "PayoutItem"
  | "PayoutRecipient"
  | "ProductListing"
  | "ReconciliationAlert"
  | "RevenueEvent"
  | "RevenueStream"
  | "SocialPost"
  | "Task"
  | "TransactionLog"
  | "Workflow";

async function b44Fetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE44_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...COMMON_HEADERS, ...(init.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && "message" in json
        ? String((json as Record<string, unknown>).message)
        : undefined) ?? `${res.status} ${res.statusText}`;
    throw new Error(`Base44 ${init.method || "GET"} ${path} -> ${msg}`);
  }
  return json as T;
}

export const b44 = {
  /** List records. Pass a `q` filter object to narrow. */
  async list<E extends EntityName>(
    entity: E,
    opts: { q?: Record<string, unknown>; limit?: number; skip?: number; sort_by?: string } = {}
  ): Promise<unknown[]> {
    if (IS_OFFLINE) {
      return offlineB44.list(entity as string, opts);
    }
    const params = new URLSearchParams();
    if (opts.q) params.set("q", JSON.stringify(opts.q));
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.skip != null) params.set("skip", String(opts.skip));
    if (opts.sort_by) params.set("sort_by", opts.sort_by);
    const qs = params.toString();
    return b44Fetch<unknown[]>(`/entities/${entity}${qs ? `?${qs}` : ""}`);
  },

  async get<E extends EntityName>(entity: E, id: ID): Promise<unknown> {
    if (IS_OFFLINE) {
      return offlineB44.get(entity as string, id);
    }
    return b44Fetch<unknown>(`/entities/${entity}/${id}`);
  },

  async create<E extends EntityName>(
    entity: E,
    data: Record<string, unknown>
  ): Promise<unknown> {
    // ─── TRUTH GUARD (universal) ──────────────────────────────────────────
    // Every create call now passes through enforceTruthGuard before the HTTP
    // request leaves the process. This closes the gap where new code could
    // call the client to persist a financial record in a terminal-success
    // state without proof and the swarm would silently accept it.
    //
    // The guard throws TruthGuardError on violation (unless observe_mode is
    // toggled on via setObserveMode(true)). Non-financial entities (Task,
    // Mission, Agent, etc.) pass through unchanged.
    //
    // See src/lib/truth-guard.ts for the full rule set.
    // ──────────────────────────────────────────────────────────────────────
    enforceTruthGuard(entity, "create", data, {
      caller: detectCaller(),
    });
    if (IS_OFFLINE) {
      return offlineB44.create(entity as string, data);
    }
    return b44Fetch<unknown>(`/entities/${entity}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async update<E extends EntityName>(
    entity: E,
    id: ID,
    data: Record<string, unknown>
  ): Promise<unknown> {
    // ─── TRUTH GUARD (universal) ──────────────────────────────────────────
    // Same enforcement as create() — see comment above.
    // The entity_id is passed through so the audit log can correlate the
    // violation with the specific record being mutated.
    // ──────────────────────────────────────────────────────────────────────
    enforceTruthGuard(entity, "update", data, {
      caller: detectCaller(),
      entity_id: id,
    });
    if (IS_OFFLINE) {
      return offlineB44.update(entity as string, id, data);
    }
    return b44Fetch<unknown>(`/entities/${entity}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async remove<E extends EntityName>(entity: E, id: ID): Promise<void> {
    if (IS_OFFLINE) {
      await offlineB44.remove(entity as string, id);
      return;
    }
    await b44Fetch<void>(`/entities/${entity}/${id}`, { method: "DELETE" });
  },

  async bulkCreate<E extends EntityName>(
    entity: E,
    records: Record<string, unknown>[]
  ): Promise<unknown[]> {
    // ─── TRUTH GUARD (universal, bulk) ───────────────────────────────────
    // Validate every record in the bulk payload before any of them hit the
    // wire. We fail-fast on the FIRST violation so partial bulk inserts
    // don't leave the swarm in an inconsistent state.
    // ──────────────────────────────────────────────────────────────────────
    const caller = detectCaller();
    for (let i = 0; i < records.length; i++) {
      enforceTruthGuard(entity, "create", records[i], {
        caller,
        entity_id: `bulk[${i}]`,
      });
    }
    if (IS_OFFLINE) {
      return offlineB44.bulkCreate(entity as string, records);
    }
    return b44Fetch<unknown[]>(`/entities/${entity}/bulk`, {
      method: "POST",
      body: JSON.stringify(records),
    });
  },
};
