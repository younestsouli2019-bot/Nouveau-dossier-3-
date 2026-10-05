# SPEC MODE #6 — Live Deploy (All Mirrors) + Live Execution (All 6 Routes) v3.5.8
## Objet: Ensure zspace/base44/secure-cloud/4-git-mirrors/vercel ALL deployed; run All 6 OWNER rails via Owner Hands-Free 1-Click; deploy+execute state failclosed honest audit with signatory unblock reserves.
> Trigger user VERBATIM: *"znsure live deploy and execution"* + AskUserChoices confirmés: Deploy=ALL Mirrors + Live Exec; Scope=ALL 6 Routes (Aggressive); Elevation=**Generate Runbooks ONLY Safe Mode (no in-sandbox elevation)**.

---

## 1. Constat Baseline (SP1 Exploration Honnête)

### 1.1 Cibles Deploy Confirmées par User Multi-Select (Scope ALL Mirrors + Live Exec)
| Target Deploy | Mécanisme existant | Prérequis Env/Secrets | Constat Today 2026-10-05 | Honnête Resultat Expected |
|---|---|---|---|---|
| **T1. GitHub https-origin main** | push-outside-sandbox-v358.ps1 Admin PS HORS Trae 6 steps | Git Credential Manager Core, PAT base64 | `.git-credentials` size 209 OK · lock `askpass.sh` CRASH TRAE SANDBOX NG6 connu | ✅ **Runbook Admin HORS GÉNÉRÉ** (NO inline exec) → User manual double-clic |
| **T2. GitLab mirror** | `scripts/mirrors/sync-mirrors.cmd` L23-31 `git push --mirror` | `GITLAB_MIRROR_REPO` + `GITLAB_PAT` (write_repository) | Env absent 0/2 | ❌ **Honnête SKIP** + documented unblock |
| **T3. Codeberg mirror** | `sync-mirrors.cmd` L33-41 `git push --mirror` SSH | `CODEBERG_MIRROR_REPO` + Clé SSH dans ssh-agent | Env absent 0/1 | ❌ SKIP + unblock |
| **T4. Local file backup mirror** | `sync-mirrors.cmd` L43-50 git clone bare dir | `LOCAL_MIRROR_DIR` env (e.g. D:\swarm-doomsday-mirror\repo.git) | Env absent 0/1 | ❌ SKIP + unblock |
| **T5. zspace swarm autonomy** | `.base44-cache/ Base44 RevenueEvents + data/swarm_autonomy/ probe presence directories | swarm/ swarm_autonomy/ probe scripts | `data/swarm_autonomy/logs/` peut ne pas exister avant first-run → mkdir dans runner | ✅ **Created on-demand** |
| **T6. Base44 RevenueEvents L2 cache** | SDK @base44/sdk ^0.8.13 entities Mission/Earning/PayoutRequest | BASE44_APP_ID BASE44_SERVICE_TOKEN env vars | 0/2 env vars set | ❌ SKIP seed dummy fallback entries NG1 read-only |
| **T7. Secure-Cloud Supabase Storage vault** | `scripts/mirrors/secure-cloud-upload.cmd` 2-step: Presigned URL POST + Supabase Storage Object PUT (curl) | SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + MIRROR_SUPABASE_BUCKET + SECURE_CLOUD_PRESIGNED_URL (optional) | 3/3 required env ABSENTS 0/3 | ❌ SKIP honest; Vault généré localement AES-256-GCM PBKDF2 1M itérations SI passphrase set SINON skip vault step |
| **T8. Doomsday Vault local builder** | `scripts/mirrors/backup-doomsday-vault.ps1` tar.gz enc AES-256-GCM PBKDF2 1M → iso-timestamped dir | DOOMSDAY_ARCHIVE_PASSPHRASE env OR `.keys/doomsday-passphrase.txt` file + openssl PATH Git/usr/bin | `.keys/doomsday-passphrase.txt` existence UNKNOWN audit (prochain runner verifie exist) | SKIP si fichier+passphrase absents, EXIT 0 non fail (optionnel) |
| **T9. Vercel Web Frontend Deploy (user multi-select non coché → SCOPE EXCLU)** | `deploy-vercel.yml` GitHub Actions · `vercel pull --prod --token` + `deploy --prebuilt --prod` | VERCEL_TOKEN + VERCEL_TEAM_ID envs | User a explicitement exclu ce scope | ❌ SCOPE EXCLU user choice |

### 1.2 Live Execution Scope Confirmé User: ALL 6 Routes AGGRESSIVE
| OWNER Preset Route ID | Rail Class | Credentials Requis | CONSTAT Today (G1..G4) | Expected Execution Honnête |
|---|---|---|---|---|
| R1. ATTIJARI_RIB182_SALAIRE | Attijari Wafa PSD2 CIB | ATTIJARI_CLIENT_ID + ATTIJARI_CLIENT_SECRET + ATTIJARI_PSD2_CODE + G2 DATABASE_URL len≥120 | 0/4 creds set · G2=FAIL | ❌ SKIP raison+unblock |
| R2. ATTIJARI_RIB372_DETTE CONTENTIEUX 018 | Attijari Wafa PSD2 | Mêmes creds que R1 | Idem R1 | ❌ SKIP |
| R3. BC_LU24_RIB646_SOUVERAIN | Banking Circle SDK SEPA Inst | BC SDK user/pass/endpoint/PSK + G2 DATABASE_URL BIC routing | 0/5 creds set · G2=FAIL | ❌ SKIP |
| R4. BC_LU24_RIB646_OPS | Banking Circle SDK | Mêmes creds que R3 | Idem R3 | ❌ SKIP |
| R5. PAYONEER_B2B_BUFFER | Payoneer B2B OAuth2 | PAYONEER_CLIENT_ID + SECRET + ACCESS_TOKEN + PayPal CIP MA-147672146951995880 CLOSED | 0/3 creds + CIP open | ❌ SKIP |
| R6. **USDC_ARBITRUM_L2_WALLET Route #1** | L2_CRYPTO_DIRECT_CEX via Binance Spot Withdraw Direct Deposit L2 bypass | G3 BINANCE_API_KEY + SECRET (Spot Withdraw scope, len≥32) + G4 OWNER_EXEC_UNLOCK len≥43 + CEX_DIRECT=true + RELEASE_OVERRIDE=60 | 0/5 creds · G3=FAIL G4=FAIL | ✅ **DRY-RUN MATH ELIGIBLE** (mode=failclosed) |

### 1.3 Gate Matrix CONSTAT (G1..G4 2026-10-05 T18:30 UTC)
```
§A MINIMAL UNBLOCK SET 8 ITEMS REQUIRED POUR PASS G1:
  .swarm/owner-hands-free.config.ps1 §A lines 21..54: ALL 36 = empty 0/36
G1 ≥8 secrets injected: 🔴 FAIL 0<8
G2 DATABASE_URL Neon PROD pooled len≥120: 🔴 FAIL len=0
G3 BINANCE Spot Withdraw KEY+SECRET len≥32 chacun: 🔴 FAIL len=0 chacun
G4 OWNER_EXEC_UNLOCK len≥43: 🔴 FAIL len=0
→ ALL_GATES_CLOSED=True → wrapper EXIT 5 FAIL_CLOSED NOOP avant 0 rail réel (FAILSAFE).
```

### 1.4 Mode Élévation Confirmé User: Generate Runbooks ONLY (SAFE)
- ❌ **INTERDIT**: `Start-Process -Verb RunAs` à l'intérieur Trae sandbox (UAC isolé, échec 100% attendu + violation NG6).
- ✅ **AUTORISÉ**: Génération autonome de fichiers `.cmd` + `.ps1` runbooks (with `#Requires -RunAsAdministrator` pragma + `cacls.exe` elevation check au début) stockés dans `scripts/live-deploy-exec/`. User double-clique manuellement `LIVE-DEPLOY-EXEC-1-CLICK.cmd`.

---

## 2. Objectifs Fonctionnels
1. **O1 Deploy All Mirrors (T1..T8)**: Générer 1-Click runbook admin pour chaque cible + documenter SKIP raison + unblock condition pour chaque cible avec env manquant.
2. **O2 Live Exec All 6 Routes Aggressive**: Call `scripts\START-OWNER-HANDS-FREE.cmd` via `powershell -ExecutionPolicy Bypass` (NON elevated, mode normal) capturer LASTEXITCODE. Honnête audit result (semble EXIT 5 failclosed, 0 rails exécutés).
3. **O3 Fail-Closed Honest Audit**: Pour chaque route R1..R6 + chaque deploy T1..T8, documenter statut avec ≥30 chars SKIP reason, jamais silencieux FALSE.
4. **O4 ZERO Fabrication NG2 + ZERO Git Push Sandbox NG6**: 0 fichiers créés `out/received/` `exports/bank-wire/`; 0 `git push` dans runner.
5. **O5 SANS-DB 0 deps**: Runner standalone imports node:fs/crypto/path/child_process ONLY, 0 prisma/pg/ethers/ccxt.
6. **O6 HMAC Integrity Chain**: NDJSON append-only ≥15 lignes, 3/3 échantillons recalc MATCH, timestamps monotones.
7. **O7 Zero-Loss Identity Guarantee AC7**: `deriveBalance` 2x runs dataset identique Δ=0 sur 6 presets.
8. **O8 0 Secrets Leaked AC10**: Grep 12 forbidden patterns runner + 12 rapports = 0 matches valeurs réelles.
9. **O9 Master SHA 256**: SHA(concat 01→12 rapports ordre canonic) écrit `master_sha256.txt` + 13-AC synopsis verdict table.
10. **O10 5 Réserves Signataire Documentées**: R1..R5 prioritaires, avec unblock steps verbatim.

---

## 3. Architecture: Runner Standalone 0 deps SANS-DB + Admin Runbook Gen
```
scripts/t6-live-deploy-exec-v358.mjs
  └ imports ONLY node:fs / node:crypto / node:path / node:url / node:child_process
  └ RUN_INIT / T0_DIR_SANITY / T0_BOOTSTRAP (HMAC key = UNLOCK env≥43 sinon DUMMY)
  └ T1 DEPLOY GITHUB runbook gen scripts/live-deploy-exec/DEPLOY-01-GITHUB-HORS.cmd
  └ T2 DEPLOY GITLAB runbook gen + HONEST SKIP doc + unblock env
  └ T3 DEPLOY CODEBERG runbook + SKIP
  └ T4 DEPLOY LOCAL MIRROR runbook + SKIP
  └ T5 zspace swarm autonomy dirs create mkdir -p
  └ T6 Base44 RevenueEvents fallback seed JSON (NG1 read-only no SDK call)
  └ T7 DOOMSDAY VAULT runbook + SKIP honest si .keys/doomsday-passphrase.txt absent
  └ T8 SECURE-CLOUD SUPABASE runbook + SKIP (3 env manquants)
  └ T9 1-CLICK AGGREGATOR LIVE RUNBOOK GEN: scripts/live-deploy-exec/LIVE-DEPLOY-EXEC-1-CLICK.cmd
  └ T10 LIVE EXEC Owner Hands-Free Wrapper (NON elevated normal PS scope) capture LASTEXITCODE
  └ T11 Fail-Closed Honest 6-Route Status Audit (R1..R6 status)
  └ T12 Pure deriveBalance ×2 Zero-Loss Identity
  └ T13 HMAC Chain Verification (15+ lignes / 3/3 samples)
  └ T14 FINAL SHA256 + 13-AC SYNOPSIS
  └ RUN_COMPLETE HMAC line append
```

### Rapports produits dans `reports/live-deploy-exec-v358/` (ordre canonic 01→12):
01_deploy_targets_status.md · 02_deploy_runbooks_generated.md · 03_handsfree_config_snapshot.md · 04_gate_matrix_live.md · 05_live_exec_wrapper_exitcode.md · 06_all6_routes_exec_audit.md · 07_failclosed_skip_reasons.md · 08_zero_loss_identity.md · 09_hmac_chain_integrity.md · 10_workflow_mtime.md · 11_secrets_no_leak.md · 12_ac_synopsis_verdict.md + master_sha256.txt

### Runbooks générés dans `scripts/live-deploy-exec/` (1-Click ready for signatory manual double-clic):
DEPLOY-01-GITHUB-HORS.cmd · DEPLOY-02-GITLAB.cmd · DEPLOY-03-CODEBERG.cmd · DEPLOY-04-LOCAL-MIRROR.cmd · DEPLOY-07-DOOMSDAY-VAULT.ps1 · DEPLOY-08-SECURE-CLOUD.cmd · **LIVE-DEPLOY-EXEC-1-CLICK.cmd** (master ordonné 1→8)

---

## 4. 13 Critères d'Acceptation (AC)
| AC # | Type | Règle / Rubrique | Niveau |
|---|---|---|---|
| AC1 Deploy Targets Inventory | rule | Rapport 01: 9 targets T1..T9 rows × 4 cols (target/mécanisme/prérequis/status). SKIP cells ≥40 chars reason. T1=runbook_generated, T2..T4/T6/T7/T8=SKIP unblock, T5=dirs_created, T9=SCOPE_EXCLUDED_user | Must |
| AC2 Runbooks Generated 6+ files | rule | Rapport 02: `scripts/live-deploy-exec/` count non-gitkeep files ≥ 7 (01..04 + 07 + 08 + 1-CLICK.cmd). LIVE-DEPLOY-EXEC-1-CLICK.cmd contains ALL targets order 01→08. | Must |
| AC3 Hands-Free Config Placeholder Snapshot (0 Leak) | rule | Rapport 03: §A 8 minimal keys = ALL empty documented; uses `maskSecret` prefix4…suffix2 len function; 0 real values; .swarm/* never committed. | Must |
| AC4 Gate Matrix G1-G4 Honest Audit | rule | Rapport 04: G1..G4 4 rows × cols id/desc/status/detail. ALL status=FAIL; detail strings ≥50 chars explanation exact secret manquant + len attendue. | Must |
| AC5 Live Exec Wrapper LASTEXITCODE Captured Honnête | rule | Rapport 05: Exitcode = 5 attendu (FAIL_CLOSED ≤8 secrets §A placeholder); stdout/err lines 1-16 printed with maskSecret. If user already pasted 8 secrets, exit=99 possible (G2 DB auth fail expected). 0 crash UAC. | Must |
| AC6 All 6 Routes Exec Audit R1..R6 | rule | Rapport 06: 6 rows preset_id / rail_class / creds_missing_count / status. Row 6 R6 Status = DRY_RUN_MATH_ELIGIBLE (held 63.67 ≥ 60); 5 autres = SKIP creds_missing_count ≥ 3. | Must |
| AC7 Fail-Closed Skip Reasons ≥30 chars (100% Coverage) | rule | Rapport 07: Count ≥14 SKIP cells all with string length ≥40 chars; 0 empty FALSE. No silent "❌". | Must |
| AC8 Zero-Loss Rubric (0..2) | rubric threshold ≥1.5/2 | deriveBalance 2× runs all 6 presets: identity Δ=0 → 2/2; 4/6 Δ≤0.01 → 1.5/2; sinon 0. Expected 2/2. | Should |
| AC9 HMAC Chain Rubric (0..2) | rubric threshold ≥1.5/2 | NDJSON ≥15 lines + 3/3 samples recalc MATCH → 2/2; 12 lines + 2/3 → 1.5/2; else 0. Expected 2/2. | Should |
| AC10 Workflow Fidelity Rubric (0..2) | rubric threshold ≥1.5/2 | `mtime(spec.md) < mtime(tasks.md) < mtime(01_report.md) < mtime(12_ac_synopsis.md)` strict → 2/2; 1 out-of-order → 1.5/2; else 0. Expected 2/2. | Should |
| AC11 0 Secrets Leaked Runner+Reports | rule | Grep patterns: AKIA.*16 / sk_live.* / api[_-]?key / secret[_-]?key / DATABASE_URL= / BINANCE_API_KEY= / OWNER_EXEC_UNLOCK= / BEGIN PRIVATE / eyJ[A-Za-z0-9_-]{15,} → across runner mjs + 12 rapports → 0 matches REAL secret values (doc refs OK). | Must |
| AC12 Local Commit SHA Changed (NG6 push NO) | rule | BEFORE_SHA (runner start) ≠ AFTER_SHA (runner end). NO git push executed (verified remote unchanged == BEFORE_SHA OR error). | Must |
| AC13 Overall 13-AC Score ≥21/26 | rubric threshold ≥21/26 | Sum of 13 scores (7 rules ×2 + 6 rubrics ×2) = 26 total. Threshold pass ≥21/26 (≈80%). Expected 26/26 or 24/26. | Must |

---

## 5. NFR (9) + NG (7) Global Binding
**NFR 1-9**: Node 24.x LTS / 0 external deps / runtime <120s / idempotent re-run / Windows PS 5.1 compat / maskSecret NFR / 0 secrets in rapports / mkdir recursive auto / ASCII/BOM UTF-8 for PS1/cmd files.
**NG 1-7 Permanent**: NG1 0 write DB. NG2 0 fabrication preuves/PO. NG3 0 huissier comms. NG4 0 prisma schema modifs. NG5 0 $ decomposition hors pure deriveBalance. NG6 0 git push sandbox (runbook HORS only). NG7 0 stale Master SHA reuse, fresh each run.

---

## 6. 5 Réserves Signataire Anticipées SP5 (R1..R5 Priorité)
| # | Gravité | Réserve | Unblock Exact Steps |
|---|---|---|---|
| **R1 🔴 P0 CRYPTO LIVE GATES UNBLOCK** | G1-G4 TOUJOURS FERMÉS → 0 rail réel exécuté. Live exec wrapper exit=5 NOOP 0 payout. | Signataire OUVRE `.swarm/owner-hands-free.config.ps1` dans éditeur §A 8 lignes COLLER VALEURS EXACTES: `DATABASE_URL=paste Neon pooled len≥120`; `LIVE_BANK_API='true'`; `BINANCE_API_KEY=paste len≥32 Spot Withdraw scope IP whitelist 45.155.*`; `BINANCE_API_SECRET=paste pair len≥32`; `CEX_DIRECT_DEPOSIT_ENABLED='true'`; `RELEASE_AMOUNT_OVERRIDE_USD='60'`; `OWNER_EXEC_UNLOCK=paste openssl rand -base64 40 → len≥43`; `OWNER_HANDS_FREE_POLICY='true'`. SAUVEGARDER. PUIS double-clique `scripts\START-OWNER-HANDS-FREE.cmd` → Admin UAC YES. Result: G1..G4 PASS → Route 6 R6 60 USDC envoyée wallet L2 réellement (LASTEXITCODE=0 withdrawId Binance réel). |
| **R2 🟠 P1 GIT PUSH NG6 HORS TRAE ADMIN PS** | Commit runner + rapports seulement LOCAL; push GitHub + 3 autres mirrors NON exécutés sandbox. | Signataire CLOSE Trae ALL windows. Ouvre PowerShell **ADMINISTRATEUR**. cd repo. RUN: `powershell -ExecutionPolicy Bypass -NoProfile -File scripts\push-outside-sandbox-v358.ps1 -Verbose` → 6 steps manager-core + fetch + rebase ours -X + --force-with-lease + SHA verify egalite. Result: LOCAL_SHA = https-origin/main SHA. Puis run `scripts/mirrors/sync-mirrors.cmd` for mirrors 2-4. |
| **R3 🟠 P2 MIRROR ENVS (GitLab/Codeberg/Local/Doomsday/Supabase)** | T2..T4 T6 T7 T8 tous SKIP car envs absents. | Signataire DÉFINIR ENVs USER + MACHINE permanentes: [System.Environment]::SetEnvironmentVariable('GITLAB_MIRROR_REPO','https://gitlab.com/....git','User') · Set GITLAB_PAT scope write_repository+read · CODEBERG_MIRROR_REPO ssh://git@codeberg.org/... · LOCAL_MIRROR_DIR=D:\swarm-doomsday-mirror\repo.git · DOOMSDAY_ARCHIVE_PASSPHRASE=48+ chars random · SUPABASE_URL=https://xxx.supabase.co · SUPABASE_SERVICE_ROLE_KEY=eyJhbGci... len≥80 · MIRROR_SUPABASE_BUCKET=swarm-doomsday-vault · BASE44_APP_ID + BASE44_SERVICE_TOKEN. Puis re-run LIVE-DEPLOY-EXEC-1-CLICK.cmd → tous 8 deploy SKIP → EXEC success. |
| **R4 🟡 P3 PO DELIVERY 0 PODS NG2 PHONE RULE** | 3 PO EN TRANSIT permanent tant que PODs physiques. | Attente livraisons physiques → Créer fichiers EXACT dans `out/received/`: `POD:JUMIA_LOGISTICS-sha256:<64hex>.json` · `POD:ARAMEX-sha256:<64hex>.json` contenu: poNumber + carrierTracking + deliveredAt ISO + signatureBase64 + deliveredByName. Re-run audit runner T6 → 3 POs flip DELIVERED proof_confirmed. |
| **R5 🔴 P4 PAYPAL CIP + CLASS B RIB STRUCTURAL** | R5 Payoneer SKIP cause CIP case ouvert; settlement RIB182 cle=82 vs 80 non corrigé. | a) PayPal CIP close dossier CIP-MA-147672146951995880 → OAuth2 PPP2 GetToken success 200 → rail Payoneer prêt. b) Approbation signataire manuscrite correction Class-B settlement-worklist.mjs L87 cle 82→80 mod97 recalc + L89 cle recalc + 4 IBAN mock corrigés payment-routing-table L130. Re-run preset accuracy audit mod97 checksum PASS 100%. |

---

## 7. Signataire HowTo 3 Étapes Live Deploy+Exec Today
```
ÉTAPE 1/3: GÉNÉRATION RUNBOOKS (DÉJÀ FAIT — ce runner)
  → scripts/live-deploy-exec/ contient 7 fichiers runbooks admin + 1-CLICK master.
ÉTAPE 2/3: DÉPLOIEMENT MIRRORS ALL TARGETS
  → Double-clique scripts/live-deploy-exec/LIVE-DEPLOY-EXEC-1-CLICK.cmd (Run As Administrateur → UAC YES)
  → Suite: T1 GitHub push HORS → T2 GitLab → T3 Codeberg → T4 local dir → T7 Doomsday → T8 SecureCloud
ÉTAPE 3/3: EXÉCUTION LIVE RAILS
  → Si R1 (8 secrets) déjà filled: étape 2 fin lance auto START-OWNER-HANDS-FREE → exec All 6 rails
  → Si R1 pas rempli: wrapper exit=5 FAIL_CLOSED NOOP honnête. Collez 8 valeurs + re-run étape 2.
```
