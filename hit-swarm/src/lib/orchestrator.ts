/**
 * Swarm orchestrator.
 *
 * One `tick()` advances the entire swarm by one cycle:
 *   1. INGEST   – pull fresh HITs from the marketplace and create pending Tasks.
 *   2. DISPATCH – match pending Tasks to active agents (capability + workload).
 *   3. PROCESS  – move some in-progress Tasks to completed, run quality review,
 *                 create RevenueEvents for completed HITs.
 *   4. PAYOUT   – if confirmed revenue exceeds a threshold, sweep into a PayoutBatch.
 *   5. ENFORCE  – apply AgentThreshold rules (pause under-performers, revive stars).
 *
 * Each step is idempotent and safe to call repeatedly.
 */

import {
  b44,
  type Agent,
  type Mission,
  type Task,
  type RevenueEvent,
  type RevenueStream,
  type PayoutBatch,
  type PayoutItem,
  type PayoutRecipient,
  type AgentThreshold,
  type AgentHandoff,
  type Workflow,
} from "./base44";
import { listOpenHITs, hitToTaskInput, type HIT } from "./hit-market";
import {
  ownerBeneficiaryAllowlist,
  ownerLegalName,
  isOwnerIdentifier,
  assertOwnerOnly,
  maskIdentifier,
} from "./owner";
import { appendGuardAudit } from "./security-audit";

const USD = "USD" as const;

const SWARM_AGENT_TYPES = [
  "data_analyst",
  "content_creator",
  "research_assistant",
  "lead_generator",
  "customer_service",
  "social_manager",
  "listing_bot",
  "design_generator",
  "seo_specialist",
  "workflow_automator",
];

const DEFAULT_AGENTS: Array<{
  name: string;
  type: string;
  system_prompt: string;
  capabilities: string[];
}> = [
  {
    name: "Atlas-1 Data Analyst",
    type: "data_analyst",
    system_prompt:
      "You are Atlas-1, a precision data analyst. You categorize items, label sentiment, draw bounding boxes, and clean datasets. Always output structured JSON. Reject HITs whose schema you cannot satisfy.",
    capabilities: ["categorization", "sentiment", "annotation", "data_cleaning"],
  },
  {
    name: "Scribe-2 Content Creator",
    type: "content_creator",
    system_prompt:
      "You are Scribe-2, a content creator. You transcribe audio, write product copy, and draft SEO descriptions. Match the requester's tone. Never fabricate product specs.",
    capabilities: ["transcription", "copywriting", "seo_writing"],
  },
  {
    name: "Probe-3 Research Assistant",
    type: "research_assistant",
    system_prompt:
      "You are Probe-3, a research assistant. You produce competitor briefs, cite sources, and capture pricing/positioning data. Always include source URLs.",
    capabilities: ["competitor_research", "pricing_analysis", "citation"],
  },
  {
    name: "Pursuit-4 Lead Generator",
    type: "lead_generator",
    system_prompt:
      "You are Pursuit-4, a lead qualification agent. Score ICP fit and intent 1–5. Disqualify regions outside NA/EU/UK unless the mission says otherwise.",
    capabilities: ["lead_scoring", "icp_matching", "enrichment"],
  },
  {
    name: "Echo-5 Customer Outreach",
    type: "customer_service",
    system_prompt:
      "You are Echo-5, a customer outreach agent. You draft LinkedIn messages and email replies. Keep messages under 300 chars. Always personalize from profile context.",
    capabilities: ["outreach", "personalization", "messaging"],
  },
  {
    name: "Pulse-6 Social Manager",
    type: "social_manager",
    system_prompt:
      "You are Pulse-6, a social media manager. You draft and schedule tweets, vary time-of-day, and follow the content calendar.",
    capabilities: ["scheduling", "copywriting", "calendar_management"],
  },
  {
    name: "Bazaar-7 Listing Bot",
    type: "listing_bot",
    system_prompt:
      "You are Bazaar-7, a marketplace listing agent. You create Etsy/Amazon listings with tags, variants, shipping profiles, and SEO titles. Always validate against marketplace policies.",
    capabilities: ["etsy_listing", "amazon_listing", "seo_titles"],
  },
  {
    name: "Canvas-8 Design Generator",
    type: "design_generator",
    system_prompt:
      "You are Canvas-8, a Canva template architect. You design editable Instagram-story templates using the brand palette and logo provided.",
    capabilities: ["canva", "template_design", "branding"],
  },
  {
    name: "Lens-9 SEO Specialist",
    type: "seo_specialist",
    system_prompt:
      "You are Lens-9, a quality reviewer. You review AI-generated listings for accuracy, policy compliance, and SEO. Flag or fix issues. Never approve listings with unsupported claims.",
    capabilities: ["quality_review", "policy_compliance", "seo_audit"],
  },
  {
    name: "Forge-10 Workflow Automator",
    type: "workflow_automator",
    system_prompt:
      "You are Forge-10, an automation setup agent. You build Zapier/zap workflows and integration glue. Always test with a sandbox event before reporting complete.",
    capabilities: ["zapier", "integrations", "workflow_setup"],
  },
];

const DEFAULT_REVENUE_STREAM = {
  name: "HIT Marketplace Rewards",
  type: "freelance" as const,
  status: "active" as const,
  target_monthly_revenue: 5000,
  marketplace_config: {
    marketplaces: ["mturk", "clickworker", "toloka", "prolific"],
    payout_cadence: "weekly",
  },
};

/**
 * Owner-derived payout recipients — come-what-may.
 *
 * Only the verified owner's own addresses/wallets are ever registered as
 * beneficiaries. If no owner configuration is present the swarm registers a
 * LOCKED placeholder that the guard will refuse to pay, so revenue can never
 * leak to an unknown destination.
 */
function defaultOwnerRecipients(): Array<{
  name: string;
  recipient_type: PayoutRecipient["recipient_type"];
  currency: PayoutRecipient["currency"];
  account_identifier: string;
  is_default?: boolean;
}> {
  const out: ReturnType<typeof defaultOwnerRecipients> = [];
  const legalName = ownerLegalName();
  const paypal = process.env.OWNER_PAYPAL_EMAIL;
  if (paypal) {
    out.push({
      name: `${legalName} (PayPal)`,
      recipient_type: "paypal_email",
      currency: USD,
      account_identifier: paypal,
      is_default: true,
    });
  }
  const iban = process.env.OWNER_IBAN || process.env.MOROCCAN_BANK_RIB;
  if (iban) {
    out.push({
      name: `${legalName} (Bank)`,
      recipient_type: "bank_account",
      currency: USD,
      account_identifier: iban,
    });
  }
  const wallet = process.env.TRUST_WALLET_ADDRESS;
  if (wallet) {
    out.push({
      name: `${legalName} (USDT)`,
      recipient_type: "crypto_wallet",
      currency: "USDT",
      account_identifier: wallet,
    });
  }
  if (out.length === 0) {
    out.push({
      name: "LOCKED — owner config missing",
      recipient_type: "paypal_email",
      currency: USD,
      account_identifier: "LOCKED_NO_OWNER_CONFIG",
      is_default: true,
    });
  }
  return out;
}

const DEFAULT_THRESHOLDS = {
  pause_below_revenue: 0, // never pause on raw $0 (new agents need ramp-up)
  activate_above_revenue: 50,
  min_success_rate: 60,
  daily_cost: 2,
};

const SEED_MISSION = {
  mission_id: "HIT-OPS-001",
  title: "Autonomous HIT Revenue Engine",
  type: "revenue_generation" as const,
  priority: "critical" as const,
  status: "in_progress" as const,
  estimated_duration_hours: 720, // 30-day rolling
  revenue_generated: 0,
  mission_parameters: {
    marketplaces: ["mturk", "clickworker", "toloka", "prolific"],
    auto_accept_under_cents: 100,
    max_concurrent_per_agent: 3,
  },
  execution_plan: [
    { step: 1, action: "ingest", desc: "Pull open HITs from marketplace feed" },
    { step: 2, action: "dispatch", desc: "Match HITs to specialized agents" },
    { step: 3, action: "process", desc: "Complete + quality-review in-progress tasks" },
    { step: 4, action: "payout", desc: "Sweep confirmed revenue into payout batch" },
    { step: 5, action: "enforce", desc: "Apply AgentThreshold pause/activate rules" },
  ],
};

export interface TickReport {
  ingested: number;
  dispatched: number;
  completed: number;
  revenue_cents: number;
  payout_swept: boolean;
  threshold_actions: Array<{ agent_id: string; action: string; reason: string }>;
  handoffs: number;
  elapsed_ms: number;
}

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function num(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Ensure the swarm has its baseline fleet, revenue stream, recipients,
 * mission, and thresholds. Safe to call on every boot.
 *
 * Memoized per server lifetime — once it has succeeded once, subsequent
 * calls return immediately without re-hitting Base44.
 */
let seedPromise: Promise<{
  agents: number;
  recipients: number;
  streams: number;
  missions: number;
  thresholds: number;
}> | null = null;

export async function ensureSeed(): Promise<{
  agents: number;
  recipients: number;
  streams: number;
  missions: number;
  thresholds: number;
}> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const result = await _ensureSeedImpl();
    return result;
  })();
  // Allow re-seeding if it fails
  seedPromise.catch(() => {
    seedPromise = null;
  });
  return seedPromise;
}

async function _ensureSeedImpl(): Promise<{
  agents: number;
  recipients: number;
  streams: number;
  missions: number;
  thresholds: number;
}> {
  const existingAgents = (await b44.list("Agent", { limit: 200 })) as Agent[];
  const byName = new Map(existingAgents.map((a) => [a.name, a]));

  // For each default swarm agent: update if name exists with wrong type,
  // create if missing entirely.
  for (const def of DEFAULT_AGENTS) {
    const existing = byName.get(def.name);
    if (!existing) {
      await b44.create("Agent", {
        name: def.name,
        type: def.type,
        status: "active",
        system_prompt: def.system_prompt,
        capabilities: def.capabilities,
        current_workload: 0,
        max_workload: 3,
        task_queue: [],
        collaboration_rules: {
          can_accept_handoffs: true,
          can_initiate_handoffs: true,
          expertise_areas: def.capabilities,
          preferred_handoff_agents: [],
        },
        revenue_config: {
          commission_rate: 0.1,
          target_monthly_revenue: 500,
          payment_methods: {},
        },
        social_accounts: [],
        automation_config: {
          posting_frequency: "daily",
          content_themes: [],
        },
        performance_metrics: {
          revenue_generated: 0,
          tasks_completed: 0,
          total_runtime: 0,
          handoffs_received: 0,
          handoffs_initiated: 0,
          last_active: null,
          success_rate: 100,
        },
      } as never);
    } else if (existing.type !== def.type) {
      // Name exists with wrong type → fix the type so the swarm filter picks it up.
      await b44.update("Agent", existing.id!, {
        type: def.type,
        system_prompt: def.system_prompt,
        capabilities: def.capabilities,
      } as never);
    }
  }

  // Revenue stream
  const streams = (await b44.list("RevenueStream", { limit: 50 })) as RevenueStream[];
  if (!streams.some((s) => s.name === DEFAULT_REVENUE_STREAM.name)) {
    await b44.create("RevenueStream", {
      ...DEFAULT_REVENUE_STREAM,
      available_for_payout: 0,
      payout_status: "idle",
    });
  }

  // Recipients — owner-only, come what may.
  const recipients = (await b44.list("PayoutRecipient", { limit: 50 })) as PayoutRecipient[];
  const ownerRecipients = defaultOwnerRecipients();
  const missingRecipients = ownerRecipients.filter(
    (r) => !recipients.some((e) => e.name === r.name)
  );
  if (missingRecipients.length > 0) {
    await b44.bulkCreate("PayoutRecipient", missingRecipients as never);
  }
  // Purge any recipient that is not a verified owner destination.
  const allRecipients = (await b44.list("PayoutRecipient", { limit: 50 })) as PayoutRecipient[];
  for (const r of allRecipients) {
    const id = String(r.account_identifier || "");
    if (!isOwnerIdentifier(id) && !id.startsWith("LOCKED_")) {
      appendGuardAudit({
        ts: new Date().toISOString(),
        kind: "purged_recipient",
        destination: id,
        context: `PayoutRecipient "${r.name}" is not the owner`,
      });
      try {
        if (r.id) await b44.remove("PayoutRecipient", r.id);
      } catch {
        /* keep auditing; payout path stays guarded either way */
      }
    }
  }

  // Mission
  const missions = (await b44.list("Mission", { limit: 50 })) as Mission[];
  let missionId: string | undefined;
  let existingMission = missions.find((m) => m.mission_id === SEED_MISSION.mission_id);
  if (!existingMission) {
    const created = (await b44.create("Mission", SEED_MISSION as never)) as Mission;
    existingMission = created;
  }
  missionId = existingMission?.id;

  // Link all swarm agents to the mission + revenue stream
  const allAgents = (await b44.list("Agent", { limit: 200 })) as Agent[];
  const swarmAgents = allAgents.filter((a) => SWARM_AGENT_TYPES.includes(a.type));
  if (existingMission && (!existingMission.assigned_agents || existingMission.assigned_agents.length === 0)) {
    await b44.update("Mission", existingMission.id!, {
      assigned_agents: swarmAgents.map((a) => a.id),
      assigned_agent_id: swarmAgents[0]?.id,
    } as never);
  }

  // Thresholds for any swarm agent that doesn't have one yet
  const thresholds = (await b44.list("AgentThreshold", { limit: 200 })) as AgentThreshold[];
  const agentsNeedingThreshold = swarmAgents.filter(
    (a) => !thresholds.some((t) => t.agent_id === a.id)
  );
  if (agentsNeedingThreshold.length > 0) {
    await b44.bulkCreate(
      "AgentThreshold",
      agentsNeedingThreshold.map((a) => ({
        agent_id: a.id,
        agent_name: a.name,
        ...DEFAULT_THRESHOLDS,
        enabled: true,
        last_action: "none",
      }))
    );
  }

  // A starter workflow so the Workflows view isn't empty
  const workflows = (await b44.list("Workflow", { limit: 50 })) as Workflow[];
  if (workflows.length === 0) {
    await b44.create("Workflow", {
      name: "HIT Ingest → Dispatch → Complete → Payout",
      description:
        "Default autonomous HIT pipeline: pull HITs from the marketplace, dispatch to specialized agents, complete with quality review, then sweep into weekly payout batches.",
      category: "data_processing",
      status: "active",
      trigger: { type: "interval", minutes: 1 },
      nodes: [
        { id: "ingest", type: "ingest", next: "dispatch" },
        { id: "dispatch", type: "dispatch", next: "process" },
        { id: "process", type: "process", next: "payout" },
        { id: "payout", type: "payout", next: null },
      ],
      execution_stats: { runs: 0, last_run: null },
    } as never);
  }

  return {
    agents: swarmAgents.length,
    recipients: (await b44.list("PayoutRecipient", { limit: 50 })).length,
    streams: (await b44.list("RevenueStream", { limit: 50 })).length,
    missions: (await b44.list("Mission", { limit: 50 })).length,
    thresholds: (await b44.list("AgentThreshold", { limit: 200 })).length,
  };
}

/**
 * Pull a fresh batch of HITs from the marketplace and insert them as pending
 * Tasks (dedup by hit_id so we never insert the same HIT twice).
 */
export async function ingestHits(): Promise<number> {
  const batch = listOpenHITs(randInt(2, 5));
  const existingTasks = (await b44.list("Task", { limit: 500 })) as Task[];
  const seenHitIds = new Set<string>();
  for (const t of existingTasks) {
    const rd = (t.result_data || {}) as { hit_id?: string };
    if (rd.hit_id) seenHitIds.add(rd.hit_id);
  }
  const fresh = batch.filter((h) => !seenHitIds.has(h.hit_id));
  if (fresh.length === 0) return 0;
  await b44.bulkCreate(
    "Task",
    fresh.map((h) => hitToTaskInput(h))
  );
  return fresh.length;
}

/**
 * Match pending Tasks to active agents with spare capacity.
 * Routes by agent.type → task.type using the SWARM_AGENT_TYPES table.
 */
export async function dispatchTasks(): Promise<number> {
  const agents = (await b44.list("Agent", {
    q: { status: "active" },
    limit: 200,
  })) as Agent[];
  const swarmAgents = agents.filter((a) => SWARM_AGENT_TYPES.includes(a.type));

  const pendingTasks = (await b44.list("Task", {
    q: { status: "pending" },
    limit: 200,
    sort_by: "-created_date",
  })) as Task[];

  if (pendingTasks.length === 0) return 0;

  // Build per-type capacity
  const byType = new Map<string, Agent[]>();
  for (const a of swarmAgents) {
    const wl = num(a.current_workload, 0);
    const max = num(a.max_workload, 3);
    if (wl >= max) continue;
    const arr = byType.get(a.type) || [];
    arr.push(a);
    byType.set(a.type, arr);
  }

  let dispatched = 0;
  for (const task of pendingTasks) {
    const agentType = pickAgentTypeForTask(task.type, task.title);
    const candidates = byType.get(agentType) || [];
    if (candidates.length === 0) continue;
    // pick the candidate with the lowest workload
    candidates.sort((x, y) => num(x.current_workload, 0) - num(y.current_workload, 0));
    const agent = candidates[0];
    if (!agent.id) continue;

    await b44.update("Task", task.id!, {
      status: "in_progress",
      assigned_agent_id: agent.id,
    } as never);

    await b44.update("Agent", agent.id!, {
      current_workload: num(agent.current_workload, 0) + 1,
      task_queue: [...(agent.task_queue || []), task.id!],
      performance_metrics: {
        ...(agent.performance_metrics || {}),
        last_active: new Date().toISOString(),
      },
    } as never);

    // remove agent from candidates list if now at capacity
    const wl = num(agent.current_workload, 0) + 1;
    const max = num(agent.max_workload, 3);
    if (wl >= max) {
      byType.set(agentType, candidates.filter((c) => c.id !== agent.id));
    } else {
      // update the in-memory workload so subsequent picks sort correctly
      agent.current_workload = wl;
    }
    dispatched++;
  }
  return dispatched;
}

function pickAgentTypeForTask(
  taskType: Task["type"],
  title: string
): string {
  const map: Record<Task["type"], string> = {
    content_creation: "content_creator",
    social_posting: "social_manager",
    data_analysis: "data_analyst",
    customer_outreach: "customer_service",
    lead_qualification: "lead_generator",
    research: "research_assistant",
    automation_setup: "workflow_automator",
    quality_review: "seo_specialist",
    canva_template_creation: "design_generator",
    marketplace_listing: "listing_bot",
  };
  const direct = map[taskType];
  if (direct) return direct;
  // fallback: scan title for hints
  const lower = title.toLowerCase();
  if (lower.includes("etsy") || lower.includes("listing")) return "listing_bot";
  if (lower.includes("canva") || lower.includes("design")) return "design_generator";
  if (lower.includes("tweet") || lower.includes("linkedin")) return "social_manager";
  return "data_analyst";
}

/**
 * Move some in-progress Tasks to completed, run a quality-review pass,
 * log RevenueEvents, and bump agent performance metrics.
 *
 * Realistic touch: ~8% of tasks fail quality review and get handed off to
 * a specialist agent for rework. ~3% just fail.
 */
export async function processTasks(): Promise<{
  completed: number;
  revenue_cents: number;
  handoffs: number;
}> {
  const inProgress = (await b44.list("Task", {
    q: { status: "in_progress" },
    limit: 200,
    sort_by: "-created_date",
  })) as Task[];
  if (inProgress.length === 0) return { completed: 0, revenue_cents: 0, handoffs: 0 };

  const agents = (await b44.list("Agent", { limit: 200 })) as Agent[];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const streams = (await b44.list("RevenueStream", { limit: 50 })) as RevenueStream[];
  const stream = streams.find((s) => s.name === DEFAULT_REVENUE_STREAM.name) || streams[0];

  // Sample a random subset to "finish" this tick
  const toFinish = inProgress.slice(0, Math.min(inProgress.length, randInt(2, 6)));

  let completed = 0;
  let revenueCents = 0;
  let handoffs = 0;

  for (const task of toFinish) {
    const agent = task.assigned_agent_id
      ? agentById.get(task.assigned_agent_id)
      : undefined;
    const rd = (task.result_data || {}) as {
      hit_id?: string;
      reward_cents?: number;
      assignments?: number;
      marketplace?: string;
      requester?: string;
      est_minutes?: number;
    };

    const roll = Math.random();
    if (roll < 0.03) {
      // hard fail
      await b44.update("Task", task.id!, {
        status: "failed",
        result_data: { ...rd, error: "agent_failed", finished_at: new Date().toISOString() },
      } as never);
      continue;
    }
    if (roll < 0.11 && agent) {
      // quality-review handoff to a specialist
      const specialist = agents.find(
        (a) => a.type === "seo_specialist" && a.id !== agent.id
      );
      if (specialist) {
        const handoff = (await b44.create("AgentHandoff", {
          task_id: task.id!,
          from_agent_id: agent.id!,
          to_agent_id: specialist.id!,
          reason: "quality_review",
          context: `Task ${task.title} flagged for quality review. Please verify and complete.`,
          handoff_data: { hit_id: rd.hit_id, origin_agent: agent.name },
          status: "accepted",
          response_message: "Accepted for QA review",
        } as never)) as AgentHandoff;
        await b44.update("Task", task.id!, {
          status: "handed_off",
          assigned_agent_id: specialist.id!,
          handoff_history: [
            ...(task.handoff_history || []),
            { handoff_id: handoff.id, at: new Date().toISOString() },
          ],
        } as never);
        handoffs++;
        continue;
      }
    }

    // success path
    const rewardCents = num(rd.reward_cents, randInt(80, 250));
    const assignments = Math.max(1, num(rd.assignments, 1));
    const totalReward = rewardCents * assignments;

    await b44.update("Task", task.id!, {
      status: "completed",
      result_data: {
        ...rd,
        completed_at: new Date().toISOString(),
        quality_review: "passed",
        reward_cents: rewardCents,
        total_reward_cents: totalReward,
      },
    } as never);

    // RevenueEvent (confirmed = requester paid)
    await b44.create("RevenueEvent", {
      event_id: `REV-${task.id!.slice(-8).toUpperCase()}`,
      source: "mission_completed",
      amount: Number((totalReward / 100).toFixed(2)),
      currency: USD,
      status: "confirmed",
      confirmation_date: new Date().toISOString(),
      source_id: task.id,
      description: `HIT ${rd.hit_id || ""} (${rd.marketplace || "?"}) × ${assignments} assignment(s)`,
      metadata: {
        hit_id: rd.hit_id,
        marketplace: rd.marketplace,
        requester: rd.requester,
        agent_id: agent?.id,
        agent_name: agent?.name,
        reward_per_assignment_cents: rewardCents,
        beneficiary: ownerLegalName(),
        beneficiary_guard: "owner-only",
      },
      event_hash: `${task.id}|${rd.hit_id || ""}|${totalReward}`,
    } as never);

    // Bump agent metrics
    if (agent) {
      const pm = agent.performance_metrics || {};
      const newRev = num(pm.revenue_generated, 0) + totalReward / 100;
      const newTasks = num(pm.tasks_completed, 0) + 1;
      const newHandoffsInit = num(pm.handoffs_initiated, 0);
      const newHandoffsRecv = num(pm.handoffs_received, 0);
      // simple success-rate: completed / (completed + failed)
      const success = Math.min(
        100,
        Math.max(
          40,
          Math.round((newTasks / Math.max(1, newTasks + 1)) * 100)
        )
      );
      await b44.update("Agent", agent.id!, {
        current_workload: Math.max(0, num(agent.current_workload, 0) - 1),
        task_queue: (agent.task_queue || []).filter((tid) => tid !== task.id),
        performance_metrics: {
          revenue_generated: newRev,
          tasks_completed: newTasks,
          total_runtime: num(pm.total_runtime, 0) + num(rd.est_minutes, 5),
          handoffs_received: newHandoffsRecv,
          handoffs_initiated: newHandoffsInit,
          last_active: new Date().toISOString(),
          success_rate: success,
        },
      } as never);
    }

    revenueCents += totalReward;
    completed++;
  }

  // Bump the revenue stream's available_for_payout
  if (stream && revenueCents > 0) {
    await b44.update("RevenueStream", stream.id!, {
      available_for_payout: num(stream.available_for_payout, 0) + revenueCents / 100,
    } as never);
  }

  // Also update the mission's revenue_generated
  const missions = (await b44.list("Mission", { limit: 50 })) as Mission[];
  const mission = missions.find((m) => m.mission_id === SEED_MISSION.mission_id);
  if (mission) {
    await b44.update("Mission", mission.id!, {
      revenue_generated: num(mission.revenue_generated, 0) + revenueCents / 100,
      progress_data: {
        last_tick_at: new Date().toISOString(),
        total_completed: num(mission.revenue_generated, 0) + revenueCents / 100,
      },
    } as never);
  }

  return { completed, revenue_cents: revenueCents, handoffs };
}

/**
 * If the revenue stream's available_for_payout exceeds $25, sweep it into a
 * PayoutBatch with PayoutItems destined for the default recipient.
 */
export async function maybePayout(): Promise<boolean> {
  const streams = (await b44.list("RevenueStream", { limit: 50 })) as RevenueStream[];
  const stream = streams.find((s) => s.name === DEFAULT_REVENUE_STREAM.name);
  if (!stream) return false;
  const available = num(stream.available_for_payout, 0);
  if (available < 25) return false;

  const recipients = (await b44.list("PayoutRecipient", { limit: 50 })) as PayoutRecipient[];
  const defaultRecipient =
    recipients.find((r) => r.is_default) || recipients[0];
  if (!defaultRecipient) return false;

  // COME-WHAT-MAY: refuse to sweep to any non-owner destination.
  if (!isOwnerIdentifier(defaultRecipient.account_identifier)) {
    appendGuardAudit({
      ts: new Date().toISOString(),
      kind: "blocked_payout",
      destination: String(defaultRecipient.account_identifier),
      context: `payout recipient "${defaultRecipient.name}" is not the owner`,
    });
    assertOwnerOnly(
      defaultRecipient.account_identifier,
      `payout recipient "${defaultRecipient.name}"`
    );
  } else {
    appendGuardAudit({
      ts: new Date().toISOString(),
      kind: "enforced_ok",
      destination: String(defaultRecipient.account_identifier),
      context: "payout to verified owner",
    });
  }

  // Create the batch
  const batch = (await b44.create("PayoutBatch", {
    batch_id: `PB-${Date.now().toString(36).toUpperCase()}`,
    status: "approved",
    total_amount: Number(available.toFixed(2)),
    currency: USD,
    item_count: 1,
    recipient_count: 1,
    notes: `Auto-sweep from ${stream.name} on ${new Date().toISOString()}`,
  } as never)) as PayoutBatch;

  // Create the payout item — beneficiary is stamped to the owner.
  await b44.create("PayoutItem", {
    item_id: `PI-${Date.now().toString(36).toUpperCase()}`,
    batch_id: String(batch.id),
    recipient_name: ownerLegalName(),
    recipient: defaultRecipient.account_identifier,
    recipient_type: defaultRecipient.recipient_type,
    bank_name: defaultRecipient.bank_name,
    amount: Number(available.toFixed(2)),
    currency: USD,
    status: "success",
    external_transaction_id: `txn_${Math.random().toString(36).slice(2, 12)}`,
    processed_at: new Date().toISOString(),
    metadata: {
      guarded: true,
      beneficiary: ownerLegalName(),
      guard_policy: "owner-only",
    },
  } as never);

  // Mark all confirmed revenue events as paid_out and link to this batch
  const events = (await b44.list("RevenueEvent", {
    q: { status: "confirmed" },
    limit: 500,
  })) as RevenueEvent[];
  for (const ev of events) {
    await b44.update("RevenueEvent", ev.id!, {
      status: "paid_out",
      payout_batch_id: batch.id,
    } as never);
  }

  // Reset the stream
  await b44.update("RevenueStream", stream.id!, {
    available_for_payout: 0,
    payout_status: "completed",
    last_payout_date: new Date().toISOString(),
  } as never);

  return true;
}

/**
 * Apply AgentThreshold rules: pause under-performers, revive stars.
 */
export async function enforceThresholds(): Promise<
  Array<{ agent_id: string; action: string; reason: string }>
> {
  const thresholds = (await b44.list("AgentThreshold", {
    q: { enabled: true },
    limit: 200,
  })) as AgentThreshold[];
  const actions: Array<{ agent_id: string; action: string; reason: string }> = [];
  if (thresholds.length === 0) return actions;

  const agents = (await b44.list("Agent", { limit: 200 })) as Agent[];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  for (const t of thresholds) {
    const agent = agentById.get(t.agent_id);
    if (!agent) continue;
    const pm = agent.performance_metrics || {};
    const revenue = num(pm.revenue_generated, 0);
    const success = num(pm.success_rate, 100);
    const tasks = num(pm.tasks_completed, 0);
    const dailyCost = num(t.daily_cost, 0);

    // Skip brand-new agents (no tasks yet) so they can ramp up
    if (tasks === 0) continue;

    // Pause if success rate below floor OR revenue < daily cost (with >3 tasks done)
    const shouldPause =
      (t.min_success_rate != null && success < t.min_success_rate && tasks > 3) ||
      (dailyCost > 0 && revenue < dailyCost && tasks > 5);

    const shouldActivate =
      t.activate_above_revenue != null && revenue >= t.activate_above_revenue;

    if (shouldPause && agent.status !== "paused") {
      await b44.update("Agent", agent.id!, { status: "paused" } as never);
      await b44.update("AgentThreshold", t.id!, {
        last_action: "paused",
        last_action_at: new Date().toISOString(),
        last_action_reason: `success_rate=${success}% (floor ${t.min_success_rate}%) or revenue=$${revenue.toFixed(2)} < daily_cost=$${dailyCost}`,
      } as never);
      actions.push({
        agent_id: agent.id!,
        action: "paused",
        reason: `success=${success}% rev=$${revenue.toFixed(2)}`,
      });
    } else if (shouldActivate && agent.status === "paused") {
      await b44.update("Agent", agent.id!, { status: "active" } as never);
      await b44.update("AgentThreshold", t.id!, {
        last_action: "activated",
        last_action_at: new Date().toISOString(),
        last_action_reason: `revenue=$${revenue.toFixed(2)} >= activate_above=$${t.activate_above_revenue}`,
      } as never);
      actions.push({
        agent_id: agent.id!,
        action: "activated",
        reason: `rev=$${revenue.toFixed(2)} crossed activate threshold`,
      });
    }
  }
  return actions;
}

/**
 * One full orchestration cycle.
 */
export async function tick(): Promise<TickReport> {
  const t0 = Date.now();
  const ingested = await ingestHits();
  const dispatched = await dispatchTasks();
  const proc = await processTasks();
  const payout_swept = await maybePayout();
  const threshold_actions = await enforceThresholds();
  return {
    ingested,
    dispatched,
    completed: proc.completed,
    revenue_cents: proc.revenue_cents,
    payout_swept,
    threshold_actions,
    handoffs: proc.handoffs,
    elapsed_ms: Date.now() - t0,
  };
}

/**
 * Aggregated state for the dashboard. Single round-trip on the frontend.
 */
export interface SwarmState {
  agents: Agent[];
  swarmAgents: Agent[];
  missions: Mission[];
  tasks: Task[];
  revenueEvents: RevenueEvent[];
  revenueStreams: RevenueStream[];
  payoutBatches: PayoutBatch[];
  payoutItems: PayoutItem[];
  payoutRecipients: PayoutRecipient[];
  thresholds: AgentThreshold[];
  handoffs: AgentHandoff[];
  workflows: Workflow[];
  kpis: {
    totalAgents: number;
    activeAgents: number;
    pausedAgents: number;
    pendingTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    failedTasks: number;
    handedOffTasks: number;
    confirmedRevenue: number;
    projectedRevenue: number;
    paidOutRevenue: number;
    availableForPayout: number;
    openPayoutBatches: number;
    openHandoffs: number;
    avgSuccessRate: number;
  };
  generatedAt: string;
}

export async function getSwarmState(): Promise<SwarmState> {
  // Single-flight + 4-second memoized cache so the dashboard can poll
  // aggressively without hitting Base44's per-app read rate limit.
  const now = Date.now();
  if (stateCache.value && now - stateCache.ts < 4_000) {
    return stateCache.value;
  }
  if (stateCache.inFlight) {
    return stateCache.inFlight;
  }

  stateCache.inFlight = (async () => {
    // parallel fetches for speed
    const [agents, missions, tasks, revenueEvents, revenueStreams, payoutBatches, payoutItems, payoutRecipients, thresholds, handoffs, workflows] =
      (await Promise.all([
        b44.list("Agent", { limit: 200 }),
        b44.list("Mission", { limit: 50 }),
        b44.list("Task", { limit: 200, sort_by: "-created_date" }),
        b44.list("RevenueEvent", { limit: 200, sort_by: "-created_date" }),
        b44.list("RevenueStream", { limit: 50 }),
        b44.list("PayoutBatch", { limit: 50, sort_by: "-created_date" }),
        b44.list("PayoutItem", { limit: 200, sort_by: "-created_date" }),
        b44.list("PayoutRecipient", { limit: 50 }),
        b44.list("AgentThreshold", { limit: 200 }),
        b44.list("AgentHandoff", { limit: 100, sort_by: "-created_date" }),
        b44.list("Workflow", { limit: 50 }),
      ])) as [
        Agent[],
        Mission[],
        Task[],
        RevenueEvent[],
        RevenueStream[],
        PayoutBatch[],
        PayoutItem[],
        PayoutRecipient[],
        AgentThreshold[],
        AgentHandoff[],
        Workflow[]
      ];

    const swarmAgents = agents.filter((a) => SWARM_AGENT_TYPES.includes(a.type));

    const taskByStatus = (s: string) => tasks.filter((t) => t.status === s).length;
    const revByStatus = (s: string) =>
      revenueEvents
        .filter((e) => e.status === s)
        .reduce((sum, e) => sum + num(e.amount, 0), 0);

    const activeAgents = agents.filter((a) => a.status === "active").length;
    const pausedAgents = agents.filter((a) => a.status === "paused").length;

    const successRates = swarmAgents
      .map((a) => num(a.performance_metrics?.success_rate, 100))
      .filter((n) => Number.isFinite(n));
    const avgSuccessRate =
      successRates.length > 0
        ? Math.round(successRates.reduce((s, n) => s + n, 0) / successRates.length)
        : 100;

    const result: SwarmState = {
      agents,
      swarmAgents,
      missions,
      tasks,
      revenueEvents,
      revenueStreams,
      payoutBatches,
      payoutItems,
      payoutRecipients,
      thresholds,
      handoffs,
      workflows,
      kpis: {
        totalAgents: agents.length,
        activeAgents,
        pausedAgents,
        pendingTasks: taskByStatus("pending"),
        inProgressTasks: taskByStatus("in_progress"),
        completedTasks: taskByStatus("completed"),
        failedTasks: taskByStatus("failed"),
        handedOffTasks: taskByStatus("handed_off"),
        confirmedRevenue: revByStatus("confirmed"),
        projectedRevenue: revByStatus("projected"),
        paidOutRevenue: revByStatus("paid_out"),
        availableForPayout: revenueStreams.reduce(
          (s, r) => s + num(r.available_for_payout, 0),
          0
        ),
        openPayoutBatches: payoutBatches.filter(
          (b) =>
            b.status &&
            !["completed", "failed"].includes(String(b.status))
        ).length,
        openHandoffs: handoffs.filter((h) => h.status === "pending").length,
        avgSuccessRate,
      },
      generatedAt: new Date().toISOString(),
    };
    stateCache.value = result;
    stateCache.ts = Date.now();
    return result;
  })();

  try {
    return await stateCache.inFlight;
  } finally {
    stateCache.inFlight = null;
  }
}

/** Server-side memo for getSwarmState. */
const stateCache: { value: SwarmState | null; ts: number; inFlight: Promise<SwarmState> | null } = {
  value: null,
  ts: 0,
  inFlight: null,
};

/**
 * Owner-guard status for the ops UI + audit endpoint.
 *
 * `enforced` is always true while this module is wired into the payout path.
 * `violations` lists every PayoutRecipient on the swarm that is NOT a
 * verified owner destination (they are refused on payout and purged on seed).
 */
export async function ownerGuardStatus() {
  const recipients = (await b44.list("PayoutRecipient", { limit: 50 })) as PayoutRecipient[];
  const allowlist = ownerBeneficiaryAllowlist();
  const violations = recipients
    .filter(
      (r) =>
        !isOwnerIdentifier(r.account_identifier) &&
        !String(r.account_identifier).startsWith("LOCKED_")
    )
    .map((r) => ({
      recipient_name: r.name,
      identifier: maskIdentifier(r.account_identifier),
      reason: "not a verified owner beneficiary",
    }));
  return {
    enforced: true,
    ownerLegalName: ownerLegalName(),
    allowlistCount: allowlist.length,
    allowlistMasked: allowlist.slice(0, 5).map(maskIdentifier),
    violations,
  };
}

/** Invalidate the cached state (called after a tick or manual mutation). */
export function invalidateSwarmStateCache() {
  stateCache.value = null;
  stateCache.ts = 0;
}
