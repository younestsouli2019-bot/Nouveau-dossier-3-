# Agentic AI Escalation Blueprint: Missing MT103 Wire Transfers

Autonomously resolve missing high-value cross-border wire transfers with strict validation gates,
multi-channel communication loops, and clear human-in-the-loop (HITL) thresholds.

## 1. System Architecture & Trigger Conditions

### Trigger Events
- **A-01:** System log detects a transaction aged > 5 business days with status `SENT_PENDING_BANK_CREDIT`.
- **A-02:** User submits a manual complaint payload (email/PDF text) via the client portal.

### Agent Roles
```
[Ingestion & Parsing Agent] ──> [Validation & Forensic Agent]
                                        │
                                        ▼ (If discrepancy found -> HITL Alert)
                                [Orchestration Agent]
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
        [External Banking Agent]                 [Client Comms Agent]
```

## 2. Phase-by-Phase Operational Protocol

### Phase 1: Ingestion and Forensic Validation
Parse the unstructured complaint data and cross-verify against core database tables.

- **Step 1.1 Payload Extraction:** Extract Beneficiary Name, Bank, RIB, Currency, Total Amount, Batch IDs.
- **Step 1.2 Database Cross-Matching:** Query internal logs for the value date to match API HTTP statuses;
  verify the settlement bridge pipeline configuration.
- **Step 1.3 Risk & Discrepancy Gate:**
  - If internal status shows `FAILED_REJECTED` or destination RIB contains a typo -> halt, route to Tier 3 Human Ops.
  - If internal status is verified `SUCCESS_OUTBOUND` -> proceed to Phase 2.

### Phase 2: Autonomous Escalation & Dispute Generation
- **Step 2.1 Document Assembly:** Generate a structured Letter of Escalation; compile raw API logs.
- **Step 2.2 Channel Routing:**
  - Primary: urgent message to bank compliance contacts.
  - Secondary: SWIFT gpi track-and-trace query using the original UETR strings (if integrated).

### Phase 3: Dynamic Tracking & Follow-up Loops
- Wait 24 business hours; if no response execute follow-up protocol.
- **T+24h:** Automated secondary follow-up (RAPPEL URGENT subject line).
- **T+48h:** Escalate routing to general corporate desk (`reclamation@attijariwafa.com`) + log CRM ticket.
- **T+72h (3 attempts):** Phone operations agent initiates direct voice contact.

### Phase 4: Resolution Processing or Human Handoff
- **Scenario A (bank provides MT103/SWIFT copy):** extract intermediary/routing/hold status, update dashboard,
  Client Comms Agent drafts explanatory note.
- **Scenario B (bank reports "No Record Found" or rejects):** trigger immediate HITL, assign Senior Treasury
  Operations Specialist with a unified summary dashboard.

## 3. Compliance Guardrails
- Regulatory hold codes (AML, KYC, Sanctions Match) -> Compliance Officer Agent takes over.
- Zero response after 3 automated attempts (72 business hours) -> Phone operations agent contacts Relationship Manager.

## 4. Implementation (this repo)

- `src/escalation/escalation-case.mjs` — case model + status state machine + persistence.
- `src/escalation/forensic-validator.mjs` — cross-matches payload vs `audits/` and `reports/reconciliation_report.csv`.
- `src/escalation/comms.mjs` — email dispatch (live SMTP or draft outbox), SWIFT gpi stub, SMS/WhatsApp stub, PDF dossier.
- `src/escalation/email-sender.mjs` — dependency-free SMTP client (STARTTLS + AUTH) for live autonomous email agents.
- `src/escalation/connectivity.mjs` — TCP probes + heartbeat state (`data/escalation/state/connectivity.json`), degraded-mode gate.
- `src/escalation/outbox-queue.mjs` — store-and-forward queue with exponential backoff (DTN behavior for outage windows).
- `src/escalation/followup-scheduler.mjs` — T+24/T+48/T+72 business-hour scheduler.
- `src/escalation/templates.mjs` — escalation email, chaser emails, dossier sections.
- `src/escalation/audit.mjs` — HMAC-chained audit log (`data/escalation/audit.jsonl`).
- `scripts/run-escalation.mjs` — CLI: `--create`, `--dispatch-live`, `--advance`, `--respond`, `--status`, `--list`.
- `scripts/escalation-daemon.mjs` — autonomous dispute-resolution daemon (live or degraded).
- `data/escalation/payload-mt103-tsouli.json` — default payload for the M. Tsouli case.

### CLI usage
```
node scripts/run-escalation.mjs --create [payload.json] [--live --override-reason X --decided-by owner]
node scripts/run-escalation.mjs --dispatch-live <caseId> [--override-reason X] [--decided-by owner]
node scripts/run-escalation.mjs --advance <caseId> [--live]
node scripts/run-escalation.mjs --respond <caseId> <response.txt>
node scripts/run-escalation.mjs --status <caseId>
node scripts/run-escalation.mjs --list
npm run escalation:daemon:live        # autonomous daemon, real SMTP when configured
npm run escalation:daemon:once        # single degraded-mode pass (no SMTP needed)
```

## 5. Live Email Agents & Outage Resilience

### Live dispatch
- `dispatchEmail(..., live: true)` writes the draft `.eml` to the outbox AND, when SMTP is configured
  (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`), sends it for real through `email-sender.mjs` (STARTTLS + AUTH LOGIN/PLAIN).
- Owner initiates live dispatch explicitly via `--dispatch-live <caseId>` (records `ownerOverride` in the case +
  audit chain) — a documented human gate, not something the agent self-approves.
- `npm run escalation:daemon:live` runs the autonomous loop: it probes connectivity, advances eligible cases
  through T+24/T+48/T+72 follow-ups, and flushes the outbox queue.

### Degraded mode (internet cut / SMTP down)
Maps the disconnected-swarm principles to this codebase:

| Principle | Implementation |
|---|---|
| Store-and-forward (DTN) | `outbox-queue.mjs` persists queued messages; retries with exponential backoff (60s, 2m, 4m, ... capped 4h) until a flush succeeds |
| Degraded-mode fail-safes | Local-only work continues offline: state-machine transitions, follow-up scheduling, PDF dossier, `.eml` drafting, audit HMAC chain. Only SMTP/SWIFT/SMS skip |
| Connectivity detection | `connectivity.mjs` TCP-probes SMTP host + DNS (1.1.1.1:443, 8.8.8.8:53), records online→offline→recovered transitions and `offlineSince` |
| Local consensus | Case JSON + HMAC-chained `audit.jsonl` is the single source of truth across restarts; daemon writes `state/daemon.json` heartbeat |
| Edge intelligence | Forensic validation, standards audit, and the website-improvement agent fall back to local heuristics when no LLM/SMTP endpoint is reachable |

- Daemon refuses `--live` when SMTP is unconfigured (`missingSmtpHint`), preventing silent draft-only "live" runs.
- When connectivity returns, `flushQueue()` sends queued messages and records `OUTBOX_FLUSH_SENT` / `OUTBOX_FLUSH_RETRY_SCHEDULED` audit events.
