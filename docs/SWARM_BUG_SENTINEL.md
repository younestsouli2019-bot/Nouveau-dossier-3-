# 🐛 Swarm Bug Sentinel — Autonomous Bug Detection & Fixing

## "Fix-it-if-you-see-it" — now wired for TypeScript compilation errors.

The Bug Sentinel is the execution arm of the Swarm Custodianship constitution for
code-level bugs. It autonomously scans, triages, and fixes TypeScript errors across
the swarm's codebase.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Swarm Bug Sentinel (scheduled every 6h)                │
│                                                          │
│  1. Agent runs `npx tsc --noEmit` or reads tsc-errors.txt │
│  2. Parses output → [{file, line, column, message}]      │
│  3. POST to swarmBugScanner backend function              │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ swarmBugScanner (backend)                          │  │
│  │                                                    │  │
│  │ - Categorizes each error (8 categories)            │  │
│  │ - Assigns priority (1-10) + fix strategy            │  │
│  │ - Flags auto-fixable vs manual                     │  │
│  │ - Logs to SwarmAuditLog (SWARM_BUG_SCAN)            │  │
│  │ - Returns prioritized fix plan                      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  4. Agent auto-fixes what it can                         │
│  5. Broadcasts each fix as SWARM_ELEVATION              │
│  6. Reports summary to owner                             │
└─────────────────────────────────────────────────────────┘
```

## Error Categories & Priority

| Category | Priority | Auto-Fixable | Fix Strategy |
|----------|----------|-------------|--------------|
| secret_handling | 10 | ❌ | Move to env var / sanitize |
| broken_import | 9 | ✅ | Fix path / install package / add @types |
| missing_declaration | 8 | ✅ | Add import / declare var / remove ref |
| undefined_reference | 8 | ✅ | Define var / add null check |
| missing_property | 7 | ❌ | Add to type/interface |
| prisma_deprecated | 7 | ✅ | Replace $use with $extends |
| async_missing | 6 | ✅ | Add async / remove await |
| type_coercion | 6 | ✅ | Add cast / fix source type |

## Backend Functions

### POST `swarmBugScanner`
Triage a list of TypeScript errors.

```json
{
  "agent_id": "bug-sentinel",
  "project": "AgentSwarm",
  "errors": [
    { "file": "src/app/page.tsx", "line": 112, "message": "Cannot find module './dashboard'" },
    { "file": "src/lib/truth-guards.ts", "line": 43, "message": "Prisma $use middleware param typing" }
  ]
}
```

Response:
```json
{
  "status": "triaged",
  "total_bugs": 2,
  "by_category": { "broken_import": 1, "prisma_deprecated": 1 },
  "fixable_now": 2,
  "fix_plan": [
    { "file": "src/app/page.tsx", "category": "broken_import", "priority": 9, "auto_fixable": true, "fix_instruction": "Fix import path..." },
    { "file": "src/lib/truth-guards.ts", "category": "prisma_deprecated", "priority": 7, "auto_fixable": true, "fix_instruction": "Replace $use with $extends..." }
  ]
}
```

## Scheduled Workflow

**Swarm Bug Sentinel** — `0 */6 * * *` (every 6h, Casablanca timezone)
- Agent runs tsc scan → triages → auto-fixes → reports to owner
- Combined with the Custodian Loop, this means no TypeScript error persists for >6h

## Integration with Custodianship

Every bug the Sentinel finds and fixes is broadcast as:
```
[SWARM_ELEVATION][bug-sentinel]: Corrected inherited error in [module] → [fix]. Reason: Swarm state optimization.
```

The Critic agent (daily at midnight) then analyzes which agents/modules keep producing errors, feeding back into collective self-improvement.

---

*Constitution v2.0-custodianship · "An uncorrected error in the environment is your failure."*