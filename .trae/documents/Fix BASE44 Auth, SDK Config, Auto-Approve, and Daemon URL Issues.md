## Findings Overview
- BASE44 auth/client setup resolves server URL and headers: [base44-client.mjs:L194-213](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L194-L213), env-based auth checks and offline support: [base44-client.mjs:L97-192](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L97-L192), [base44-client.mjs:L335-388](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L335-L388), [base44-client.mjs:L390-414](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L390-L414)
- Daemon config exposes offline mode and auto-approve flags: [autonomous-config.mjs:L103-L109](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L103-L109), [autonomous-config.mjs:L142-L158](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L142-L158), [autonomous-config.mjs:L236-L259](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L236-L259), [autonomous-config.mjs:L394-L400](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L394-L400)
- No calls to Users endpoints found.
- No LaunchDarkly references found.
- emit-revenue-events auto-approve logic present: [emit-revenue-events.mjs:L1596-L1616](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/emit-revenue-events.mjs#L1596-L1616), proof includes base44ServerUrl: [emit-revenue-events.mjs:L420-L434](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/emit-revenue-events.mjs#L420-L434)
- BASE44 API URL builds and direct fetches live in agent coordinator and scripts: [agent-coordinator.mjs:L90-L109](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/agent-coordinator.mjs#L90-L109), [push-to-base44.mjs:L36-L44](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/scripts/push-to-base44.mjs#L36-L44); daemon requires live envs: [autonomous-daemon.mjs:L193-L215](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-daemon.mjs#L193-L215)

## Objectives
- Fix BASE44 authentication using service token; provide offline fallback.
- Limit calls strictly to permitted entities; avoid Users endpoints entirely.
- Make SDK configuration manageable and explicit across environments.
- Ensure emit-revenue-events auto-approve behaves correctly and observably.
- Add checks/instrumentation for LaunchDarkly events if used.
- Normalize BASE44 API URL usage and improve daemon log correctness.

## Implementation Plan
### 1) Authentication Hardening
- Centralize client construction and header auth in one module backed by env validation: reinforce [base44-client.mjs](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs) builder paths and ensure X-Service-Token is always applied in live mode.
- Standardize URL resolution precedence: BASE44_API_URL → BASE44_SERVER_URL → default; normalize trailing slashes.
- Enforce offline mode via BASE44_OFFLINE/BASE44_OFFLINE_MODE, returning an offline client when true.

### 2) Avoid Users Endpoints
- Keep current behavior (none found) and add guardrails: a thin fetch wrapper rejects paths containing "/users" with an explicit error and telemetry.
- Add a lightweight runtime assertion in the coordinator module to block accidental Users calls.

### 3) SDK Configuration Management
- Consolidate env reads and precedence rules inside [autonomous-config.mjs](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs); map to a typed config object with safe defaults.
- Add config validation that warns on ambiguous or conflicting flags (e.g., live token present while offline=true).

### 4) emit-revenue-events Auto-Approve
- Verify the owner-only batch policy: ensure approved_at and approved_by are set exactly once; expand logging with structured context.
- Gate auto-approve by config flags (enabled/pendingAgeMinutes/maxBatchAmount) and add unit tests for each threshold.

### 5) LaunchDarkly Events
- Since no LD code exists, create optional instrumentation hooks (no-op by default) that can emit LD-style events when an LD client is supplied.
- Wrap hooks around approval decisions and daemon lifecycle points to aid future LD integration.

### 6) Daemon BASE44 API URL & Logging
- Unify URL resolution into a shared utility used by [agent-coordinator.mjs](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/agent-coordinator.mjs) and [push-to-base44.mjs](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/scripts/push-to-base44.mjs).
- Improve logs: always show the effective BASE44 URL, never include secrets; add correlation ids per operation.
- Normalize headers and include service token only in live mode; ensure offline avoids network calls.

### 7) Error Handling & Retries
- Add retry/backoff for transient 5xx/429 responses; do not retry 4xx.
- Classify errors and surface actionable diagnostics in logs.

### 8) Observability
- Introduce counters for approvals, auto-approve triggered/blocked, API errors, offline fallbacks.
- Ensure structured logs with consistent fields to inspect daemon behavior.

### 9) Task Tracking
- After approval to implement, create a visible task list and update status per deliverable. Use the workspace task list tool to track progress.

## Verification Strategy
- Unit tests for config resolution, URL normalization, offline/online client selection, and auto-approve policy.
- Integration tests with a mock BASE44 server to validate headers and permitted endpoints.
- Dry-run daemon mode in offline and live configurations; inspect logs for URL correctness and absence of secrets.

## Rollout
- Ship behind env flags; enable features incrementally.
- Canary in non-critical environment; monitor observability metrics and logs before full enablement.

## Code References
- [base44-client.mjs:L97-192](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L97-L192)
- [base44-client.mjs:L194-213](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L194-L213)
- [base44-client.mjs:L335-388](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L335-L388)
- [base44-client.mjs:L390-414](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/base44-client.mjs#L390-L414)
- [autonomous-config.mjs:L103-L109](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L103-L109)
- [autonomous-config.mjs:L142-L158](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L142-L158)
- [autonomous-config.mjs:L236-L259](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L236-L259)
- [autonomous-config.mjs:L394-L400](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-config.mjs#L394-L400)
- [emit-revenue-events.mjs:L420-L434](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/emit-revenue-events.mjs#L420-L434)
- [emit-revenue-events.mjs:L1596-L1616](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/emit-revenue-events.mjs#L1596-L1616)
- [agent-coordinator.mjs:L90-L109](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/agent-coordinator.mjs#L90-L109)
- [push-to-base44.mjs:L36-L44](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/scripts/push-to-base44.mjs#L36-L44)
- [autonomous-daemon.mjs:L193-L215](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/autonomous-daemon.mjs#L193-L215)