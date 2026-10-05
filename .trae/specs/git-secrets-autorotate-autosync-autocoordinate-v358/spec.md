# Git Secrets AutoRotate + AutoSync + AutoCoordinate v3.5.8 — Product Requirements Document (SECURITY-CLASS)

## Overview
- **Summary**: Standalone SANS-DB 0-deps local custom KMS (zero external third-party vault dependency) for: (1) autorotate UNBLOCK8 minimal keys + GitHub PAT, (2) autosync 5-target bidirectional broadcast, (3) autocoordinate multi-instance safe rotation races. 100% node core crypto + Windows DPAPI machine-bound (no hacks news cross-machine exposure). Runner: `t7-git-secrets-autorotate-v358.mjs` (node core imports fs/crypto/path/url/child_process ONLY ≤ 900L). Pre-flight hook: `scripts/autorotate-pre-wrapper.ps1` runs BEFORE `start-owner-hands-free.ps1` on each wrapper 1-CLICK start.
- **Purpose**: User answer VERBATIM Q1: "many hacks have occured in these password vaults, see news and articles, design secure solutions or see repo" → explicit REJECT Windows CredMan / 1Password op CLI / Hashicorp Vault / Doppler. Zero external vault dependency. Local-only custom KMS.
- **Target Users**: Signataire Younes Tsouli CIN A337773 only. Bootstrap 1× ONE MASTER_SEED paste only. 0 keyboard input forever after.

---

## Goals
1. **AutoRotate**: Refresh UNBLOCK8 key material deterministically via HKDF on-demand (pre-wrapper 1-CLICK) + manual `--rotate=now`. GitHub PAT auto rotate via GitHub REST API 8 rotations/90d default. Rotations NEVER partial write (atomic rename + HMAC sign).
2. **AutoSync**: 5 bidirectional sync targets (per Q4 user ALL-4 selected): (a) KMS Lockbox AES file → (b) .swarm/owner-hands-free.config.ps1 §A hashtable → (c) PowerShell `$env:Process` scope (User ONLY NEVER Machine) → (d) Windows DPAPI machine-bound roamed keys → (e) Git credential.helper=store .git-credentials file PAT auto sync. Bidirectional: lockbox ↔ §A, all pull from lockbox authoritative.
3. **AutoCoordinate**: Multi-instance safe rotation races. HMAC-signed advisory file lock (`.keys/autorotate.lock` + ttl 120s monotonic). Second concurrent rotate → FAIL-CLOSED WAIT TTL → exit 3 SKIP with explicit reason. Rotation version counter monotonic `rotate_version` + key_id in HMAC chain.
4. **Integrity**: HMAC append-only chain 18+ lines (rotate_init → t1..t13 → rotate_complete). 3/3 random samples recalc MATCH. Monotonic timestamps.
5. **Fail-Closed**: 0 value EVER written to git repo. .keys/** + .swarm/** in .gitignore. All unmasked values in memory zeroized (Buffer.fill(0)) after use < 10s lifetime.

---

## Non-Goals (Explicit out of scope FAIL if implemented)
- ❌ **NO external KMS / vault dependency EVER** (CredMan, 1P, Vault, Doppler, Infisical, Azure KeyVault, AWS KMS — ALL FORBIDDEN permanent).
- ❌ **NO 36-key full scope** per Q2 user answer = 8 MINIMAL UNBLOCK ONLY. Extend 36 requires explicit signataire written approval new spec.
- ❌ **NO time-based scheduled task / cron** per Q3 = on-demand + pre-wrapper-startup ONLY. schtasks.exe forbidden (adds external state).
- ❌ **NO TPM 2.0** (Q5 default one-time paste MASTER_SEED, not absolute zero). TPM requires hardware. Fail-closed skip.
- ❌ **NO secrets committed to git repo** (any file / any commit). 0 leak tolerance class A.
- ❌ **NO Machine scope env var permanent writes** (broadcast target 5 scope user answer Q4). Only Process scope temporary per wrapper session.
- ❌ **NO Push inline GitHub (NG6)**. PAT rotate writes .git-credentials LOCAL only. Never git push command autorotate runner.

---

## Background & Context (Constat)
### 4.1 User Answers Spécification
| Q# | Réponse Utilisateur VERBATIM | Interprétation / Auto-Résolution |
|---|---|---|
| Q1 KMS Provider | `"many hacks have occured in these password vaults, see news and articles, design secure solutions or see repo"` | **0 external vault.** Custom KMS: local AES-256-GCM-PBKDF2 lockbox + DPAPI CryptProtectData machine-bound master_seed (non exportable cross-host). |
| Q2 Scope Keys | `8 MINIMAL UNBLOCK ONLY` | Exact set UNBLOCK8 L69-72 [owner-hands-free.config.ps1](file:///C:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/.swarm/owner-hands-free.config.ps1#L69-L72) = DATABASE_URL · LIVE_BANK_API · BINANCE_API_KEY · BINANCE_API_SECRET · OWNER_EXEC_UNLOCK · OWNER_HANDS_FREE_POLICY · CEX_DIRECT_DEPOSIT_ENABLED · RELEASE_AMOUNT_OVERRIDE_USD → plus bonus GitHub PAT (`.git-credentials`) auto rotate. |
| Q3 Cadence | `On-demand + wrapper startup` | Pre-flight `autorotate-pre-wrapper.ps1` runs BEFORE `start-owner-hands-free.ps1` each 1-CLICK. Runner CLI: `node t7... --rotate=now` manual. Idempotent: if `rotate_age < 1440 minutes` → SKIP with documented reason. |
| Q4 Sync Direction | ALL 4 selected = KMS→§A+env + Bidirectional + Broadcast 5-targets + PAT rotate | Sync 5 cibles: (1) Lockbox AES authoritative, (2) §A hashtable, (3) Process $env, (4) DPAPI roaming, (5) .git-credentials PAT. Bidirectional lockbox ↔ §A for recovery scenario (lockbox lost restore from §A). |
| Q5 Zero Input | `One-time paste MASTER_SEED only (Recommended)` | Signataire paste 1× MASTER_SEED_UNLOCK ≥64 chars high entropy → encrypted with DPAPI CryptProtectData (machine+user bound) → save `.keys/_seed.dpapi` (gitignored). Subkeys derived HKDF-SHA256(info=UNBLOCK8[i]) deterministic. 0 char paste forever after. |

### 4.2 Existing Infrastructure Repo Verified Today
- `.gitignore` L57 `.swarm/**` + L32 `doomsday-vault/` → need add `.keys/**` exclusion L33.
- `.gitleaks.toml` useDefault=true → custom rule forbid 8 UNBLOCK patterns added fail-closed pre-commit.
- `.git/config credential.helper=store` → `.git/credentials` OR `C:\Users\Dell\.git-credentials` size=209 bytes base64 PAT (permanent NG6 push HORS).
- Existing owner-hands-free hashtable 36-key schema §A + UNBLOCK8 expected order list L69.
- Node24 LTS + crypto.subtle + AES-GCM native. PowerShell 5.1 `System.Security.Cryptography.ProtectedData` (DPAPI class natively available without install).

---

## Functional Requirements (FR1 → FR12)
- **FR-1 DPAPI Master Seed Locker (Bootstrap 1× only)**. Signataire paste 1× MASTER_SEED_UNLOCK (≥64 chars entropy) → `New-Object System.Security.Cryptography.ProtectedData.Protect(user+machine scope, optionalEntropy='v358-swarm-kms')` → base64 save `.keys/_seed.dpapi` (UTF-8 BOM). Bootstrap validates: `len(seed_plain)>=64` + entropy≥4.0 bits per char Shannon estimate. Failclosed exit 2 if bootstrap fails.
- **FR-2 HKDF Subkey Derivation Engine (Deterministic Pure)**. `kdf(master, salt=sha256(machine+dnsDomainName), info=UNBLOCK8[i]) → subkey 256-bit`. 8 deterministic outputs → mapped 1:1 UNBLOCK8 order: idx0=DATABASE_URL(len122 generator Neon format placeholder), idx2+3 BINANCE len≥32 alnum, idx4 UNLOCK len≥43 base58, idx1/5/6 booleans true, idx7 numeric 60.
- **FR-3 AutoRotate Atomic Write + Version Counter**. Rotation command writes candidate values to `TMP_<pid>_<random6>.lockbox.tmp` → HMAC-SHA256 signature over (rotate_version || iso_ts || all8_values_hash) → signature append EOF `|HMAC=<64hex>` → fs.rename() atomic POSIX semantic NTFS → final `autorotate.lockbox.enc`. Rotate version counter monotonic (never decrease). Pre-rotate backup copy `autorotate.lockbox.enc.bak-<version>` keep last 6 backups.
- **FR-4 Multi-instance Coordination Advisory Lock (Race-free)**. Before rotate: open exclusive `.keys/autorotate.lock` O_CREAT|O_EXCL mode 0o600 → write `pid=<pid>|iso=<isoTS>|ttl=120|owner=HMAC(ts+pid,unlock)` → chmod readonly. Concurrent 2nd instance → EEXIST → stat mtime → if `< ttl120s` → exit 3 SKIP documented reason. If expired → rm stale lock → new owner. After rotate complete: rm lock.
- **FR-5 Sync Bidirectional Lockbox ↔ §A hashtable**. Sync direction decided by HMAC signature timestamp newer: (a) If lockbox HMAC_date > §A hashtable last_write → pull lockbox values overwrite §A (single-quote replace preserve hashtable syntax). (b) If §A hashtable HMAC_date newer → push §A values into new lockbox rotate write_new auto rotate_version++. Case (c) Both empty → bootstrap failclosed require MASTER_SEED paste 1×.
- **FR-6 Sync Process Env Injection (User Scope ONLY)**. Autorotate-pre-wrapper.ps1 after rotate/pull: `[Environment]::SetEnvironmentVariable(k, v, 'Process')` × UNBLOCK8. NEVER 'User' or 'Machine' permanent env set (NFR). Verify after injection with gci env:KEY match expected len.
- **FR-7 Sync DPAPI Roaming Cache per Key 8+1**. Each subkey value additionally DPAPI-protected individual file `.keys/rotate/key_<UNBLOCK8[i]>.dpapi`. Use fast cache on restart (no HKDF re-derive) if rotate_version match. Delete all DPAPI cache files when rotate_version++ occurs → stale invalidation.
- **FR-8 GitHub PAT AutoRotate via REST API**. PAT auto rotate: read current `C:\Users\Dell\.git-credentials` base64 decode → PAT token classic → POST https://api.github.com/authorizations/cli/<token-id> Authorization: Bearer old body {"scopes":["repo","read:org"]} → get new PAT → rewrite base64 `.git-credentials` atomically (write_tmp → rename). Update `.keys/rotate/key_GITHUB_PAT.dpapi`. If call fails network → SKIP with documented 40char+ reason, 0 break UNBLOCK8 rotations.
- **FR-9 Idempotency Skip When Rotate Age Fresh**. Pre-wrapper: read lockbox rotate_version ISO date → diff now_minutes - rotate_minutes = age. If age < 1440 min (24h default configurable via flag --min-age-minutes) → exit 0 SKIP "rotate fresh age=Xmin threshold=1440". Idempotency key `IDEM-ROTATE-YYYYMMDD` day granular.
- **FR-10 HMAC Chain Integrity Append-only NDJSON**. Log file: `data/out/git-secrets-autorotate-v358.ndjson` (gitignored data/out prefix ok). Lines: ROTATE_INIT + FR1_BOOTSTRAP_SANITY + T1..T8 per functional req + ROTATE_COMPLETE = minimum 13 lines (plus up to 5 backup copy lines + 3 sync lines = ≥17 NDJSON lines). 3 random samples indices [3,9,15] recalc → digest MATCH stored HMAC column. Monotonic timestamp check (each next line ts_iso ≥ previous).
- **FR-11 Zeroization After Use (Memory Zero)**. All Buffer variables containing plaintext values (master_seed, 8 subkey_vals, PAT_string): after sync complete → explicit `buf.fill(0x00)` zeroize. Variable lifetime ≤ 10 seconds from generate → zeroize. Explicit counter variable zeroized_key_count after sync=8+1 counts match reported.
- **FR-12 Pre-Commit Gitleaks Verify Gate (Prevent Leak)**. Runner finish → spawn `gitleaks detect --no-git -v --redact --config .gitleaks.toml --path=.keys,.swarm` → any non-zero exit → autorotate runner exit=4 LEAK DETECTED → report which file + pattern → ALL recent writes rolled back to .bak-<prev_version> auto.

---

## Non-Functional Requirements (NFR-1 → NFR-9)
- **NFR-1 Idempotent**: Same input state (same seed + same rotate_version + same §A) → re-run runner produces identical outputs, no writes, exit code 0 SKIP IDENTICAL. Runtime ≤ 8 seconds end-to-end (Node24 core-only + 1 PS DPAPI subprocess ≤ 1s).
- **NFR-2 Platform**: Windows 10+ only (DPAPI machine-bound). Tested PS 5.1 $PSVersionTable.PSVersion.Major -ge 5. Node version ≥24 LTS pinned .nvmrc. Failclosed skip if detected Linux/macOS.
- **NFR-3 Standalone SANS-DB 0 deps**: Runner imports ONLY node:fs/crypto/path/url/child_process. package.json no new dependencies. 0 npm install. Prisma/pg/ethers/ccxt FORBIDDEN.
- **NFR-4 Encryption**: AES-256-GCM Authenticated Encryption with Associated Data (AEAD). PBKDF2-HMAC-SHA512 iterations 1,200,000 (OWASP 2025 minimums). Salt 32 random bytes stored prefix file. Nonce 12 bytes AES-GCM per encrypt, NEVER reuse counter monotonic xor with pid.
- **NFR-5 Encoding UTF-8 BOM for PS1 files**. §A owner-handsfree.config.ps1 preserves #Requires -RunAsAdministrator BOM (FR-5 sync writes Set-Content -Encoding UTF8 with BOM). .keys/_seed.dpapi base64 UTF-8.
- **NFR-6 File Permissions (ACL)**. `.keys/**` cacls.exe set inherited ACL deny Everyone Read EXCEPT current user + Admin (cacls.exe .keys /E /R Everyone /T). Mode 0o600 POSIX NTFS explicit (icacls).
- **NFR-7 No stdout/stderr plaintext values EVER**. maskSecret(first4+...+last2 pattern) EXACT same as owner-handsfree companion. Unmasked 0 lines. stdout log EXAMPLE: `[INFO] rotate v7 keys BINANCE_KEY=x0v3...f2 len=64 ✅`.
- **NFR-8 Error Handling Fail-Closed Exit Codes Enumerated**: exit0=PASS rotate_ok|skip_fresh, exit2=BOOTSTRAP_MISSING_SEED, exit3=LOCK_TTL_BUSY, exit4=GITLEAKS_LEAK_DETECTED(rollback), exit5=ROTATE_ATOMIC_RENAME_FAIL, exit6=SYNC_DIR_CONFLICT(hash_mismatch). All ≥2 considered FAIL NO changes persisted (rollback to prev backup before exit).
- **NFR-9 Backward Compat**: Existing 1-CLICK wrappers untouched. Autorotate-pre-wrapper.ps1 added as NEW FIRST-STEP inside existing companion start-owner-hands-free.ps1 L?? after #Requires → prepend dot-source (failclosed if autorotate fail companion abort early).

---

## Constraints
- **Technical C1**: Master seed bound BOTH machine SID + user SID via DPAPI (DataProtectionScope.CurrentUser with optionalEntropy='v358-swarm-kms' + 2nd machine SID hash appended). Seed decrypted FAILS on DIFFERENT machine = intentional cross-host leak prevention (non-exportable).
- **Technical C2**: Rotation NEVER creates DATABASE_URL Neon "real" connection string (since Neon actual pooled URL len≈122 real only obtainable from Neon console - HKDF generate placeholder valid format only). Signataire MUST paste 1× real Neon URL INTO lockbox VIA SEED OPTIONAL: --override=DATABASE_URL=<real> (stored encrypted same lockbox).
- **Technical C3**: Binance actual API KEY/SECRET (Spot Withdraw scoped) MUST be imported once via `--import=BINANCE_API_KEY=<actual>` bootstrap flag encrypted lockbox. HKDF placeholder values are recognized as LEN_VALID_ONLY but NOT API functional — pre-wrapper reports G3 with explicit flag note: "placeholder HKDF not real Binance; use --import to inject live".
- **Business C4 NG2 ZERO FABRICATION**: Never write "fake success" to reports. If G2/G3 keys = placeholder HKDF (not real imported via --override/--import) → wrapper report line: `⚠️ DATABASE_URL = HKDF_PLACEHOLDER_IMPORT_REQUIRED len=122 format valid; signataire use --override=<real Neon pooled> to inject live` → honest documentation.
- **Dependencies C5**: 0 software install required. ONLY: (a) PowerShell 5.1 preinstalled Windows (b) Node24 LTS (already project pin) (c) git.exe credential.helper=store (already repo config). No winget/choco/scoop installs forbidden.
- **Permanent NG Doctrine Existing**: ALL existing NG1..7 + NFR1..9 from previous SPEC Modes FULLY APPLICABLE. Add NG8=0 external vault, NG9=0 plaintext leftover memory.

---

## Assumptions (Auto-Résolues Q1..5 utilisateur)
- A1: Signataire effectue UNE ET UNE SEULE FOIS le paste MASTER_SEED ≥64 chars. Bot jamais accès vault humain.
- A2: GitHub PAT available dans `.git-credentials` today (confirmé 209 bytes base64 OK per summary).
- A3: Unlock keys importées override via `--import` flags are REAL, LEN valid, API functional (Neon pooled, Binance scoped Spot Withdraw IP whitelist OK). Bot NEVER tests API connectivity during rotation (fail-closed offline only); tests happen during wrapper downstream run-live-crypto-po.ps1 only.
- A4: Disk NTFS supports atomic rename (confirmed Windows default). 0 network rotation operations except FR-8 GitHub PAT optional (skippable network down with 40char reason documented).

---

## Acceptance Criteria (PASS THRESHOLD = 21 / 26 points; 13 AC × rules=2pts rubrics=scale0..2)

### AC-1: DPAPI Bootstrap 1× Encrypted Seed
- **Type**: `rule`
- **Given**: Bootstrap signataire paste MASTER_SEED ≥64 chars Shannon entropy ≥3.5
- **When**: Runner calls DPAPI Protect → writes `.keys/_seed.dpapi`
- **Then**: Decrypt reverse Unprotect operation roundtrip (compare sha256 plain) matches
- **Pass Condition**: seed_roundtrip_sha256=original_sha256 AND file_exists=yes AND ACL: Everyone DENY Read icacls output substring "Everyone:(DENY)(R)"
- **Evidence**: Runner stdout AC1=2/2 + 01_bootstrap_seed_report.md sha256 equality + icacls substring.

### AC-2: HKDF 8 Deterministic Subkeys Correct Lengths per UNBLOCK8 Spec
- **Type**: `rule`
- **Given**: Seed + salt fixed test vector VECTOR_KDF_TEST = seed="0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF" salt=sha256("v358-test-vector")
- **When**: Runner internal `deriveAll8()` function called
- **Then**: idx0 DATABASE_URL.len ∈ [120,124], idx2 BINANCE_KEY.len≥32, idx4 UNLOCK.len≥43, idx1/5/6 == "true", idx7 == "60"
- **Pass Condition**: All 8 lengths/ranges exact match + booleans/numeric exact match VECTOR_KDF_TEST expected published appendix A
- **Evidence**: Runner stdout AC2=2/2 + 02_hkdf_vector.md table 8 rows length exact.

### AC-3: Rotation Atomic Write + HMAC Signature Verify
- **Type**: `rule`
- **Given**: Clean run 0 existing lockbox
- **When**: Runner --rotate=now
- **Then**: autorotate.lockbox.enc exists; first bytes prefix=V358|salt32|nonce12; final line `|HMAC=<64hex>`; HMAC recalc over bytes minus tail=HMAC value → sha256(ciphertext_body+salt+version) == expected HMAC. Previous .bak-1 version file exists.
- **Pass Condition**: HMAC_recalc==stored AND bak_count≥1 AND (fs.stat tmp_count==0)
- **Evidence**: Runner stdout AC3=2/2 + 03_rotate_integrity.md HMAC hex equality.

### AC-4: Coordination Advisory Lock Prevents Concurrent Race
- **Type**: `rule`
- **Given**: Long rotate simulation with TTL=10s (runner flag --ttl=10 for test)
- **When**: Instance1 holds lock; Instance2 starts before ttl
- **Then**: Instance2 exitcode=3 "LOCK_TTL_BUSY seconds_remaining=X"
- **Pass Condition**: Instance exitcode EXACT 3 AND stdout contains ≥ 40char reason substring "concurrent rotate detected lock owner pid="
- **Evidence**: 04_lock_race.md 2 spawn logs + exitcode capture.

### AC-5: Bidirectional Sync §A ↔ Lockbox Correct Values Order
- **Type**: `rule`
- **Given**: §A hashtable all8 empty; lockbox has values; compare HMAC.
- **When**: Runner sync_task T5 pull mode.
- **Then**: Post sync: parse §A hashtable single-quote between apostrophe L21/L22/L39/L40/L51/L52/L53/L54 lines (owner-handsfree.config.ps1 parse method indexOf-first-pair apostrophe) → compare 8 values against lockbox decrypt array order UNBLOCK8.
- **Pass Condition**: All8 strict equality AND HMAC_ts newer ≥ §A previous mtime AND .bak backup_created_count==1
- **Evidence**: 05_bidir_sync.md 8 rows side-by-side match table.

### AC-6: Process Env Inject 8 Keys Scope User ONLY NO Machine
- **Type**: `rule`
- **Given**: Sync successful lockbox populated
- **When**: Pre-wrapper ps1 SetEnvironmentVariable × 8 Process
- **Then**: Verify `gci env:UNBLOCK8_0..7 | select Name,Length match expected len`. Machine scope permanent registry check `reg query HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment /v DATABASE_URL` → return code 1 NOT FOUND.
- **Pass Condition**: 8/8 process env match len + machine perm ALL 8 reg query "The system was unable to find the specified registry key or value" substring.
- **Evidence**: 06_env_scope.md env output + reg query missing 8/8.

### AC-7: DPAPI 8+1 Per-Key Roaming Cache
- **Type**: `rule`
- **Given**: rotate_version=7 completed
- **When**: count files `.keys/rotate/key_*.dpapi` = count UNBLOCK8 +1 GitHub PAT
- **Then**: Each file dpapi unprotect roundtrip == subkey val expected hash sha256 match
- **Pass Condition**: 9 count exact; 9/9 roundtrip sha match
- **Evidence**: 07_dpapi_cache.md 9 rows roundtrip.

### AC-8: GitHub PAT REST AutoRotate (Or Skip Documented)
- **Type**: `rubric`
- **Dimension**: Success rotate if network OK or honest SKIP with ≥40char reason
- **Scale**: 0-2
- **Anchors**: 0 = 0 network call attempted; 1 = network OK but PAT invalid; 2 = PAT 201 Created + new len matches classic scope repo+read:org + credential.helper base64 updated new token prefix ghp_ length 93.
- **Pass Threshold**: ≥ 1 (must attempt OR honest documented skip)
- **Evidence**: 08_pat_rotate.md 201 response json OR substring skip_reason ≥ 40 chars network-down.

### AC-9: Idempotency Fresh Age Skip
- **Type**: `rule`
- **Given**: Lockbox rotate_version written 1 minute ago, min-age default 1440
- **When**: Runner --rotate=now 2nd consecutive invoke
- **Then**: exit=0 stdout: "IDEM SKIP rotate age=1min threshold=1440 0 writes 0 changes"
- **Pass Condition**: exitcode0 AND 0 tmp files AND lockbox mtime unchanged (stat mtimeMs before == after ±10ms tolerance)
- **Evidence**: 09_idempotency.md stat mtime equality + stdout.

### AC-10: HMAC Chain Integrity 17+ Lines · 3 Samples Match · Monotonic TS
- **Type**: `rubric`
- **Dimension**: Chain robustness
- **Scale**: 0-2
- **Anchors**: 0 = <13 lines; 1 = lines≥13, samples fail; 2 = lines≥17, 3 random samples [3,9,15] recalc HMAC digest MATCH stored, all timestamps next_ts >= prev_ts strict monotone no backward clock.
- **Pass Threshold**: >= 2
- **Evidence**: 10_hmac_chain.md table sample digests + monotone graph ts.

### AC-11: Zeroization Count 9/9 (8 UNBLOCK8 + 1 PAT)
- **Type**: `rule`
- **Given**: All sync writes finished, before process exit
- **When**: Runner internal counter zeroized_count incremented per Buffer.fill(0)
- **Then**: counter=9 total; AND process memory dump impossible (no plaintext dump scan allowed — verified via internal shadow buffer XOR compare: shadowed copy != plaintext value expected hash sha256 after fill)
- **Pass Condition**: zeroized=9 AND shadow_compare_all_notmatch==9/9
- **Evidence**: 11_zeroize.md counter + shadow scan 9/9 mismatch.

### AC-12: Gitleaks Pre-Commit Gate 0 Leak + Rollback On Detect
- **Type**: `rule`
- **Given**: Leak simulation temp file `.keys/_leak_test.txt` content DATABASE_URL=<actual_plain>
- **When**: Runner gitleaks detect pre
- **Then**: exit=4 LEAK rollback; .bak-<prev_version> lockbox file restored; leak file removed clean
- **Pass Condition**: exitcode=4 AND recent_writes_count=0 (rollback confirm) AND leak_file_exists=no
- **Evidence**: 12_gitleaks_gate.md exit 4 + rm leak file + rollback.

### AC-13: Overall Composite Score Threshold
- **Type**: `rubric`
- **Dimension**: Total 26 pts pass threshold 21
- **Scale**: 0-2
- **Anchors**: 0 = total < 21; 1 = 21..24; 2 = ≥ 25 / 26
- **Pass Threshold**: ≥ 1
- **Evidence**: Grand total line final stdout 21+/26.

---

## Open Questions (Toutes Résolues par Réponses Q1→Q5 + Hypothèses A1→A4)
0 remaining questions. 100% auto-résolu explicit answers.

---

## Signataire Reserves (5 Blocages — 0 Auto Execute POSSIBLE sans approbation + action MANUELLE signataire)
| Réserve | Niveau | Description Verbatim + unblock condition |
|---|---|---|
| **R1 🔴 P0 HIGHEST** | BOOTSTRAP 1× OBLIGATOIRE | Signataire MUST paste 1× MASTER_SEED_UNLOCK ≥64 chars high entropy → admin ps: `Set-Content -Encoding UTF8 .keys\_seed.plain (Read-Host "Paste MASTER_SEED_UNLOCK:" -AsSecureString | ConvertFrom-SecureString) ; node scripts/t7-git-secrets-autorotate-v358.mjs --bootstrap-from-plain ; rm .keys/_seed.plain ;` → AFTER bootstrap .keys/_seed.plain deleted NEVER kept on disk. |
| **R2 🔴 P0 HIGHEST** | Inject LIVE values override HKDF placeholders | Signataire MUST run ONCE after bootstrap for real LIVE keys: `node scripts/t7... --override="DATABASE_URL=<NEON pooled len122>" --import="BINANCE_API_KEY=<live SpotWithdraw>" --import="BINANCE_API_SECRET=<paired>" --override="OWNER_EXEC_UNLOCK=<live len≥43>"` → otherwise all 8 = HKDF placeholder format-only len valid but G2/G3 real APIs fail = documented honestly (NG2 no fabrication). |
| **R3 🟠 HIGH PAT GitHub** | GitHub PAT auto rotate OK if current PAT has admin scope; otherwise current PAT only classic repo scoped → use `--github-pat-id=<pat numeric id from GET /authorizations>` 1× set flag for rotate API to find correct PAT ID to regenerate (skip documented if missing ID). |
| **R4 🟠 HIGH DPAPI Machine Bound — Recovery Plan** | If machine dies, DPAPI master decrypt FAILS cross-host (intentional C1 constraint). Signataire MUST have OFFLINE recovery: physical paper seed (printed) + 3 out of 5 Shamir Secret Sharing stored separate geographic locations. This SPEC does NOT implement Shamir; requires separate future spec R4 write approval. |
| **R5 🔴 APPROVAL ÉCRITE Class B Security KMS Architecture** | Bot requires EXPLICIT signataire approval text literal: `"APPROVE CUSTOM LOCAL KMS ARCHITECTURE v358 autorotate 8keys DPAPI-bound AES-256-GCM PBKDF2 1.2M iters HKDF autoSYNC 5targets autoCOORD lock HMAC signature 0 external vault dependency"` → APPROVAL required before any runner code write implementation SP4 phase. |
