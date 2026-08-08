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
- `src/escalation/comms.mjs` — email draft dispatch (outbox), SWIFT gpi stub, SMS/WhatsApp stub, PDF dossier.
- `src/escalation/followup-scheduler.mjs` — T+24/T+48/T+72 business-hour scheduler.
- `src/escalation/templates.mjs` — escalation email, chaser emails, dossier sections.
- `src/escalation/audit.mjs` — HMAC-chained audit log (`data/escalation/audit.jsonl`).
- `scripts/run-escalation.mjs` — CLI: `--create`, `--advance`, `--respond`, `--status`, `--list`.
- `data/escalation/payload-mt103-tsouli.json` — default payload for the M. Tsouli case.

### CLI usage
```
node scripts/run-escalation.mjs --create [payload.json]
node scripts/run-escalation.mjs --advance <caseId>
node scripts/run-escalation.mjs --respond <caseId> <response.txt>
node scripts/run-escalation.mjs --status <caseId>
node scripts/run-escalation.mjs --list
```

Email dispatch runs in draft mode: `.eml` files are written to `data/escalation/outbox/` and require review
before manual sending (no SMTP/Gmail credentials are configured in this environment).
