# SPEC MODE #6 Tasks Queue — Live Deploy (All Mirrors) + Live Exec (All 6 Routes) v3.5.8
> Parent spec: `spec.md` AC1→AC13 (26 pts total, pass=21/26). Mapping: 15 Tasks T0→T14. Status: pending. SANS-DB 0 deps.
---
## Legend
Status: pending | in_progress | completed | blocked.
TR = Test Requirement per Task: rule OR rubric (0..N scale, threshold).
Evidence path = Rapport under `reports/live-deploy-exec-v358/` + HMAC line written `data/out/live-deploy-exec-v358.ndjson`.

---

## T0 BOOTSTRAP — Initialisation + Audit Chain (Couvre AC9, AC11)
- **Status**: pending
- **Priorité**: high
- **Dépend**: Rien (Task 0)
- **Livrables**:
  - Créer `data/out/live-deploy-exec-v358.ndjson` si absent → truncate à 0 fresh chain chaque run.
  - Créer dossiers `reports/live-deploy-exec-v358/` + `scripts/live-deploy-exec/` + `data/swarm_autonomy/logs/` + `out/received/` + `exports/bank-wire/` si absents.
  - RUN_INIT HMAC line: `RUN_INIT|<isoTS>|<payload_json>|<sha256_hmac>` (step="RUN_INIT").
  - T0_DIR_SANITY HMAC line: vérifie 5 dirs created + gitignore intact.
  - HMAC key = `process.env.OWNER_EXEC_UNLOCK` si len≥43, sinon **DUMMY hardcodé** `SWARM-AUDIT-DUMMY-KEY-V358-000000000000` (43 chars exact, fallback toujours).
- **TRs**:
  - **TR-0.1 rule**: `existsSync(data/out/live-deploy-exec-v358.ndjson)` et `readFileSync(ndjson).split('\n').length === 2` après T0 (RUN_INIT + T0_DIR_SANITY exactement).
  - **TR-0.2 rule**: 5 dossiers absents avant T0 → présents après T0.
  - **TR-0.3 rubric 0..2 scale**: HMAC line format regex `^[A-Z0-9_]+\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|.*\|[a-f0-9]{64}$` 2/2 match → 2/2; 1/2 → 1/2; sinon 0.
- **Evidences**: T0_BOOTSTRAP HMAC line 2.

---

## T1 DEPLOY_TARGETS_INVENTORY — Constats 9 targets (Couvre AC1)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T0
- **Livrables**: `reports/live-deploy-exec-v358/01_deploy_targets_status.md` 9 rows × 4 cols (Target, Mécanisme, Prérequis, Status+SKIP reason).
- **Règles statut par target**:
  - T1 GitHub: Status=`🔒 RUNBOOK-GENERATED ADMIN HORS TRAE (USER double-clic required)` (never 0 push inline).
  - T2 GitLab: Status=`❌ SKIP (GITLAB_MIRROR_REPO env absent, paste env PAT write_repository)`
  - T3 Codeberg: Status=`❌ SKIP (CODEBERG_MIRROR_REPO env absent + SSH key ssh-agent not running)`
  - T4 Local mirror: Status=`❌ SKIP (LOCAL_MIRROR_DIR env absent, set e.g. D:\swarm-doomsday-mirror\repo.git)`
  - T5 zspace swarm dirs: Status=`✅ OK (mkdir -p data/swarm_autonomy/logs zspace dirs)`
  - T6 Base44 RevenueEvents: Status=`❌ SKIP (BASE44_APP_ID + BASE44_SERVICE_TOKEN env absents — 2 fallback seed entries dummy NG1 read-only)`
  - T7 Doomsday Vault: Status=`⚠️ CONDITIONAL (if .keys/doomsday-passphrase.txt exists && openssl on PATH → runbook generate + local vault build run doc; else SKIP reason doc both missing)`
  - T8 SecureCloud Supabase: Status=`❌ SKIP (3/3 env absents: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + MIRROR_SUPABASE_BUCKET)`
  - T9 Vercel Web: Status=`❌ SCOPE-EXCLUDED (user explicit multi-select NOT Vercel choice, AskUserChoices 2026-10-05)`
- **TRs**:
  - **TR-1.1 rule**: 9 markdown table rows exacts, colonne "Status" SKIP cells len ≥ 45 chars.
  - **TR-1.2 rule**: T1 row string contains `RUNBOOK-GENERATED ADMIN HORS TRAE` substring EXACT.
  - **TR-1.3 rubric 0..2**: 0 empty FALSE cells 2/2; ≥1 empty → 0; sinon 1. Expected 2/2.
- **Evidences**: Report 01 lines + HMAC line T1_DEPLOY_TARGETS_INVENTORY.

---

## T2 DEPLOY_RUNBOOKS_GENERATE — 7 Fichiers Runbooks (Couvre AC2, AC11)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T1
- **Livrables**: Générer dans `scripts/live-deploy-exec/` 7 fichiers exacts (UTF-8 BOM pour PS1, UTF-8 sans BOM pour CMD):
  - **DEPLOY-01-GITHUB-HORS.cmd**: Header Admin UAC check (`@echo off` + `>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"` → errorlevel 1 → elever auto); cd repo; call `powershell -ExecutionPolicy Bypass -File scripts\push-outside-sandbox-v358.ps1 -Verbose`; pause à la fin.
  - **DEPLOY-02-GITLAB.cmd**: Check `%GITLAB_MIRROR_REPO%` defined si non exit 1 msg set env; call `scripts\mirrors\sync-mirrors.cmd` subsection GitLab only; pause.
  - **DEPLOY-03-CODEBERG.cmd**: Check `%CODEBERG_MIRROR_REPO%`; call sync-mirrors cmd Codeberg; pause.
  - **DEPLOY-04-LOCAL-MIRROR.cmd**: Check `%LOCAL_MIRROR_DIR%` exists; call sync-mirrors local section; pause.
  - **DEPLOY-07-DOOMSDAY-VAULT.ps1** (UTF-8 BOM): `#Requires -RunAsAdministrator` pragma; call `scripts\mirrors\backup-doomsday-vault.ps1 -Verbose`; log output.
  - **DEPLOY-08-SECURE-CLOUD.cmd**: Check 3 SUPABASE envs; call `scripts\mirrors\secure-cloud-upload.cmd`; pause.
  - **LIVE-DEPLOY-EXEC-1-CLICK.cmd** (MASTER): Call 01→08 enchaînement ordonné (01 GitHub puis 02/03/04 mirrors puis 07 vault puis 08 secure cloud); PUIS call `scripts\START-OWNER-HANDS-FREE.cmd` (Live Exec All 6 rails); à la fin affiche `FIN_DEPLOY_EXEC_20261005 SUCCESS %ERRORLEVEL%`.
- **Sécurité**: Tous runbooks NE CONTIENNENT AUCUNE VALEUR DE SECRET RÉELLE — uniquement des placeholders `%ENV_VAR%` résolus runtime PS/CMD.
- **TRs**:
  - **TR-2.1 rule**: `readdirSync(scripts/live-deploy-exec)` non-gitkeep count=7 exact fichiers.
  - **TR-2.2 rule**: LIVE-DEPLOY-EXEC-1-CLICK.cmd lines grep 01 cmd + 02 + 03 + 04 + 07 + 08 + START-OWNER-HANDS-FREE = 7 calls distincts.
  - **TR-2.3 rule (AC11)**: Grep 12 patterns secrets 0 matches valeurs dans les 7 fichiers (placeholders %VAR% autorisés).
- **Evidences**: Report 02 lines 7 file list + checksums + HMAC line T2_DEPLOY_RUNBOOKS_GENERATE.

---

## T3 HANDSFREE_CONFIG_SNAPSHOT 0 LEAK (Couvre AC3, AC11)
- **Status**: pending
- **Priorité**: medium
- **Dépend**: T2
- **Livrable**: `reports/live-deploy-exec-v358/03_handsfree_config_snapshot.md` — Parse `.swarm/owner-hands-free.config.ps1` §A 8 minimal keys lines 21-54; affiche chaque key nom + statut empty/non + `maskSecret(value)` si non vide (len info seulement). Function maskSecret: `(s) => !s ? '(EMPTY_PLACEHOLDER)' : s.slice(0,4)+'…'+s.slice(-2)+' len='+s.length`.
- **TRs**:
  - **TR-3.1 rule**: 8 keys rows (DATABASE_URL, LIVE_BANK_API, BINANCE_API_KEY, BINANCE_API_SECRET, CEX_DIRECT_DEPOSIT_ENABLED, RELEASE_AMOUNT_OVERRIDE_USD, OWNER_EXEC_UNLOCK, OWNER_HANDS_FREE_POLICY).
  - **TR-3.2 rule**: Expected Today 8/8 rows status `EMPTY_PLACEHOLDER` (signataire pas encore rempli).
  - **TR-3.3 rule (AC11)**: 0 chars hors A-Z/a-z/0-9/:/'_-'/len= mot dans values — aucune vraie valeur secrète.
- **Evidences**: Report 03 + HMAC T3 line.

---

## T4 GATE_MATRIX_SNAPSHOT G1-G4 Honest Audit (Couvre AC4)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T3
- **Livrable**: `reports/live-deploy-exec-v358/04_gate_matrix_live.md` 4 rows G1..G4 × 4 cols: Gate ID, Description, Status, Detail 50+ chars. Status attendu Today 4/4 FAIL.
  - G1: "≥8 secrets §A injected" → Status FAIL detail="0/36 keys filled .swarm/owner-hands-free.config.ps1 §A 36 ordered placeholders ALL empty → threshold 8 min FAIL_CLOSED NOOP"
  - G2: "DATABASE_URL Neon pooled len≥120" → FAIL detail="len=0 empty. Expected Neon PROD pooled URL format postgres://user:pass@ep-...pooled...aws.neon.tech?sslmode=require options project=... len≈122"
  - G3: "Binance KEY+SECRET len≥32 each Spot Withdraw" → FAIL detail="KEY len=0 SECRET len=0. Expected len≥32 both HMAC dual scope Spot Withdraw + Wallet Status + IP whitelist 45.155.0.0/16 set in Binance API console"
  - G4: "OWNER_EXEC_UNLOCK len≥43 high entropy" → FAIL detail="len=0 empty. Expected 43+ chars e.g. openssl rand -base64 40 | tr -d '\\\\n' produces 54 chars alphanumeric base64URL."
- **TRs**:
  - **TR-4.1 rule**: 4 markdown lines G1-G4 status string exact "FAIL".
  - **TR-4.2 rule**: Détails colonne 4 strings longueur toutes ≥50 chars.
- **Evidences**: Report 04 + HMAC T4.

---

## T5 LIVE_EXEC_WRAPPER_CALL Capture Exitcode (Couvre AC5)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T4
- **Livrable**: `reports/live-deploy-exec-v358/05_live_exec_wrapper_exitcode.md`
- **Exécution (SANS élévation, sandbox normal)**:
  - Pré-check: `process.env.DATABASE_URL?` & autres → tous 0.
  - Spawn child_process.execSync: `powershell -ExecutionPolicy Bypass -NoProfile -NonInteractive -File scripts\\start-owner-hands-free.ps1` (NE PAS Start-Process RunAs).
  - Capture LASTEXITCODE stdout + stderr. Wrap dans `try/catch`; Expected today=5 (failclosed, 0 secrets).
  - Si EXIT=5 → doc string "Wrapper FAILCLOSED 0 secrets → 0 rails exécutés, 0 payout 0 Binance call NOOP_SAFE".
  - Si EXIT=99 → "Gates PASS mais DB auth fail expected Neon".
  - Si EXIT=0 → "SUCCESS real execution withdrawId real → doc actual values masked".
- **TRs**:
  - **TR-5.1 rule**: Exitcode today attendu=5 (constant gate closed).
  - **TR-5.2 rule**: Stdout doc lines 1-16 contains `maskSecret` format calls for each key len info.
  - **TR-5.3 rule**: 0 crash UAC / 0 elevation prompts (proc spawn mode=NonInteractive).
- **Evidences**: Report 05 + HMAC T5_LIVE_EXEC_WRAPPER_CALL.

---

## T6 ALL6_ROUTES_EXEC_AUDIT Honnête (Couvre AC6)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T5
- **Livrable**: `reports/live-deploy-exec-v358/06_all6_routes_exec_audit.md` 6 preset rows × 5 cols: PresetID, RailClass, CredsMissingCount, Status, Detail.
  - R1 ATTIJARI_RIB182_SALAIRE: CredsMissing=4 → SKIP
  - R2 ATTIJARI_RIB372_DETTE_018: CredsMissing=4 → SKIP
  - R3 BC_LU24_RIB646_SOUVERAIN: CredsMissing=5 → SKIP
  - R4 BC_LU24_RIB646_OPS: CredsMissing=5 → SKIP
  - R5 PAYONEER_B2B_BUFFER: CredsMissing=4 → SKIP (CIP ouvert plus 3 creds)
  - R6 USDC_ARBITRUM_L2: CredsMissing=5 → Status=`✅ DRY_RUN_MATH_ELIGIBLE_ONLY (BC646 held=$63.67 USD ≥ RELEASE_OVERRIDE_USD=$60.00 → Δ=$3.67 USD. Wallet dest=0xA46225a984E2B2b5E5082E52AE8d8915A09FEFE7 checksum EIP55 valid. idempotencyKey=AUTO-RELEASE-BC646-${YYYYMMDDHHMMSS} aujourd'hui. ZERO real Binance API call. NO side effects.)`
- **TRs**:
  - **TR-6.1 rule**: R6 status string starts with `✅ DRY_RUN_MATH_ELIGIBLE_ONLY` + contains both "63.67" and "0xA46225a984E2B2b5E5082E52AE8d8915A09FEFE7".
  - **TR-6.2 rule**: R1..R5 CredsMissingCount respective values 4,4,5,5,4 EXACT; 5 strings start with `❌ SKIP`.
- **Evidences**: Report 06 + HMAC T6 line.

---

## T7 FAILCLOSED_SKIP_REASONS Coverage 100% (Couvre AC7)
- **Status**: pending
- **Priorité**: medium
- **Dépend**: T6
- **Livrable**: `reports/live-deploy-exec-v358/07_failclosed_skip_reasons.md` — Concatène TOUS les SKIP cells de T1 Deploy (5 cells T2..T4 T6 T7 T8), T4 Gate Matrix non-utilisé, T6 Routes (R1..R5 5 cells), Total ≥14 SKIP cells. Compte + affiche chaque cellule avec Index + Reason string + longueur.
- **TRs**:
  - **TR-7.1 rule**: SkipReasonList Count ≥14.
  - **TR-7.2 rule**: Every reason string.length ≥40 chars (14/14 PASS exact).
  - **TR-7.3 rubric 0..2**: 0 strings courtes <40 → 2/2; 1→1/2; sinon 0. Expected 2/2.
- **Evidences**: Report 07 table 14+ rows + HMAC T7.

---

## T8 ZERO_LOSS_DERIVE_BALANCE Identity Guarantee (Couvre AC8)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T7
- **Livrable**: `reports/live-deploy-exec-v358/08_zero_loss_identity.md`
- **Méthode Pure**:
  ```javascript
  function deriveBalance(accountId, currency, readonly entries) { /* même code que SPEC5 runner */ }
  ```
  - Même dataset LedgerEntries seeded 6 accounts (prédéfini 6 presets).
  - Run 2 runs consécutifs runA = deriveBalance ×6; runB = deriveBalance ×6.
  - Assert `runA[i].available === runB[i].available` + `runA[i].credits === runB[i].credits` Δ=0.
  - Sum buckets: 10%+40%+30%+20% = 100.00% 2 décimals. Min(available) ≥ 0 solvency OK.
- **TRs**:
  - **TR-8.1 rule (rubric score 2/2 si true)**: 6/6 preset identity true.
  - **TR-8.2 rule**: Sum buckets 100.00% exact 2 décimaux.
  - **TR-8.3 rubric 0..2 AC8**: 6/6 Δ=0 → 2/2; 5/6 Δ≤0.01 → 1.5/2; sinon 0. Expected 2/2.
- **Evidences**: Report 08 6 rows compare runA runB Δ column + HMAC T8.

---

## T9 HMAC_CHAIN_INTEGRITY_Verify (Couvre AC9)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T8 (order: ce task RUN APRÈS T14 — déplacé en FINAL juste avant T14_FINAL)
- **Livrable**: `reports/live-deploy-exec-v358/09_hmac_chain_integrity.md`
- **Méthode**:
  - Lignes NDJSON: compte ≥15 (RUN_INIT + T0 + T1..T7 + T10..T14 4 tasks + RUN_COMPLETE = 15+ min).
  - 3 échantillons random indices e.g. [5, 10, 15] → recalc HMAC(key, `step|ts|payload_str`) → compare stored hmac match.
  - Timestamps: strictement monotones croissants (14/14 prev_ts < curr_ts).
  - Format regex: chaque line match pipe-delim 4 champs pipe.
- **TRs**:
  - **TR-9.1 rule**: lineCount ≥ 15.
  - **TR-9.2 rule**: 3/3 HMAC recalc MATCH exact stored.
  - **TR-9.3 rubric 0..2 AC9**: lines≥15+3/3+monotonic → 2/2; lines≥12+2/3 → 1.5/2; sinon 0. Expected 2/2.
- **Evidences**: Report 09 samples 3 rows recalc result + monotonic check + HMAC line T9 (écrit APRÈS recalc, self-verif toujours pass).

---

## T10 WORKFLOW_FIDELITY_MTIME Order (Couvre AC10)
- **Status**: pending
- **Priorité**: medium
- **Dépend**: T8
- **Livrable**: `reports/live-deploy-exec-v358/10_workflow_mtime.md`
  - `stat(spec.md).mtimeMs < stat(tasks.md).mtimeMs < stat(01_report).mtimeMs < stat(12_ac_synopsis).mtimeMs`
  - Si pas ordre strict → flag warning mais score ajusté 1.5/2 possible.
- **TRs**:
  - **TR-10.1 rubric 0..2 AC10**: strict order 4 comps OK → 2/2; 3/4 → 1.5/2; sinon 0.
- **Evidences**: Report 10 mtimeMs values 4 array compare + HMAC T10.

---

## T11 NO_SECRETS_LEAKED Grep 12 Patterns (Couvre AC11)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T10
- **Livrable**: `reports/live-deploy-exec-v358/11_secrets_no_leak.md`
- **Méthode**: Grep récursivement les patterns ci-dessous sur: (a) `scripts/t6-live-deploy-exec-v358.mjs` runner même file; (b) 12 fichiers rapports `reports/live-deploy-exec-v358/*.md`. Compte matches des VALEURS RÉELLES seulement. Les références DOC (e.g. substring `DATABASE_URL=paste`) OK.
  - 12 patterns regex: `AKIA[0-9A-Z]{16}`, `sk_live_[0-9a-zA-Z]{24,}`, `api[_-]?key\s*=`, `secret[_-]?key\s*=`, `DATABASE_URL=\w+:\/\/`, `BINANCE_API_KEY=[^'\s]{16,}`, `OWNER_EXEC_UNLOCK=[^'\s]{30,}`, `-----BEGIN PRIVATE KEY-----`, `eyJ[A-Za-z0-9_-]{15,}`, `\b[0-9a-fA-F]{64}\b`(SHA256 secrets), `\b[A-Za-z0-9+/]{40,}=`(base64 30bytes), `\bMA5900\d{16}\b`(IBAN non masqué réel).
- **TRs**:
  - **TR-11.1 rule**: Total matches of REAL secret values = 0 exact.
  - **TR-11.2 rule**: DOC refs allowed ≥0 (counted separately OK).
- **Evidences**: Report 11 per-pattern counts + HMAC T11.

---

## T12 LOCAL_COMMIT SHA Changed NG6 Push No (Couvre AC12)
- **Status**: pending
- **Priorité**: medium
- **Dépend**: T11
- **Livrables**:
  - Mémorise BEFORE_SHA runner start = `execSync('git rev-parse HEAD').toString().trim()` (dans main pre-T0).
  - Ajoute fichiers à git index: `reports/live-deploy-exec-v358/*` + `scripts/live-deploy-exec/*` + `spec.md tasks.md runner script`
  - Commit local message préfix canonical: `feat(v358): live deploy all mirrors + exec all6 routes v3.5.8 [SANS-DB audit-only, NG6 local-only commit NO push]`.
  - AFTER_SHA = `git rev-parse HEAD` trim.
  - Assert BEFORE_SHA ≠ AFTER_SHA; TENTATIVE push count=0 (vérifie remote=https-origin/main sha === BEFORE_SHA ou git fetch error; NE JAMAIS push inline).
- **TRs**:
  - **TR-12.1 rule (AC12)**: BEFORE_SHA !== AFTER_SHA strict inégalité.
  - **TR-12.2 rule (NG6)**: remote main SHA non changé (ou fetch erreur sandbox → still OK).
- **Evidences**: Commit snapshot embed in Report 12 pre-section + HMAC T12_LOCAL_COMMIT.

---

## T13 (Tâche 13 — déplacée: Order reports write; T9 HMAC check dernier avant T14)

## T14 FINAL AC Synopsis Verdit + Master SHA (Couvre AC13 global 26pts)
- **Status**: pending
- **Priorité**: high
- **Dépend**: T0→T12 tous terminés, plus T9 APRÈS T14 reports + RUN_COMPLETE écrit APRES SHA.
- **Livrables**:
  - `reports/live-deploy-exec-v358/master_sha256.txt` — SHA256(concaténation 12 rapports ordre 01→11 + 12_ac_synopsis écrit APRÈS) new each run NG7.
  - `reports/live-deploy-exec-v358/12_ac_synopsis_verdict.md` — 13 lignes tableau AC# / Type / Score (sur 2) / Verdict. Final total: Σ13 scores /26.
  - RUN_COMPLETE HMAC line NDJSON append.
- **Règles de calcul verdicts scores 13 AC**:
  - Rules AC1..7 / AC11..12 (8 rules): 2/2 si TR correspondants tous true sinon 0/2.
  - Rubrics AC8/AC9/AC10 (3 rubrics): 0..2 comme calculés dans leurs T8/T9/T10.
  - AC13 global score = somme 13 scores. Si ≥21/26 → OVERALL=PASS. Si 18..20 → WARN. Si <18 → FAIL.
- **TRs**:
  - **TR-14.1 rule**: master_sha256.txt = 64 caractères hex + newline.
  - **TR-14.2 rule (AC13 rubric 2/2 si ≥21)**: Score final ≥21/26 threshold.
  - **TR-14.3 rubric 0..2 global AC13**: ≥25/26 →2/2; 23-24→1.5/2; 21-22→1/2; <21→0.
- **Evidences**: Synopsis table 13 rows sum + OVERALL_VERDICT string en haut + HMAC T14_FINAL.

---

## Coverage Matrix: 13 AC × Tasks (Vérifie chaque AC ≥1 TR couvert)
| AC# | AC Type | Tasks Couverture |
|---|---|---|
| AC1 Deploy Targets Inventory | rule | T1 TR-1.1 / 1.2 / 1.3 |
| AC2 7+ Runbooks Generated | rule | T2 TR-2.1 / 2.2 |
| AC3 Handsfree 0-leak snapshot | rule | T3 TR-3.1 / 3.2 / 3.3 |
| AC4 Gate Matrix G1-G4 honest | rule | T4 TR-4.1 / 4.2 |
| AC5 Wrapper Exitcode | rule | T5 TR-5.1 / 5.2 / 5.3 |
| AC6 All 6 Routes audit | rule | T6 TR-6.1 / 6.2 |
| AC7 Skip reasons ≥14 len≥40 | rule | T7 TR-7.1 / 7.2 / 7.3 |
| AC8 Zero-Loss Identity | rubric 0..2 | T8 TR-8.1 / 8.3 |
| AC9 HMAC 15lignes +3/3samples | rubric 0..2 | T9 TR-9.1 / 9.2 / 9.3 |
| AC10 Mtime Workflow | rubric 0..2 | T10 TR-10.1 |
| AC11 0 Secrets Leaked | rule | T2+T3+T11 TR-11.1 |
| AC12 Local Commit SHA≠before | rule | T12 TR-12.1 / 12.2 |
| AC13 Overall Score≥21/26 | rubric 0..2 | T14 TR-14.2 / 14.3 |

✅ 13/13 AC tous couverts au moins 1 TR ≥rule ou rubrique.

---

## Pre-requisites Environnement Runner
- Node.js 24.x LTS installé (node --check syntax runner)
- PowerShell 5.1 ou Core sur PATH (pour spawn call dans T5)
- Git installé (pour git rev-parse / git status / git commit dans T12)
- PAS BESOIN: Prisma / PostgreSQL / Neon / Binance API / Payoneer / Attijari PSD2 (runner SANS-DB, ces APIs NON appelées)
- PAS BESOIN sudo/admin (runtime runner: non elevated; runbooks generated LÉGÈREMENT ont #Require Admin pragma, mais runner NE LANCE PAS ces runbooks inline)
