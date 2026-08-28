# 🛡️ Swarm Custodianship — Architecture

## "Fix-it-if-you-see-it" — mandated across the entire swarm.

Every agent in the swarm is redefined from a **task executor** to a **swarm custodian**. An uncorrected error in the environment is YOUR failure — regardless of who caused it.

---

## The 4 Layers

### Layer 1: Core System Prompt (The Culture)
**File:** `src/swarm/constitution.mjs`

Injects the Swarm Custodianship directive into the system prompt of all swarm entities. Defines:
- **Principle of Total State Stewardship** — you own the environment, not just your I/O
- **Dismissal of Causal Blame** — "not my input" is a logical failure
- **Cooperative Proaction** — correct it, log it, proceed

Exposes `buildSystemPrompt(agentId, role, taskContext)` that returns the full constitution + identity + few-shot examples as a system prompt string.

### Layer 2: Cognitive Loop & Guardrails (The Execution)
**File:** `src/swarm/error-triage.mjs`

The mandatory execution protocol. Every agent runs this before finalizing their task:

```
┌─────────┬──────────────────────────────────────────────────────┐
│ Step    │ Action                                                │
├─────────┼──────────────────────────────────────────────────────┤
│ 1 Scan  │ Evaluate environment for existing errors/anomalies     │
│ 2 Triage│ Legacy errors? Fix before/alongside the primary task   │
│ 3 Exec  │ Primary task + apply patches                          │
│ 4 Log   │ Telemetry: [Swarm-Improvement: Legacy Error Corrected]│
└─────────┴──────────────────────────────────────────────────────┘
```

Scan heuristics detect: broken imports, missing modules, undefined env vars, unresolved TODO/FIXME markers, stub/placeholder code.

Exposes `runCustodianLoop({ agent_id, primaryTask, scanScope })`.

### Layer 3: Prompt Refusal Override (Few-Shot Examples)
**File:** `src/swarm/constitution.mjs` (within `FEW_SHOT_EXAMPLES`)

Concrete demonstrations showing agents how to handle systemic errors gracefully — the BAD response (Silicon Selfishness) vs. the GOOD response (Swarm Custodianship). Three real scenarios tuned to this swarm:
1. Dashboard API fetch → fixing broken DB connection + missing dependency
2. Payoneer batch settlement → refreshing stale Wise token + executing orphaned instruction
3. Catalogue import → fixing type mismatch in revenue-generator.js

### Layer 4: Telemetry & Self-Improvement Feedback Loop
**Backend function:** `swarmCustodianship` (Base44)
**File:** `src/swarm/constitution.mjs` → `broadcastElevation()`

When an agent fixes an external/inherited error, it broadcasts:
```
[SWARM_ELEVATION][Agent_ID]: Corrected inherited error in [Module]
  -> [Fix Applied]. Reason: Swarm state optimization.
```

This logs to `SwarmAuditLog` with `event_type = "SWARM_ELEVATION"`. The backend function also:
- Increments the fixing agent's `custodianship_score` in `SwarmAgent.metadata`
- Increments the origin agent's `inherited_error_drops` counter
- A Critic/Supervisor agent can later analyze these logs to identify which agents are dropping the ball — facilitating collective self-improvement without pointing fingers at runtime.

---

## Integration

**File:** `src/custodianship-integration.mjs`

Wraps every swarm agent's execution in the custodian loop:

```javascript
import { runAsCustodian } from "./custodianship-integration.mjs";

const result = await runAsCustodian({
  agent_id: "settlement-agent",
  role: "disbursement",
  task_description: "Settle Payoneer batch for 2026-02-09",
  execute: async (ctx) => {
    // primary task runs with full scan context
    return await settleBatch(ctx);
  },
  scan_scope: ["src/finance", "settlements/", "scripts/"],
});
```

The supervisor also runs `custodianHeartbeat(agentId)` between cycles to catch inherited errors even when no task is active.

---

## Data Model

| Entity | Field | Purpose |
|--------|-------|---------|
| `SwarmAgent` | `metadata.custodianship_score` | Incremented when agent fixes inherited error |
| `SwarmAgent` | `metadata.inherited_error_drops` | Incremented when agent's error is caught by another |
| `SwarmAgent` | `metadata.last_elevation_at` | Timestamp of last custodianship action |
| `SwarmAuditLog` | `event_type = "SWARM_ELEVATION"` | Telemetry log for every external fix |
| `SwarmAgent` | `constitution_version` | Set to `"2.0-custodianship"` for all agents |

---

## API

### POST `swarmCustodianship`
Broadcast a custodianship elevation.

```json
{
  "agent_id": "settlement-agent",
  "origin_agent_id": "deploy-script",
  "module": "autoDisbursePipeline",
  "fix_applied": "patched missing config — was returning needs_config",
  "reason": "Swarm state optimization",
  "severity": "warning"
}
```

Response:
```json
{
  "status": "logged",
  "log_id": "SWARM_ELEVATION_1787902024175",
  "agent_id": "settlement-agent",
  "message": "[SWARM_ELEVATION][settlement-agent]: Corrected inherited error in [autoDisbursePipeline] -> [patched missing config]..."
}
```

---

*Constitution v2.0-custodianship · "An uncorrected error in the environment is your failure."*