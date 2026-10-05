# Tasks — Restart Audit, Contentieux Escalation, Revenue Routing to 6 OWNER Presets, PO Delivery Pipeline — v3.5.8 REAL ACCURACY

Spec: [spec.md](./spec.md) (AC-1..AC-12, 8 rules + 4 rubrics)

---

## Task 1: Run Full Audit Stack (7 scripts) + Capture Exit Codes + Generate FINAL-AUDIT-MASTER

- **Status**: `pending`
- **Priority**: high
- **Depends On**: (none — foundational pipeline restart)
- **Scope**: Execute the 7-step audit pipeline IN STRICT ORDER per FR-1. Capture each step's stdout/stderr + exit code. Generate new FINAL-AUDIT-MASTER JSON + audit-summary MD post-run. Steps:
  1. `npm run audit:truth` → INV-1 through INV-7. Exit code 0 = pass. If any INV fails, capture violating file + line.
  2. `node scripts/deep-sqlite-audit.mjs` → DB integrity scan (offline JSON if Neon G2 fail).
  3. `node scripts/cols-audit.mjs` → column validation vs Neon deployed set (skip DB ping if DATABASE_URL missing; produce read-only expected-set report).
  4. `node scripts/gap-agents.mjs` → agent gap analysis.
  5. `node scripts/gap-payouts.mjs` → payout gap analysis (OwnerAccount held/spendable/totalReceived vs PayoutBatch/PayoutItem completed totals delta).
  6. `node scripts/gap-cols.mjs` → Prisma schema columns vs Neon deployed (NO FundBucket writes enforced).
  7. `node scripts/final-master-audit.mjs` → aggregate everything into `reports/FINAL-AUDIT-MASTER-<timestamp>.json` + generate `reports/audit-summary-<timestamp>.md`.
  Post step 7: inject `accuracy001ACompliance` placeholder key into JSON (will be filled in Task 2).
- **Test Requirements (TRs)**:
  - **TR-1.1 (rule, covers AC-1)**: Each step stdout contains explicit `[STEP <n>/7] <scriptname>: exit=<code>` line. 7 exit codes captured. ≥ 5/7 exit 0 = overall pipeline PASS (2 tolerated offline DB only if G2 fail).
  - **TR-1.2 (rule, covers AC-1)**: Post-step 7, dir `reports/` contains ≥ 1 new FINAL-AUDIT-MASTER-*.json (file size ≥ 5 KB) AND ≥ 1 new audit-summary-*.md (≥ 30 lines). Both files present.
  - **TR-1.3 (rubric, covers AC-9 Pipeline Order)**: 0-2 scale. 2 = steps executed in EXACT order 1→2→3→4→5→6→7, stdout timestamp ascending. 1 = 1 minor reorder. 0 = ≥2 order swaps. Pass ≥ 1.5.
- **Completion Evidence**: Captured stdout/stderr 7-step log; new reports JSON + MD paths; TR-1.1/TR-1.2/TR-1.3 results.

---

## Task 2: Accuracy-001-A Full Reference Scan (11/11 Target Tags) + Compliance Report

- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (can overlap by 50% — audit-001 scan is independent)
- **Scope**: Perform the grep sweep per FR-2 across 7 directories: audit/ legal/ scripts/ src/ prisma/ reports/ data/. Search patterns:
  - Pattern set P = `Me Hicham EL AMRANI`, `EL AMRANI`, `Amrani huissier`, `12 Rue Moulay Youssef`, `0537721408`, `0661885210`, `contact@huissier-amrani.ma`, `N° Ordre MJ 14.357/2018`.
  - Qualification token set Q = `NON VÉRIFIÉ`, `RECTIFICATIF ACCURACY`, `à confirmer formellement`, `FOUAD AMRANI OUJDA`, `INCOHÉRENCE DOMAINE`, `FAIL-CLOSED`.
  Per hit: if the line contains ≥ 1 token from Q → PASS this hit; else → FAIL this hit. Aggregate: TOTAL_HITS = Σ count per file; QUALIFIED_HITS = Σ passed; FINAL_VERDICT = (TOTAL_HITS === 11 AND QUALIFIED_HITS === 11). Write `reports/accuracy-001-a-compliance-v358.md` with:
  - Section 1: Summary table (file, hits, qualified, verdict per file).
  - Section 2: Per-hit detail (30-char line snippet + tokens found list + per-hit PASS/FAIL + sha256 of line).
  - Section 3: Final verdict with overall checksum sha256(`<total>:<qualified>:<YYYYMMDDHHmm>`).
  - Section 4: Remediation actions if any fails.
  Inject final verdict boolean + counts into Task 1's FINAL-AUDIT-MASTER JSON (key `accuracy001ACompliance`).
- **Test Requirements (TRs)**:
  - **TR-2.1 (rule, covers AC-2)**: TOTAL_HITS === 11 AND QUALIFIED_HITS === 11. If any hits are unqualified → produce remediation lines in Section 4.
  - **TR-2.2 (rule)**: `reports/accuracy-001-a-compliance-v358.md` exists, has all 4 sections, Section 3 checksum line present AND length = 64 hex chars.
  - **TR-2.3 (rubric, covers AC-11 Accuracy Report Clarity)**: 0-2 scale. 2 = reader can re-verify without running grep (file paths, line snippets, tokens per-hit ALL listed). 1 = 1 section missing detail. 0 = ≥ 2 vague sections. Pass ≥ 1.5.
- **Completion Evidence**: Grep raw output file; reports/accuracy-001-a-compliance-v358.md; updated FINAL-AUDIT-MASTER JSON accuracy key; TR-2.1/TR-2.2/TR-2.3 results.

---

## Task 3: Escalation Daemon Cold-Start Tick (dry-run, no live sends) + Case State Initialization

- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1, Task 2 accuracy compliance (corpus documents must be accuracy-tagged BEFORE loading)
- **Scope**: Execute FR-3 and FR-4:
  - FR-3: Run `node scripts/escalation-daemon.mjs --live=false` exactly once. Before run: backup `data/escalation/state/daemon.json` if exists (→ `daemon.pre-v358.json.bak`). After run: diff fields (runs++, lastRunAt refreshed, lastConnectivity object non-empty, degradedRuns ≥ 0). Verify AppendAudit DAEMON_CYCLE entry exists via stdout or the audit module output.
  - FR-4: Load case id `HUA-2026-RBT-147672146951995880-018` with the 3-document corpus ONLY. Attachment list must match exactly:
    1. `audit/legal/HUISSIER_MANDAT_INFO_SECURE.pdf` (probative rank 10/10)
    2. `audit/legal/DISSOCIATION_OFFICIELLE_CONTENTIEUX_018_FRAUDE_UK_TSOULI_IRHABI007.md` (rank 9/10)
    3. `audit/legal/DEPP_RESEARCH_HISTORICAL_FRAUD_RISK_MATRIX.md` (rank 7/10)
    The DEEP UK file `DEPP_RESEARCH_DEEP_UK_MAROC_HISTORICAL_1990_2025.md` is excluded (ARCHIVED). Verify corpus count = 3 via listCaseAttachments() or equivalent. Compute next business-hours due actions via `businessHoursElapsed()` + `dueActions()` calls. Persist case to disk per `saveCase()`. Flush outbox queue ONLY if `isSmtpConfigured() === true`; else write queue pending line: `[FAIL-CLOSED COMMS] SMTP not configured; outbox pending=<queueReport().pending> emails preserved`.
- **Test Requirements (TRs)**:
  - **TR-3.1 (rule, covers AC-3)**: Post-run daemon.json diff shows runs incremented by ≥ 1; lastRunAt > preRun timestamp; lastConnectivity.status field exists; degradedRuns integer ≥ 0.
  - **TR-3.2 (rule, covers AC-4)**: Case attachment list length = 3. Attachment filenames array contains all 3 expected documents (pdf + 2 md) AND does NOT contain `DEEP_UK` or `1990_2025` substring.
  - **TR-3.3 (rule)**: dueActions() returns array (may be empty if no elapsed hours); result structure has fields { step, reason, dueAtISO }.
  - **TR-3.4 (rubric, covers AC-10 Fail-Closed Guards)**: 0-2 scale. 2 = SMTP not configured case writes explicit FAIL-CLOSED COMMS line AND zero emails dispatched (queue.pending unchanged pre vs post). 1 = 1 guard missing. 0 = ≥ 2 missing guards. Pass ≥ 1.5.
- **Completion Evidence**: daemon.json backup + diff; case file saved with corpus; dueActions output JSON; outbox queue preserved stdout line; TR-3.1..TR-3.4 results.

---

## Task 4: v3.5.8 Live Crypto/PO Wrapper DryRun + 6 OWNER Presets Accuracy Cross-Validation (FR-5, FR-7)

- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 baseline; can overlap with Task 2/3 80%
- **Scope**:
  - **FR-5 Wrapper DryRun**: Execute `powershell -ExecutionPolicy Bypass -NoProfile -File scripts/run-live-crypto-po.ps1 -DryRunRail -Verbose`. Capture stdout. Verify PRESERVE patch (lines ~116-152) correctly inherits existing env vars. Parse the 4-gate matrix:
    - G1: secrets loaded X/36 ≥ 8 → PASS expected (the 8 auto injected by wrapper per user profile approved 10 keys).
    - G2: DATABASE_URL len. Expected len=0 → FAIL (signataire action required).
    - G3: BINANCE_API_KEY len=0 + BINANCE_API_SECRET len=0 → FAIL ×2.
    - G4: OWNER_EXEC_UNLOCK len≥43 → PASS expected (96 chars).
    - ALL = G1∧G2∧G3∧G4 → FALSE (fail-closed) → `Exit 2` wrapper code.
    Print the 3-item SIGNATAIRE ACTION REQUIRED list (DATABASE_URL len≥120, BINANCE Spot Withdraw KEY, BINANCE Spot Withdraw SECRET).
  - **FR-5 Read-only Reconcile (no DB writes)**: If G2 fail, output read-only split calculation for any existing completed RevenueEvent (≥10 chars proofHash) → 10/40/30/20 split, stdout table only (no DB ops).
  - **FR-7 OWNER Preset 3-way Accuracy Check**: For EACH preset (RIB182 / RIB372 / BC646 / PayPal / Payoneer / USDC Arbitrum):
    1. Neon row match (if G2 fails, use fallback: attijari-address-book-v354.mjs in-memory object + PRIOR AuditLedger reads) → label, accountType, accountNumberLast match.
    2. Address book match: compare vs scripts/attijari-address-book-v354.mjs entry (beneficiary, branch, signataire CIN).
    3. Rail-specific structural validation: (a) RIB = compute clé RIB mod 97. (b) IBAN = mod 97-10 ISO 7064. (c) Email: RFC 5322 regex + optional MX lookup (try/catch; network fail → degraded but pass). (d) Wallet: ethers.getAddress checksum validates. Write `reports/owner-preset-accuracy-v358.md` with per-preset 3-check table + overall. If ≥1 preset FAIL → add header `[PRESET ACCURACY FAIL-CLOSED]` with reason.
- **Test Requirements (TRs)**:
  - **TR-4.1 (rule, covers AC-5)**: Wrapper stdout contains lines: "[Step1] INJECTING 36 secrets", gate matrix 4 rows (G1/G2/G3/G4) each PASS/FAIL label + len mask, "6 OWNER PRESETS" header with 6 preset labels, "[SIGNATAIRE ACTION REQUIRED]" line with DATABASE_URL + 2 Binance keys names.
  - **TR-4.2 (rule)**: Wrapper exit code = 2 (as designed, G2+G3 fail → ALL=FALSE). Exit code captured from PS.
  - **TR-4.3 (rule, covers AC-7)**: reports/owner-preset-accuracy-v358.md shows each of 6 presets with 3 checks. Overall ≥ 5/6 PASS. Any FAIL includes explicit reason line. If ≥ 1 FAIL → FAIL-CLOSED header present.
  - **TR-4.4 (rubric, covers AC-12 Preset Rigor)**: 0-2 scale. 2 = every preset performs structural validation (clé RIB / mod 97 / RFC 5322 / EIP-55) not just syntactic string-non-empty check. 1 = ≥1 preset skips structural. 0 = ≥2 presets skip. Pass ≥ 1.5.
- **Completion Evidence**: Wrapper captured stdout + exit code file; reports/owner-preset-accuracy-v358.md; read-only split math table stdout; TR-4.1..TR-4.4 results.

---

## Task 5: PO Pipeline Restart (6 scripts cycle) + Gap Report 166 Baseline + 3-Way Match Format (FR-6)

- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 baseline accuracy; can run parallel with Task 3/4 (PO pipeline = read-only by default, no receipt writes)
- **Scope**: Run PO pipeline IN ORDER per FR-6:
  1. `node scripts/po-fulfillment-orchestrator.mjs --action poll` → check `data/out/waybills-inbox.csv` for new entries. Save raw poll output.
  2. `node scripts/po-fulfillment-orchestrator.mjs --action feed` → feed any confirmed waybills to watchdog. If inbox empty, skip with "no waybills" line.
  3. `node scripts/po-execution-queue.mjs` → per-supplier worklist generate. Save `data/out/po-execution-worklist.json`.
  4. `node scripts/procurement-delivery-watchdog.mjs` → carrier state transitions (NO receipt writes to out/received/ — strict phone rule).
  5. `node scripts/generate-signed-pos.mjs` → signature generation ONLY, no file writes to receipt directory. Verify output prints "signature ready: N POs" without touching out/received/.
  6. Generate `reports/po-gaps-v358.md`: Section 1 = aggregate counts per owner (Younes 139 / Bachir 13 / Hind 14 = 166 total). Section 2 = per-gap expected POD hash format `POD:<CARRIER>-sha256:<64hex>` (carrier ∈ {AMANA, FORCELOG, CHRONO_DIALI, CATHEDIS, ARAMEX, DHL, FEDEX, UPS}). Section 3 = 3-way match status table per PO (PO_EXISTS? Y/N, SHIPMENT_EXISTS? Y/N, RECEIPT_CONFIRMED? Y/N). Section 4 = phone rule fail-closed statement.
  Post pipeline: verify `out/received/` directory still 0 non-gitkeep files and 0 recently modified timestamps.
- **Test Requirements (TRs)**:
  - **TR-5.1 (rule, covers AC-6)**: reports/po-gaps-v358.md exists, Section 1 lists 3 owners with counts summing 166, Section 2 POD format line present, Section 3 has ≥ 1 3-way-match status row.
  - **TR-5.2 (rule, covers AC-6 NG2 NO fabrication)**: `Get-ChildItem out/received -Recurse -File | Where-Object { $_.Name -ne '.gitkeep' } | Measure-Object | Select-Object -ExpandProperty Count` → returns EXACT 0. No new files created during steps 1-6.
  - **TR-5.3 (rule)**: Step 5 stdout contains NO phrase "wrote receipt" or "file saved to out/received/".
- **Completion Evidence**: Step 1-6 individual logs; reports/po-gaps-v358.md; out/received/ file count verification command output; TR-5.1/TR-5.2/TR-5.3 results.

---

## Task 6: Roger Vincent OSINT Report (Workstream D resume — 4 specialized queries + alias + 8-section document) (FR-8)

- **Status**: `pending`
- **Priority**: medium-high (explicit prior user request paused by accuracy rectification)
- **Depends On**: Tasks 1-5 accuracy pipeline COMPLETE (no blockers; can run in parallel with Task 5)
- **Scope**:
  - Q1: HMCTS UK Case Tracker offline query → Crown Court Southwark/Woolwich/Old Bailey "R v Roger Vincent" 2000-2010, motif terrorisme/fraude CB blanchiment.
  - Q2: InsideTime HMP Belmarsh archive → terror detainee rosters 2003-2015 exact Roger Vincent.
  - Q3: Companies House Disqualification Register → exact "Roger Vincent" DOB 1960-1990, addresses London SW1 Mayfair / Berkeley Square (ONMT Bachir overlap).
  - Q4: Cross Tariq Al-Daour 37 000 CB fraude 2.5M€ 2007 Woolwich Crown Court + co-accusé Waseem Mughal (12 ans) → liste des associés / co-défendants.
  - Q5: Alias exhaustif: "Rog Vince", "Roger V.", "R. Vincent", "Vincent, R.", full middle names "Roger [Middle] Vincent".
  Write report `audit/legal/DEPP_RESEARCH_LIENS_ROGER_VINCENT_HMP_BELMARSH_BACHIR_YOUNES_TSOULI.md` with 8 sections per FR-8 spec AC-8:
  1. Banner + DOCTRINE 0-FABRICATION (classification A/B/C rules).
  2. 5 profils publics NON INCARCÉRÉS Roger Vincent identifiés aujourd'hui (FinTech CGO, Investor NY, RN Commander, Disqualified Walker, Comic 1987).
  3. Section 3: 0 résultat nominal condamné OSINT open aujourd'hui (Q1-Q5 exhaustif).
  4. Section 4: Méthodes enquête OFFICIEL signataire: FOIA UK Freedom Of Information Act 2000 HMP Prison Service detainee rosters 2003-2015, Metropolitan Police SO15 Counter Terrorism Command public records, Home Office UKBA entry/exit logs Roger Vincent 1990-2015.
  5. Section 5: Analyse chevauchement temporel BACHIR Deputy Head Londres 1992-2002 vs ROGER VINCENT possible HMP Belmarsh 2003+ → 0 chevauchement temporel direct aujourd'hui démontrable.
  6. Section 6: Cross ONMT tourisme WTM/FITUR/ITB/IFTM professionnel tourisme/hôtellerie UK 1990-2002 si trouvé.
  7. Section 7: Conclusion globale. Classification C (hypothèse faible), score 2/10.
  8. Section 8: Liens + sources référencées.
- **Test Requirements (TRs)**:
  - **TR-6.1 (rule, covers AC-8)**: File `audit/legal/DEPP_RESEARCH_LIENS_ROGER_VINCENT_HMP_BELMARSH_BACHIR_YOUNES_TSOULI.md` exists AND contains ALL 8 section headings. grep for each heading = 8 matches.
  - **TR-6.2 (rule)**: Section 7 contains phrase "classification C" OR "score 2/10" AND Section 5 states explicitly "0 chevauchement temporel" OR "zero temporal overlap".
- **Completion Evidence**: 5 WebSearch query results (Q1-Q5) raw output; final MD report file; TR-6.1/TR-6.2 grep results.

---

## Task 7: Quality Gates — typecheck, lint, prisma validate, schema diff EMPTY, vitest 161+, changelog v3.5.8 prepend

- **Status**: `pending`
- **Priority**: high (must pass BEFORE local commit — ALWAYS last quality task before commit)
- **Depends On**: Tasks 1 through 6 ALL completed
- **Scope**: Run ALL quality gates sequentially. Prepend CHANGELOG.md v3.5.8 header section with:
  1. Version header `## v3.5.8 — 2026-10-05 — Restart Audit + Contentieux Escalation Cold + Revenue Routing DryRun + PO Pipeline Re-init + REAL ACCURACY Rectificatif 001-A Permanent`.
  2. Pipelines restarted summary: Audit (7 scripts), Contentieux Escalation (1 tick + corpus 3 docs), Revenue (v3.5.8 wrapper DryRun gate matrix, 6 preset 3-way accuracy check), PO Pipeline (6 scripts cycle + gap report 166), OSINT Roger Vincent report 8 sections, Accuracy 001-A 11/11 compliant.
  3. G2/G3 signataire action required verbatim list (DATABASE_URL len≥120 / BINANCE KEY / BINANCE SECRET).
  4. V3.5.8 HEAD SHA placeholder.
  5. Quality gate results: each gate with stdout pass line.
  6. Push runbook verbatim from v3.5.7 baseline (reboot → Admin PS HORS Trae → push-outside-sandbox-v358.ps1 6 steps).
- **Test Requirements (TRs)**:
  - **TR-7.1 (rule, C-1 NG1)**: `git diff prisma/schema.prisma` stdout = EMPTY string. `npx prisma validate` stdout contains "Your Prisma schema is valid".
  - **TR-7.2 (rule, NFR-4)**: `npm run typecheck` exit 0. `npm run lint` ≤ 0 NEW errors (tolerated pre-existing warnings allowed).
  - **TR-7.3 (rule, NFR-5)**: `npx vitest run --reporter=default` output regex `Tests\s+(\d+)\s+passed\s+\((\d+)\)` → $1 ≥ 161 AND FAIL count ≤ 2 (only workflow-sanitize + SettlementEngine T10 EXPIRED tolerated).
  - **TR-7.4 (rule)**: CHANGELOG.md v3.5.8 section header line IS the FIRST non-comment line after the file's top-level "# Changelog" header (i.e., prepended NOT appended).
- **Completion Evidence**: 4 gate stdout/stderr captured files; CHANGELOG.md v3.5.8 section file path; TR-7.1..TR-7.4 results.

---

## Task 8: Local Commit Stack (5 commits — Dissociation + Bachir OSINT + Accuracy Rectif 001-A + Roger Vincent Report + Restart Pipelines v3.5.8)

- **Status**: `pending`
- **Priority**: high (always FINAL task before Review Phase)
- **Depends On**: Task 7 quality gates ALL passed
- **Scope**: Local-only git commit 5 layers (push blocked by sandbox — runbook documented). Commits in order:
  - Commit 3: `chore(v358): DISSOCIATION FORMELLE SIGNATAIRE DISS-FORMAL-ATT-018 force probante 9/10 + project_memory L26/L40/L53`. Files: project_memory.md patches + audit/legal/DISSOCIATION_OFFICIELLE_*.md.
  - Commit 4: `chore(v358): OSINT BACHIR VOYAGES Deputy Head ONMT Londres + ≥103 missions 12 pays Niveau A 100%`. File: audit/legal/DEPP_RESEARCH_BACHIR_TSOULI_VOYAGES_*.md.
  - Commit 5: `chore(v358): RECTIFICATIF ACCURACY-001-A 7 fichiers + FAIL-CLOSED coordonnées huissier + PDF régénéré 6888 bytes`. Files: gen-huissier-pdf.cjs constants + HUISSIER_MANDAT_INFO_SECURE.pdf + 4 reports banners + project_memory accuracy lines.
  - Commit 6: `chore(v358): ROGER VINCENT OSINT 8 sections rapport classif C 2/10 0 chevauchement temporel Bachir 1992-2002 vs HMP 2003+`. File: audit/legal/DEPP_RESEARCH_LIENS_ROGER_VINCENT_*.md.
  - Commit 7: `chore(v358): RESTART pipelines Audit 7-scripts + Contentieux Escalation 1 tick corpus 3 docs + Revenue wrapper DryRun G2/G3 FAIL + PO Pipeline 166 gaps + REPORTS accuracy/preset/po`. Files: reports/ (FINAL-AUDIT-MASTER JSON+MD + accuracy-compliance + preset-accuracy + po-gaps) + .trae/specs/restart-audit-contentieux-revenue-po-v358/ (spec+tasks) + CHANGELOG.md v3.5.8 prepend.
  After each commit, record HEAD SHA. Verify final `git status` clean — no untracked/uncommitted files (except node_modules, .next, data/out, etc gitignored).
- **Test Requirements (TRs)**:
  - **TR-8.1 (rule)**: `git log --oneline -5` output shows all 5 commits with messages beginning `chore(v358):` in reverse chronological order (commit 7 most recent, commit 3 oldest of the 5).
  - **TR-8.2 (rule)**: `git diff --cached` EMPTY; `git status --porcelain | grep -v '^??' | wc -l` = 0 (no staged, no unstaged changes). Untracked allowed if .gitignore'd.
- **Completion Evidence**: `git log -5` stdout; `git status --porcelain` stdout; 5 commit SHA list per message; TR-8.1/TR-8.2 results.
