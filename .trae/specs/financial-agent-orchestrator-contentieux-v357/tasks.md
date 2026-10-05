# Tasks — CRITICAL FINANCIAL AGENT Orchestrator v3.5.7 (Revenue Canonicalize → Reconcile → Contentieux Batches → Attijari Rail → Audit + Query)

Spec: [spec.md](./spec.md) (AC-1..AC-15, 10 rules + 5 rubrics)

---

## Task 1: Build Financial Agent Orchestrator Module (src/lib/financial/financial-agent-v357.ts OR scripts/financial-agent-v357.mjs) — Pipeline Engine Core

- **Status**: `pending`
- **Priority**: high
- **Depends On**: (none — foundational task)
- **Scope**: Implement the orchestrator pipeline with stages S0..S7, exporting BOTH: (a) a module `runFinancialAgent(options?)` for programmatic use + (b) CLI entry `scripts/financial-agent-v357.mjs`. Stage list:
  - **S0 Policy gate**: OWNER_HANDS_FREE_POLICY + OWNER_EXEC_UNLOCK length ≥ 16; DATABASE_URL ping SELECT 'ping' ok; print rail_env present X/16 (len + masked only); DRY_RUN=1 default print.
  - **S1 PRE snap**: `getOwnerLedgerStatus()` aggregate snapshot (totalSent/totalReceived/held/spendable in USD equiv); save PRE for delta checks.
  - **S2 Canonicalize raw revenues**: Read ALL `RevenueEvent` from Neon → filter status='completed' AND proofHash IS NOT NULL AND LENGTH(proofHash) ≥ 10; produce `CanonicalRevenueEvent[]` per spec FR-1. For non-passing rows: emit a structured SKIPPED list with reason category (pending_status / PENDING_REASONING / null_proofHash / short_proofHash / placeholder_ref).
  - **S3 Inbound Reconcile (idempotent)**: Per canonical event → marker check `RevenueLedgerEntry WHERE idempotencyKey='recon-inbound:v357:<reId>'`. If exists → IDEM-SKIP. If missing → Serializable 30s txn: insert marker → split 10/40/30/20 (penny residual → salary bucket) → for RIB182/RIB372/BC646 real presets: `UPDATE OwnerAccount SET totalReceived += amount, heldBalance += amount, txCount +=1 WHERE id=<presetId>` (4th/5th/6th presets PayPal/Payoneer/USDC skip ledger update if rail secrets not loaded → instead print reason). Write 4× OwnerSettlement (direction='inbound', connectorStatus='manual_attested_finance', dataSource='manual_attested_finance', externalRef=`CONTENTIEUX-RECON-V357-<20hex>` trigger-compliant non-synthetic prefix [NOT PB/RECOVERY/REV…], proofHash=sha256). Write 4× AuditLedger FINAGENT_RECONCILE_* rows with cuid-style explicit id.
  - **S4 Batch generation for 6 presets**: Determine correct bucket per preset (FIX v354 conflation bug: RIB182 → salary 10%, RIB372 → debt 40%, BC646 → sovereign 30% + runtime 20% DUAL batch entries, PayPal → runtime 20%, Payoneer → procurement buffer, USDC → crypto bypass). Default release amount = 120 USD * multiplier. If heldBalance < 0.15 USD → skip entire preset "skip: held < 0.15". If heldBalance < releaseAmt → skip with "skip: <releaseAmt> > held <held>". Contentieux reference format: `REF-CONTENTIEUX-<branchCode>-<7digit>-<CFONB(SALA|REMB|CRED|FOURN|CRYP)>-<sha28>`. buildAutoRef minute-floored idem preserved.
  - **S5 Contentieux Rail send + poll**: Per batch not skipped → resolve rail using preset's `ownerAccount.accountNumber` (IBAN stored on preset) as FIRST truth; GLOBAL OWNER_IBAN env var ONLY if preset.accountNumber NULL. Signataire header: `X-Titulaire-CIN: ATTIJARI_TITULAIRE_CIN || 'A337773'` (always). If `LIVE_BANK_API` set → `initiatePayment(creditorIban, creditorName, amount, currency, reference, remittance)`. If real paymentId (len ≥6, non-placeholder regex): `UPDATE OwnerAccount held -= amt spendable += amt totalSent += amt txCount += 1`; write OwnerSettlement completed connectorStatus=live dataSource=live_bank_api connectorId=attijari_psd2_pisp externalRef=paymentId proofHash. Else: fail-closed, row status='needs_manual_proof' reason=message. Post send: 200ms sleep then getPaymentStatus once; write to metadata.transactionStatus. 24h/4h escalation rule: implemented as a post-send SELECT for old processing rows + status update + PaymentEscalation QUARANTINE if 48h/8h past.
  - **S6 POST snap**: Repeat ledger snapshot; compute deltas.
  - **S7 Idempotency + summary print**: Print `re-run delta totalReceived = X.XX / held = X.XX / spendable = X.XX / totalSent = X.XX`; print SKIPPED FAIL-CLOSED SUMMARY aggregate; print 6 preset summary; exit code 0 if no hard failures (fail-closed skips are OK and do NOT change exit code).
  - **Module exports**: `runFinancialAgent()`, `getFinancialAgentStatus(options?)` per FR-8; `canonicalizeRevenueEvents()`, `reconcileInbound(canEvents, tx?)` (callable individually).
  - **CLI entry**: `node scripts/financial-agent-v357.mjs status` → prints formatted status table with secrets masks; default `run` → S0..S7 pipeline.
- **Test Requirements (TRs)**:
  - **TR-1.1 (rule, covers AC-9)**: Run orchestrator WITH NO elevated env vars → `DRY_RUN=1 default` stdout line present; exit code 0; row counts before vs after on OwnerAccount/OwnerSettlement/RevenueLedgerEntry/AuditLedger = IDENTICAL (all 0 delta). Evidence: row count SQL stdout captured.
  - **TR-1.2 (rule, covers AC-2, AC-1 part)**: Run `DRY_RUN=0 EXECUTE_RECONCILE_ONLY=1` (no real rail attempt) → OwnerAccount.totalReceived delta for RIB182/RIB372/BC646 = $12.73/$50.92/$63.65 (if still 1 completed Crypto Yield row on Neon); spendable/totalSent delta = $0.00. Evidence: POST snap stdout table vs PRE.
  - **TR-1.3 (rule, covers AC-3)**: Run EXECUTE_RECONCILE_ONLY=1 TWO consecutive times. 2nd run stdout contains `[idem] RevenueLedgerEntry ON CONFLICT DO NOTHING: 1 rows skipped` AND `[FINAL] Idempotency check: re-run delta totalReceived = 0.00`. Evidence: captured 2nd run stdout.
  - **TR-1.4 (rule, covers AC-4)**: Skipped fail-closed list contains ≥ 12 rows with aggregate $≥14,000 USD equiv, printed in SKIPPED block with category reasons. Evidence: stdout block.
  - **TR-1.5 (rule, covers AC-10)**: Preset bucket map function maps RIB182→salary, RIB372→debt_repayment, rib646→sovereign+runtime dual, PayPal→runtime, Payoneer→procurement_buffer, USDC→crypto_bypass (6 unique entries, 0 conflation of RIB182/RIB372). Evidence: stdout print of preset→bucket map OR unit test assertions.
  - **TR-1.6 (rubric, covers AC-14 dimension)**: Code consistency 0-2. Scale anchors: 0 = totally alien style. 1 = reuses prisma/db/attijariwafa-psd2/sha256/buildAutoRef patterns + naming. 2 = stage structure exactly mirrors autorun S0..S6 (snap, daemon ticks, release, idem, final snap). Pass threshold ≥ 1. Evidence: code review comparison file paths.
- **Completion Evidence**: File path of orchestrator module + CLI; captured TR-1.1..TR-1.6 results.

---

## Task 2: Fix resolveRail per-preset accountNumber IBAN + bucket conflation in release engine helpers

- **Status**: `pending`
- **Priority**: high
- **Depends On**: (task 1 can proceed in parallel with this; but S5 rail send DEPENDS on this fix → so this MUST complete before Task 1 S5 is tested)
- **Scope**: Patch `src/lib/treasury/release-engine.ts resolveRail(owner)` L73-89 so the returned `iban` is:
  1. `owner.accountNumber?.replace(/\s+/g, '').toUpperCase()` first (stored IBAN on the preset OwnerAccount row from Neon).
  2. If preset IBAN is empty/null → fallback to `OWNER_PAYOUT_IDENTIFIER || OWNER_IBAN || IBAN_BC || ''`.
  3. Error reason when LIVE_BANK_API missing: continue fail-closed pattern.
- Also: fix `auto-run-v354-owner-payouts.ts mapBucket()` L30-31 — RIB182 → `salary_bucket` (correct) but RIB372 → MUST return `debt_repayment` bucket code NOT `salary_bucket` (the actual conflation bug). Add runtime assertions (throw if bucket code not in BUCKET_CODES).
- **Test Requirements (TRs)**:
  - **TR-2.1 (rule)**: A mock OwnerAccount with accountNumber=LU646 REAL IBAN, accountNumberLast=646 → resolveRail returns `iban='LU646REALIBAN...'` NOT the env fallback. Evidence: unit-call or trace stdout.
  - **TR-2.2 (rule)**: mapBucket for accountNumberLast='372' label.includes('debt') returns bucket code `debt_repayment` NOT `salary_bucket`. All 6 presets return distinct bucket codes. Evidence: function call output table.
- **Completion Evidence**: Diff of release-engine.ts resolveRail patch + mapBucket fix.

---

## Task 3: AuditLedger Append-Only Wrapper + cuid-style Deterministic ID Generator

- **Status**: `pending`
- **Priority**: medium (can be done inline in Task 1; standalone for coverage)
- **Depends On**: None
- **Scope**: Add a helper `writeAuditLedger(operation, body, prisma)` under `src/lib/financial/` (or inline in financial-agent-v357.mjs) that:
  - Generates explicit deterministic cuid-style id: `aud357` + sha256(`${operation}:${JSON.stringify(body)}:${Math.floor(Date.now()/60000)}`).slice(28) — never rely on Prisma @default(cuid()) inside raw inserts because `$executeRawUnsafe` doesn't run Prisma middleware (TRUTH from v3.5.6 reconciler errors).
  - Column list: `id, createdAt, operation, actor, proofHash, body` (NO updatedAt per cols-extra truth set).
  - `proofHash = sha256(operation + ':' + JSON.stringify(body))` — always 64-hex.
  - `actor = 'swarm/financial-agent-v357'`.
  - body JSON stringified with sensitive fields redacted (any key matching /secret|key|token|private|password|cin/i → value replaced with `{len:value.length, masked:value.slice(0,4)+'…'}`).
  - Return the created row id.
- **Test Requirements (TRs)**:
  - **TR-3.1 (rule, covers AC-7 partial)**: After calling helper for operation=FINAGENT_CANONICALIZE with body={secretKey:'sk_live_1234567890123456'}, new AuditLedger row exists where operation matches, body JSON contains `{secretKey: {len: 20, masked: 'sk_l…'}}` (value NOT present literally), and proofHash matches sha256 of the REDACTED canonical body + op prefix. Evidence: SQL SELECT after call.
  - **TR-3.2 (rule)**: AuditLedger id col for new row is NOT `null`, NOT empty. Running `$executeRawUnsafe INSERT without explicit id` = fail expected 23502 NOT NULL; but our helper = always ok. Evidence: id regex match.
- **Completion Evidence**: Helper file path; TR-3.1/TR-3.2 outputs; SQL row evidence.

---

## Task 4: Query Agent Status Module + CLI Status Command

- **Status**: `pending`
- **Priority**: medium (can be done in parallel with Task 1 S7)
- **Depends On**: None
- **Scope**: Implement `getFinancialAgentStatus(options?)` as per FR-8. Also CLI `scripts/financial-agent-v357.mjs status` that prints it formatted. Status includes: pipelineHealth.counts (canon, reconciled, skipped, batches, dispatched, needsManual, unknown, quarantined); presets[] array (each with ownerLabel, heldBalance, spendableBalance, lastReleasedAt, lastLivePaymentId, needsRailSecrets[] string list); last5PaymentIds[]; idemKeysWrittenThisTick[]; secretsLoadedCount/secretsMissingCount/secretsMissingList; auditTrailLast10[]. Reuse `RAIL_KEYS` list from autorun-owners-full-v354 L24-32 for secrets inventory.
- **Test Requirements (TRs)**:
  - **TR-4.1 (rule, covers AC-8)**: With LIVE_BANK_API len=32 + ATTIJARI_TITULAIRE_CIN len=7 + PAYPAL_CLIENT_ID len=16 + PAYPAL_CLIENT_SECRET len=28 (4 keys) → secretsLoadedCount === 4, secretsMissingCount === 12, secretsMissingList.length === 12, each list entry ∈ the 16 C-4 RAIL_KEYS (no duplicates, no invented names). No PAYPAL_CLIENT_SECRET value printed anywhere — only len+mask. Evidence: CLI status stdout + JSON return.
  - **TR-4.2 (rule)**: CLI status exit code 0; presets array length = 6; each preset entry has ownerLabel matching the Contentieux address book. Evidence: captured stdout table.
- **Completion Evidence**: Module export, CLI subcommand; TR-4.1/TR-4.2 output.

---

## Task 5: Quality Gates — typecheck, prisma validate, schema diff EMPTY, vitest 161+, changelog v3.5.7 prepend

- **Status**: `pending`
- **Priority**: high (must pass BEFORE commit)
- **Depends On**: Tasks 1, 2, 3, 4 all completed
- **Scope**: Run all gates; prepend CHANGELOG.md v3.5.7 section with:
  - Version header + date 2026-10-01
  - Root cause (fragmented pipeline across scripts, resolveRail used global IBAN, bucket conflation debt=salary, no canonical layer, no idempotent pipeline, no query surface)
  - Fix summary (4-stage pipeline S0..S7 core, per-preset resolveRail, bucket code fix v354→v357, AuditLedger FINAGENT_* append ops 10 cat, getFinancialAgentStatus + CLI status)
  - AC-1/AC-2 delta table (RIB182 +12.73, RIB372 +50.92, BC646 +63.65 = 127.30) if EXECUTE_RECONCILE_ONLY=1 run succeeds
  - Autorun/SECRETS GAP INVENTORY 4/16 loaded if secrets still partial (12 missing names list)
  - Push status with the now-stable 5-deep commit stack from v3.5.6 + new v3.5.7 commit stacked on top; verbatim outside-sandbox push runbook retained (reboot, admin PS1 outside Trae, fetch/rebase/force-with-lease + SHA verify)
  - Quality gate stdout: typecheck exit 0, prisma validate "Your Prisma schema is valid", `git diff prisma/schema.prisma` EMPTY, vitest `≥ 161 passed / 2 preexisting fails / 0 new fails` (NOTED: 2 fails tolerated are workflow-sanitize regex null + SettlementEngine T10 EXPIRED drift)
- **Test Requirements (TRs)**:
  - **TR-5.1 (rule, AC-6 NG1)**: `git diff prisma/schema.prisma` shell stdout === EMPTY string, exit code 0. `npx prisma validate` output contains exact line `Your Prisma schema is valid`.
  - **TR-5.2 (rule, AC-6 typecheck)**: `npm run typecheck` exit code 0.
  - **TR-5.3 (rule, AC-6 vitest)**: `npx vitest run --reporter=default` output line matches regex `Tests\s+(\d+)\s+passed\s+\((\d+)\)` → captured $1 ≥ 161, captured $2 = 161+2 fails tolerance → number failing tests ≤ 2 AND failing tests contain ONLY the preexisting names (workflow-sanitize, SettlementEngine.mock). No new test file failures allowed.
  - **TR-5.4 (rubric, AC-11)**: Workflow fidelity 0-2. 2 = all 5 Spec Mode phases followed exactly, spec/tasks exist, review.md will be created in Phase 5 (not yet here). 1 = ≤ 1 phase boundary slip. Pass threshold ≥ 1.
- **Completion Evidence**: All four gate stdout captured; CHANGELOG.md v3.5.7 section prepended to file with clickable file links to new orchestrator artifacts.

---

## Task 6: Local Commit (chore: v357 financial agent orchestrator 4-stage pipeline, resolveRail per-preset, bucket conflation FIX, audit 10 ops, query status)

- **Status**: `pending`
- **Priority**: high (always last task in Implement phase before Review)
- **Depends On**: Task 5 all gates passed
- **Scope**: `git add` EXACTLY the new/edited files:
  1. `src/lib/financial/financial-agent-v357.ts` OR `scripts/financial-agent-v357.mjs` (whichever module approach chosen)
  2. `src/lib/treasury/release-engine.ts` (resolveRail patch)
  3. `scripts/auto-run-v354-owner-payouts.ts` (mapBucket conflation fix)
  4. `src/lib/financial/audit-ledger-v357.ts` (helper, OR inline code path within orchestrator)
  5. `.trae/specs/financial-agent-orchestrator-contentieux-v357/spec.md` + `tasks.md` (these artifacts)
  6. `CHANGELOG.md` (v3.5.7 prepended)
  - NEVER add `.next/`, `node_modules/`, `data/out/*.json`, rail secrets.
- Commit message: `chore(v357): Financial Agent orchestrator 4-stage S0..S7 pipeline — canonicalize→reconcile→Contentieux 6-presets batches→Attijari rail. resolveRail per-preset IBAN FIX. bucket conflation debt/salary FIX. AuditLedger FINAGENT_* 10 operations. Query Agent getFinancialAgentStatus + CLI status. typecheck 0 prisma validate valid schema diff 0 vitest ≥161 pass. NG1 preserved.`
- Record final HEAD SHA (print git rev-parse HEAD). Status: local-only commit expected (push blocked per v3.5.6 issues; changelog already documents runbook).
- **Test Requirements**:
  - **TR-6.1 (rule)**: `git status --short` after `git reset` + staged files listed above → all staged non-untracked expected, no secret files, no data/out files listed. Evidence: stdout.
  - **TR-6.2 (rule)**: commit completes with exit code 0; `git log --oneline -1` contains string `(v357):` or similar. Evidence: stdout.
- **Completion Evidence**: commit SHA hex string printed; git status clean after commit.

---

## Task 7: Best-effort Push Attempt + Document Failure Modes (if sandbox still blocked)

- **Status**: `pending`
- **Priority**: low (informational — not required for pipeline functional success; user profile says push commits)
- **Depends On**: Task 6 SHA exists
- **Scope**: Run `git push https-origin main` — if TRAE sandbox `git-credentials.lock` hits "Not allow operate files" → log the exact error; then try `-c credential.helper= -c core.askpass=` push to check MSYS2 fork crash status → log that also. Note: per v3.5.6 push blockers, we EXPECT both to fail and document in changelog. This task exists for documentation completeness + for the rare case MSYS2 DLL state is healthy now. If push SUCCESS (unexpected), compare `git rev-parse HEAD` vs `git ls-remote https-origin main` first column match (SHA verify pass).
- **Test Requirements (TRs)**:
  - **TR-7.1 (rule, informational)**: Either: (a) push FAILS with one of the two documented signatures (TRAE lock OR MSYS2 0xC0000142) → runbook instruction valid OR (b) push SUCCESS → ls-remote SHA == HEAD SHA. Either case passes (both expected states).
- **Completion Evidence**: push stdout captured verbatim.

---

## AC → Task Map (traceability — every AC must be covered by ≥1 task TR)

| Spec AC | Covered By Task TR |
|---|---|
| AC-1 (rule: totalReceived delta $12.73/$50.92/$63.65 = $127.30) | Task 1 → TR-1.2 |
| AC-2 (rule: spendable/totalSent $0.00 delta partial live) | Task 1 → TR-1.2 |
| AC-3 (rule: idempotency 2nd run 0 deltas + IDEM-SKIP line) | Task 1 → TR-1.3 |
| AC-4 (rule: 12 skipped fail-closed rows $14,824.75 block) | Task 1 → TR-1.4 |
| AC-5 (rule: 6 presets Contentieux ref regex CFONB SALA/REMB/CRED/FOURN/CRYP + CIN header) | Task 1 scope + Task 2 (CIN header via resolveRail → live calls) |
| AC-6 (rule: NG1 empty diff / typecheck 0 / prisma validate / vitest ≥161 ≤2 fails tolerated) | Task 5 TR-5.1, TR-5.2, TR-5.3 |
| AC-7 (rule: all FR-7 op categories ≥ 1 AuditLedger row; proofHash 64-hex) | Task 3 TR-3.1 (redact) / TR-3.2 (explicit id) + Task 1 S2..S5 scope writes ops |
| AC-8 (rule: query agent secrets count 4/16 + list len=12 + NO secret values) | Task 4 TR-4.1, TR-4.2 |
| AC-9 (rule: DRY_RUN default no DB writes) | Task 1 TR-1.1 |
| AC-10 (rule: resolveRail per-preset IBAN priority; bucket 6 unique no conflation) | Task 2 TR-2.1, TR-2.2 + Task 1 TR-1.5 |
| AC-11 (rubric: workflow 0-2, threshold ≥ 1) | Task 5 TR-5.4 |
| AC-12 (rubric: audit density 0-2, threshold ≥ 1) | Task 3 TRs + Task 1 S2..S5 audit ops |
| AC-13 (rubric: fail-closed safety ≥ 1) | Task 1 TR-1.1/TR-1.2/TR-1.3 (partial); add explicit fabricated placeholder ref mock test if time allows |
| AC-14 (rubric: code consistency ≥ 1) | Task 1 TR-1.6 |
| AC-15 (rubric: real-money readiness ≥ 1 — partial live acceptable) | Task 1 TR-1.2/TR-1.4 stdout (PARTIAL LIVE 4/16 secrets runs ok; DRY exit 0 ok) |
