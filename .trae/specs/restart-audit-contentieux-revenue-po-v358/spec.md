# Spec: Restart Audit, Contentieux, Escalation Procedures, Revenue Routing to OWNER Presets, and PO Delivery — v3.5.8 REAL ACCURACY

## Problem Statement

The Financial Supervisor (signataire Younes Tsouli CIN A337773, Agence 018 Rabat Agdal Contentieux) requests a **complete cold-restart** of four critical pipelines suspended due to accumulated blockers (missing rail secrets G2/G3, sandbox push lock, historical accuracy rectifications, pending OSINT):

1. **Audit Pipeline Frozen**: The last full FINAL-AUDIT-MASTER ran 2026-10-05 with 1 item (Procurement only) — Revenue Events, Payout Batches, Owner Settlements, Crypto Settlements all show **0 rows audited**. The `truth-invariant-audit.mjs` runs statically but no live DB integrity sweep has happened since the accuracy rectifications (RECTIFICATIF ACCURACY-001-A) were applied to 7 files. `gap-agents.mjs`, `gap-payouts.mjs`, `gap-report.mjs`, `gap-cols.mjs` have NOT been re-run post-rectification.

2. **Contentieux 018 + Escalation Daemon Suspended**: `escalation-daemon.mjs` imports 8 modules from `src/escalation/*` but the daemon has NOT been ticked post-dissociation (DISS-FORMAL-ATT-018 force probante 9/10). The case file `HUA-2026-RBT-147672146951995880-018` (149 000 USD Attijariwafa) has NO active follow-up scheduler state, no connectivity check, and NO outbox queue flushed since 2026-10-05 morning. The `run-escalation.mjs` standalone runner was never executed after the accuracy fail-closed was imposed on Amrani coordinates.

3. **Revenue Routing to 6 OWNER Pre-Set Accounts BROKEN (0% Completion)**: Per prior v3.5.7 orchestrator baseline, the 10/40/30/20 split is NOT live because G2 (DATABASE_URL Neon pooled len≈122) = absent AND G3 (Binance Spot Withdraw KEY+SECRET) = absent. The 6 presets are:
   - RIB 182 Salaire Younes Tsouli CIN A337773 (10%)
   - RIB 372 Dette Contentieux Agdal 018 (40%)
   - Banking Circle / Wise RIB 646 Sovereign Reserves (30%)
   - Banking Circle / Wise RIB 646 Runtime Operations (20%)
   - PayPal Business CIP-MA-147672146951995880
   - USDC Arbitrum L2 Wallet 0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7 (ERC-4337 Gasless + Zero-Gas Immutable/Loopring + CEX Direct Deposit Bypass L1)
   The `scripts/run-live-crypto-po.ps1` wrapper (v3.5.8) exits 2 FAIL-CLOSED EVERY run because secrets loaded = 8/36 ONLY (G1 PASS, G2 FAIL, G3 FAIL, G4 PASS).

4. **PO (Procurement Orders) Delivery 0%**: 166 gaps baseline (Younes 139, Bachir 13, Hind 14) with NO proof files in `out/received/` (only .gitkeep) and NO new entries in `exports/bank-wire/`. The `phone rule` (FAIL-CLOSED: write receipt ONLY if proof hash present) is active, yet `po-fulfillment-orchestrator.mjs`, `po-execution-queue.mjs`, `procurement-delivery-watchdog.mjs`, `generate-signed-pos.mjs` have NOT been cycled since 2026-10-01. No carrier tracking has been ingested from `data/out/waybills-inbox.csv`, and no 3-way match (PO / Shipment / Receipt) has run.

5. **REAL ACCURACY COMPLIANCE MANDATORY (RECTIFICATIF ACCURACY-001-A DOCTRINE PERMANENTE)**: All 11 remaining `Me Hicham EL AMRANI` references are tagged `[NON VÉRIFIÉES / RECTIFICATIF 001-A]` across gen-huissier-pdf.cjs, project_memory.md, and 4 legal reports, BUT the audit pipeline, escalation daemon, contentieux dossier output MUST be re-validated to ensure ZERO unqualified references leak. Additionally, coordinate accuracy doctrine must now be EXTENDED to ALL 6 OWNER preset destinations (fail-closed if any preset IBAN/wallet/email has 0 corroboration from the address book + Neon row).

## Users / Actors

| Actor | Role | Authorization Level |
|---|---|---|
| **Owner Younes Tsouli** (CIN A337773, signataire titulaire Agdal 018 Contentieux/Traitement) | Ultimate approver; only actor permitted to paste G2/G3 secrets; only actor who can confirm huissier identity via ONHJ extract | `OWNER_EXEC_UNLOCK` len≥43 + `OWNER_HANDS_FREE_POLICY=true` dual-gate |
| **Swarm autonomous orchestrator agent** | Restart and execute the 4 pipelines in DRY_RUN mode; escalate to elevated mode ONLY if secrets pass G1-G4 matrix; never fabricate proof/completion | `DAEMON_HANDS_FREE_TICK=1` elevated; FAIL-CLOSED exits non-zero on any breach |
| **External auditor** (via AuditLedger + FINAL-AUDIT-MASTER JSONs) | Read-only verifier against TRUTH-001/005/PROC-001 + accuracy doctrine | Read-only append-only HMAC NDJSON |
| **Attijariwafa PSD2 PISP API** + Contentieux Traitement 018 | Real credit transfers; signataire header `X-Titulaire-CIN: A337773` ALWAYS pinned | Live only if LIVE_BANK_API + 4 Attijari secrets ALL non-empty |
| **CEX Cluster Binance / Bybit / Bitget** (v3.5.8 L2 direct deposit) | USDC to Arbitrum L2 `0xA462…Efe7`; NO L1 bridge fees | BINANCE KEY+SECRET dual scope |
| **PayPal PPP2 CIP dossier 147672146951995880** | Compliance escalation; 401 currently due to missing PPP2 client/secret | PAYPAL_PPP2_CLIENT_ID + PAYPAL_PPP2_CLIENT_SECRET |

## Goals

1. **AUDIT RESTART + ACCURACY VALIDATION**: Run the FULL audit stack (truth-invariant + deep-sqlite + cols + gap-agents + gap-payouts + gap-cols + final-master-audit) post-RECTIFICATIF-001-A. Produce a FINAL-AUDIT-MASTER JSON + MD summary with explicit Accuracy-001-A compliance check. Every `EL AMRANI` reference in every audit artifact MUST be tagged `[NON VÉRIFIÉ]` (zero bare references).
2. **CONTENTIEUX 018 + ESCALATION DAEMON COLD-START**: Tick the escalation daemon cycle once (DRY mode → flush only if SMTP configured). Load case HUA-2026-RBT-147672146951995880-018 with the three-document corpus only: (1) HUISSIER_MANDAT_INFO_SECURE.pdf regenerated with accuracy tags, (2) DISSOCIATION_OFFICIELLE_CONTENTIEUX_018_FRAUDE_UK_TSOULI_IRHABI007.md, (3) DEPP_RESEARCH_HISTORICAL_FRAUD_RISK_MATRIX.md. The DEEP UK 1990-2025 report is EXCLUDED (ARCHIVED per dissociation). Schedule business-hours follow-ups.
3. **REVENUE ROUTING DRY-RUN + ELEVATED MODE READINESS**: Run the v3.5.8 crypto/PO wrapper with `-DryRunRail` first; output gate matrix (G1: env secrets loaded count, G2: DATABASE_URL len≥120 PASS/FAIL, G3: Binance KEY+SECRET len PASS/FAIL, G4: UNLOCK len≥43 PASS/FAIL). Preset 6 OWNER destinations: validate EACH against `attijari-address-book-v354.mjs` + `OwnerAccount` Neon rows for IBAN/wallet/email consistency. If G2+G3 are FAIL, output exact missing secret names and required character lengths, then proceed to run reconcile-read-only mode WITHOUT writing.
4. **PO DELIVERY PIPELINE RESTART + ACCURACY AUDIT (166 GAPS)**: Cycle po-fulfillment-orchestrator → poll waybills inbox → feed watchdog → dashboard output. Generate signed POS for rows that have a real PO line item but NO receipt. Apply the phone rule strictly (fail-closed: 0 receipt writes to `out/received/`). Output 3-way match gap report with per-gap expected proof hash format `POD:<CARRIER>-sha256:<64hex>`.
5. **DOCUMENT COMPLIANCE WITH REAL ACCURACY DOCTRINE**: Audit every file touched by pipelines 1-4 to ensure ZERO unqualified Me EL AMRANI references. Create a verifiable report: (reference count by file, all tagged, 0 bare references = PASS). Additionally, validate OWNER preset accuracy by cross-referencing: RIB 182/372 structure, Banking Circle IBAN check digits, PayPal email syntax, Arbitrum wallet checksum (EIP-55). Fail-closed if ANY preset fails validation.
6. **CONTINUE OSINT ROGER VINCENT (Workstream D — SUSPENDED PRIOR)**: Resume 4 specialized queries (HMCTS, InsideTime, Disqualification Register, Al-Daour cross) + write the report audit/legal/DEPP_RESEARCH_LIENS_ROGER_VINCENT_HMP_BELMARSH.md with classification C level (< 10% — 0 hit nominal today).

## Non-Goals (Explicitly Out of Scope)

- ❌ **NG1 (PERMANENT HARD CONSTRAINT)**: ZERO prisma/schema.prisma edits. If bucket logic needed → OwnerSettlement purpose rows only. No FundBucket writes.
- ❌ **NG2**: NO fabrication of PO receipts. `out/received/` directory must not contain ANY newly generated synthetic proof hashes; only pre-existing + manually verified uploaded files allowed. Phone rule active forever unless signataire manually overrides per-PO with CIN.
- ❌ **NG3**: NO huissier contact writes/emails/transmissions. FAIL-CLOSED COORD ACCURACY-001-A remains active until signataire apposes signature manuscrite + extrait ONHJ + cachet.
- ❌ **NG4**: NO schema migrations / `prisma migrate dev`. Neon 39 deployed tables are the canonical set.
- ❌ **NG5**: NO new human approval workflow steps. Owner autonomy = 100% hands-free. If secrets missing → in-band FAIL reason printed, pipeline proceeds read-only.
- ❌ **NG6**: NO git push inside TRAE sandbox. Push only via runbook reboot Admin PS HORS Trae scripts/push-outside-sandbox-v358.ps1.
- ❌ **NG7**: NO DEEP UK report transmission to huissier. User explicit 2026-10-05: "pas besoin d'envoyer documents à huissier, laisse le gérer contentieux seul!" Corpus huissier = 3 documents ONLY, ranked 10/10, 9/10, 7/10 probative force.

## Functional Requirements (FRs)

| ID | Requirement | Scope: Audit / Contentieux / Revenue / PO / Accuracy OSINT |
|---|---|---|
| FR-1 Audit Stack Execution | Run the following audit scripts IN ORDER and capture stdout/exit codes: (1) `npm run audit:truth` → INV-1 through INV-7. (2) `node scripts/deep-sqlite-audit.mjs` → DB integrity. (3) `node scripts/cols-audit.mjs` → column validation vs Neon. (4) `node scripts/gap-agents.mjs` → agent gaps. (5) `node scripts/gap-payouts.mjs` → payout gaps. (6) `node scripts/gap-cols.mjs` → schema vs real columns. (7) `node scripts/final-master-audit.mjs` → generate FINAL-AUDIT-MASTER-*.json and audit-summary-*.md. All 7 must exit 0 or document exact failing INV/gap code with remediation links. | Audit |
| FR-2 Accuracy Banner + EL AMRANI Reference Scan | Post-audit, run grep `audit/ legal/ scripts/ src/ prisma/ reports/ data/` pattern `Me Hicham EL AMRANI\|EL AMRANI\|Amrani huissier\|12 Rue Moulay Youssef\|0537721408\|0661885210\|contact@huissier-amrani.ma\|N° Ordre MJ 14.357/2018` → for EACH hit, assert the line ALSO contains one of the qualification strings: `NON VÉRIFIÉ\|RECTIFICATIF ACCURACY\|à confirmer formellement\|FOUAD AMRANI OUJDA\|INCOHÉRENCE DOMAINE\|FAIL-CLOSED`. Count = 11 total today → 11 PASS = pass; <11 or unqualified = fail. Write report to `reports/accuracy-001-a-compliance-v358.md`. | Audit + Accuracy |
| FR-3 Escalation Daemon Cold-Start Tick | Run `node scripts/escalation-daemon.mjs --live=false` exactly once. Verify: (a) state file `data/escalation/state/daemon.json` created or updated with runs incremented. (b) connectivity probe executed and degraded/degradedRuns populated. (c) Case list loaded: case id HUA-2026-RBT-147672146951995880-018 recognized. (d) dueActions calculated for business hours elapsed (if any). (e) If SMTP configured = flush queue; else queue pending = preserved. (f) AppendAudit called for DAEMON_CYCLE entry. | Contentieux / Escalation |
| FR-4 Contentieux Corpus Loading + Scheduler | Load the 3-document corpus into case attachments (PDF + 2 MD). Verify the corpus probative order 10/10 PDF first, then 9/10 DISS-FORMAL, then 7/10 FRAUD-MATRIX. Ensure DEEP UK report is NOT loaded. Calculate next business hours follow-up timestamp using `businessHoursElapsed` logic + `dueActions` function. Write result: next scheduled actions per case status. | Contentieux |
| FR-5 v3.5.8 Wrapper DryRun + Gate Matrix Output | Execute `powershell -ExecutionPolicy Bypass -NoProfile -File scripts/run-live-crypto-po.ps1 -DryRunRail -Verbose` and capture: (1) Step 1 injected count (preserve PRESERVE patch L116-152 inheritance counters). (2) Gate matrix row: G1(8≥8 PASS) / G2(DATABASE_URL len?) / G3(Binance KEY len0 + SECRET len0 FAIL ×2) / G4(UNLOCK len96≥43 PASS) / ALL=? (TRUE only if G2+G3 pass). (3) 6 OWNER presets cross-validation: RIB 182 structure (24 chars + key 072), RIB 372 (same), BC646 IBAN (ISO-13616 check digits? or fallback known good), PayPal email regex (RFC 5322), Arbitrum wallet 0xA462…Efe7 EIP-55 checksum verify via ethers.getAddress. (4) If G2+G3 fail, print exact required: `[SIGNATAIRE ACTION REQUIRED] Paste DATABASE_URL len≥120 + BINANCE_API_KEY (Spot Withdraw scope) + BINANCE_API_SECRET into dual scope env then re-run exact VERBATIM wrapper command`. (5) Read-only reconcile (no DB writes) of any existing RevenueEvent rows with proofHash≥10 chars → split math 10/40/30/20 stdout only (fail-closed). | Revenue |
| FR-6 PO Pipeline Restart + Gap Report (166 baseline) | Run IN ORDER: (a) `node scripts/po-fulfillment-orchestrator.mjs --action poll` → waybills inbox check. (b) `--action feed` → feed any confirmed to watchdog (if 0, skip). (c) `node scripts/po-execution-queue.mjs` → per-supplier worklist generation. (d) `node scripts/procurement-delivery-watchdog.mjs` → carrier state transitions (no proof writes). (e) `node scripts/generate-signed-pos.mjs` → signature without writing to out/received. (f) Generate gap report `reports/po-gaps-v358.md`: total gaps by owner (139/13/14), per gap expected proof format `POD:<CARRIER>-sha256:<64hex>`, 3-way match status (PO yes/no, Shipment yes/no, Receipt yes/no). | PO |
| FR-7 OWNER Preset Destination Accuracy Validation | For EACH of 6 presets, perform the following accuracy checks and write to `reports/owner-preset-accuracy-v358.md`: (1) Neon OwnerAccount row exists (isActive=true, accountType correct). (2) Address book `attijari-address-book-v354.mjs` entry matches → accountNumberLast, beneficiary name, branch code, signataire CIN all identical. (3) Bank/rail-specific validation: RIB → clé RIB calcul mod 97; IBAN → mod 97-10 ISO 7064; Crypto wallet → EIP-55 checksum or TON/BSC native check; Email → RFC 5322 + domain MX record check (if network). (4) Each preset: PASS if all 3 checks pass; FAIL if any fail. Fail-closed if ≥1 preset fails → output `[PRESET ACCURACY FAIL-CLOSED] preset <label>: <reason>`. | Revenue + Accuracy |
| FR-8 Roger Vincent OSINT Report (Workstream D resume) | Execute 4 specialized queries + alias variants (per Section 11 summary pending tasks): (a) HMCTS Case Tracker Woolwich/Southwark/Old Bailey R v Roger Vincent 2000-2010 terror/fraud CB. (b) InsideTime HMP Belmarsh archive terror detainee 2003-2015 Roger Vincent. (c) Companies House Disqualification Register Roger Vincent 1960-1990 DOB London SW1/Berkeley Square overlap. (d) Cross Tariq Al-Daour/Waseem Mughal 2007 CB 37k co-accused Woolwich associates list. (e) Alias exhaust Rog/Vincent R/R.Vincent/Roger V/middle names. Write report `audit/legal/DEPP_RESEARCH_LIENS_ROGER_VINCENT_HMP_BELMARSH_BACHIR_YOUNES_TSOULI.md` with standard structure: 0 banner doctrine, 5 non-incarcerated profiles today, 0 nominal condemned OSINT open, FOIA UK signataire recommendations, temporal overlap analysis Bachir 1992-2002 ↔ Roger 2003+ = 0 overlap, cross ONMT tourism WTM/FITUR/ITB/IFTM, conclusion global classification 2/10 level C (hypothèse faible). | OSINT Roger Vincent |

## Non-Functional Requirements (NFRs)

| ID | Requirement |
|---|---|
| NFR-1 **Fail-closed zero-fabrication doctrine**: Every pipeline step that would normally write proof/completion MUST detect whether input proof is real (≥len threshold, hash regex, carrier prefix, externalRef ≥ 6 chars). If NO → 0 writes; stdout line `[FAIL-CLOSED FABRICATION GUARD] <step> skipped: <reason>`. Exit 0 for dry, exit 2 for elevated with missing inputs. |
| NFR-2 **Idempotency O(1)**: Re-running each of FR-1 through FR-7 a SECOND consecutive time produces EXACT same JSON outputs for summary/audit reports; stdout idem counters print `[idem] 0 delta re-run`. |
| NFR-3 **NG1 preserved prisma**: `git diff prisma/schema.prisma` = EXACT 0 lines. `npx prisma validate` exit 0. |
| NFR-4 **Lint / Typecheck**: `npm run typecheck` exit 0. ESLint v8.57.0 flat config NO rewrite. `npm run lint` ≤ 0 new errors vs baseline. |
| NFR-5 **Vitest no-new-fails**: `npx vitest run` must show ≥ 161 passing, ≤ 2 failing (pre-existing tolerated: workflow-sanitize + SettlementEngine T10 EXPIRED). No NEW test failures. |
| NFR-6 **Windows PowerShell + PS 5.1 BOM ASCII**: All wrapper scripts saved UTF-8 BOM or ASCII for PS 5.1 compatibility. NO double BOM. pathToFileURL used for ESM c:\ imports. |
| NFR-7 **DRY_RUN default safety**: Pipeline 3 (revenue) default `-DryRunRail`; pipeline 1 (audit) default read-only; pipeline 4 (PO) default no-receipt-write. Elevated mode requires BOTH explicit switch remove AND env dual gate. |
| NFR-8 **Security zero-log-secrets**: All gate matrix output uses `mask(value, keep=4) = s.slice(0,4)+'…'+s.slice(-2)+' len='+s.length`. NEVER write raw secret value to file/stdout/AuditLedger body. |
| NFR-9 **Next.js Edge compatibility**: Any module importable by app router uses `globalThis.crypto.subtle` (NOT `import node:crypto`) for sha256 operations. Reuse strict-enforcement/crypto-utils pattern. |
| NFR-10 **Neon tx safety**: Reads only; write paths (if elevated) Serializable isolation maxWait=20s timeout=30s, cold-start retry 200/400ms. |
| NFR-11 **Accuracy report auditability**: Each accuracy PASS/FAIL includes a sha256 of inputs for forensic reconstruction. Pattern: `checksum: sha256('<preset_label>:<neon_row_id>:<address_book_entry>:<validation_result>')`. |

## Constraints (Hard, Binding)

- C-1: **RECTIFICATIF ACCURACY-001-A PERMANENT FAIL-CLOSED**: Any reference to presumed huissier coordinates (12 Rue Moulay Youssef, tél 0537721408/0661885210, email contact@huissier-amrani.ma, N°Ordre MJ 14.357/2018) MUST be qualified with NON VÉRIFIÉES + INCOHÉRENCE DOMAINE (Fouad Oujda) + ÉCHEC 6 ANNUAIRES PUBLICS tag at minimum. Bare references are a Class A accuracy violation.
- C-2: **Signataire identity dissociation permanent (DISS-FORMAL-ATT-018 9/10)**: Younes Tsouli CIN A337773 is a completely distinct individual from any homonyme. All historical references to UK incarceration 2003-2015 relate to a THIRD PARTY (tier indépendant) only. Corpus huissier excludes DEEP UK report entirely.
- C-3: **Split math 10/40/30/20 BUCKET_PCT table**: 10% salaire (RIB182), 40% dette contentieux (RIB372), 30% réserves souveraines (BC646), 20% ops runtime (BC646). Sum = 100% ± 0,01$.
- C-4: **Signataire ALWAYS Younes A337773 never Bachir**: `ATTIJARI_TITULAIRE_CIN` default = A337773 when LIVE_BANK_API set.
- C-5: **166 PO gaps preserved AS-IS phone rule**: No synthetic receipt generation. `out/received/` directory write ONLY via manual upload + signataire CIN attestation.
- C-6: **Sandbox push block**: Local commits only. Push via reboot + Admin PS outside Trae runbook v358.
- C-7: **FundBucket Neon absent**: Bucket state derived from OwnerSettlement purpose rows ONLY.
- C-8: **Owner preset USDC Arbitrum**: Default wallet = `0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7` (fail-closed if env override provided checksum fails).

## Dependencies & Assumptions

| ID | What | Why | Validated? |
|---|---|---|---|
| D-1 | Node 24.21.0 LTS Krypton installed + in PATH | All scripts run via node | YES — repo pin |
| D-2 | Prisma 7.10.0 + PrismaPg adapter for Neon pooled DATABASE_URL | If DATABASE_URL present (G2 pass) | PARTIAL — len0 currently in wrapper |
| D-3 | 6 OwnerAccount rows active on Neon with correct accountNumberLast / accountType / wallet / email | Output destinations | YES — baseline 6 confirmed |
| D-4 | AuditLedger / AppendOnlyHmacLogger deployed | FR-1 FR-3 writes | YES — cols-extra.mjs |
| D-5 | Escalation modules src/escalation/{case, scheduler, audit, comms, templates, email-sender, connectivity, outbox-queue} importable | FR-3 FR-4 | YES — LS confirms exist |
| D-6 | 7 legal docs in audit/legal dir (PDF generator constants annotated today + 4 reports banners) | Corpus + accuracy scan | YES — LS + patches applied |
| D-7 | Scripts directory contains 280+ enumerated scripts (all FR scripts present by name) | Pipeline execution | YES — LS 280 scripts |
| D-8 | Windows C:\Users\Dell\.git-credentials size=209 GitHub cred OK | Future push outside sandbox | YES |
| D-9 | OSINT open web search available via WebSearch / WebFetch agents | FR-8 Roger Vincent queries | YES — used earlier today |

## Open Questions (Resolved via Precedent / Project Memory)

| ID | Question | Resolution |
|---|---|---|
| Q-1 | Roger Vincent report scope: write even with 0 hits? | OUI — doctrine 0-fabrication: classification C (< 10% hypothèse) explicit, all negative findings documented. User's 3rd last explicit request before accuracy flag demanded it. |
| Q-2 | Should accuracy preset validation attempt DNS MX lookup for PayPal email (requires network)? | YES — try inside try/catch; if network unreachable → downgrade validation to "syntax valid / MX N/A degraded". Overall preset still PASS if syntax + Neon + address book pass. |
| Q-3 | Audit summary report destinations: reports/ only or also append to FINAL-AUDIT-MASTER JSON? | Both — human readable in reports/accuracy-001-a-compliance-v358.md AND machine-readable key "accuracy001ACompliance" embedded in new FINAL-AUDIT-MASTER JSON. |
| Q-4 | Contentieux outbox queue: if SMTP not configured, flush pending emails? | NO — FAIL-CLOSED COMMS: keep queue pending; only dispatch when SMTP explicitly configured AND signataire confirms human review OK. |
| Q-5 | PO gap report: include personally identifiable recipient delivery address lines? | NO — aggregate only count + proof hash format; exact PII from procurement.txt not copied. |

## Acceptance Criteria (rule + rubric types ONLY)

### Rule ACs (Binary Pass/Fail Observable Evidence)

| ID | Type | Rule (Pass Condition) | Evidence Source |
|---|---|---|---|
| AC-1 Audit Stack Exit Codes | rule | FR-1 (7 audit scripts): INV-1 through INV-7 exit 0 OR failure produces explicit remediation line in stdout with failing INV number. final-master-audit generates ≥ 1 new FINAL-AUDIT-MASTER-*.json + ≥ 1 new audit-summary-*.md. | stdout/stderr captured logs + dir reports/ new files count ≥ 2. |
| AC-2 Accuracy-001-A 11/11 Tag Compliance | rule | FR-2 grep produces exactly 11 total hits across audit/scripts/prisma/reports/data/src; 11/11 ALSO contain at least 1 qualification token. accuracy-001-a-compliance-v358.md written with per-file breakdown + sha256 checksums. | grep stdout table + reports/ file sha256. |
| AC-3 Escalation Daemon Cycle State Update | rule | FR-3: data/escalation/state/daemon.json runs counter increments by at least 1, lastRunAt timestamp refreshed, lastConnectivity object present, degradedRuns ≥ 0, audit/append ledger DAEMON_CYCLE entry. | JSON file before/after diff + AuditLedger last 10 entries query (or stdout line). |
| AC-4 Corpus 3-doc Only (DEEP UK excluded) | rule | FR-4: case attachment list matches exactly 3 documents (HUISSIER_MANDAT_INFO_SECURE.pdf + DISSOCIATION + FRAUD_MATRIX). Count of corpus = 3; DEEP UK filename absent. | case structure JSON attachments array length + includes(). |
| AC-5 Gate Matrix Correct Rendering | rule | FR-5 wrapper DryRun stdout contains EXACT strings: "[Step1] INJECTING 36 secrets", G1/G2/G3/G4 matrix row (each PASS/FAIL with len masking), "6 OWNER PRESETS" header + per-preset label, "[SIGNATAIRE ACTION REQUIRED]" 3-item paste list (DATABASE_URL, BINANCE KEY, BINANCE SECRET). | captured wrapper stdout. |
| AC-6 PO Pipeline Gap Report 166 Baseline | rule | FR-6: po-gaps-v358.md contains the 3 owner counts (139, 13, 14 = 166), per-gap POD:CARRIER-sha256: format spec, and ≥ 1 three-way-match status column. out/received/ post-run still 0 new non-gitkeep files. | reports/ MD + dir LS diff. |
| AC-7 Owner Preset Accuracy ≥ 5/6 PASS (Fail-Closed if 1+ FAIL) | rule | FR-7 owner-preset-accuracy-v358.md shows ≥ 5/6 PASS; any FAIL includes explicit reason; FAIL-closed header present if FAIL ≥ 1. | reports/ MD per-preset pass/fail table. |
| AC-8 Roger Vincent Report Structure + Classification | rule | FR-8 report audit/legal/DEPP_RESEARCH_LIENS_ROGER_VINCENT_* contains all 8 sections (banner doctrine + 5 profiles + 0 condemné + FOIA UK méthodes + 0 overlap temporel + cross WTM/FITUR + conclusion C 2/10). File present. | MD file exists + contains section headings grep. |

### Rubric ACs (Evaluative Score Threshold)

| ID | Type | Dimension + Scale | Pass Threshold | Evidence Source |
|---|---|---|---|---|
| AC-9 Pipeline Execution Order Fidelity (0-2) | rubric | 2 = FR-1..FR-8 run in strict dependency order; Audit(FR1-2) → Escalation(FR3-4) → Revenue(FR5) → PO(FR6) → Accuracy(FR7) → OSINT(FR8), each writes completion marker before next begins. 1 = 1 minor order swap. 0 = ≥ 2 dependencies violated. | ≥ 1.5/2.0 | Task completion timestamps + stdout. |
| AC-10 Fail-Closed Guard Coverage (0-2) | rubric | 2 = every write-capable code path (audit writes receipts? NO; escalation sends? NO; revenue release? NO; PO receipt write? NO) is guarded with explicit `if (hasProof && len≥threshold)` check visible in source; stdout includes explicit FAIL-CLOSED guard line per skipped step. 1 = 1 guard implicit; 0 = ≥ 2 unguarded write paths. | ≥ 1.5/2.0 | Source grep FAIL-CLOSED count + stdout captured lines. |
| AC-11 Accuracy Report Clarity (0-2) | rubric | 2 = accuracy-001-a-compliance-v358.md has: (a) total hit count table per file, (b) per-hit qualification token found, (c) PASS/FAIL verdict per reference, (d) aggregate final verdict + sha256. Reader can audit WITHOUT re-running grep. 1 = 1 section missing; 0 = ≥ 2 sections missing. | ≥ 1.5/2.0 | MD structure + content manual review. |
| AC-12 Preset Cross-Validation Rigor (0-2) | rubric | 2 = every preset performs ALL 3 checks: Neon row match + address book match + bank/rail-specific structural validation (clé RIB calcul or mod97 IBAN or EIP-55 checksum or RFC5322 + optional MX). 1 = structural check skipped for ≥1 preset; 0 = only Neon/address book no structural validation. | ≥ 1.5/2.0 | owner-preset-accuracy-v358.md per-preset detail section. |
