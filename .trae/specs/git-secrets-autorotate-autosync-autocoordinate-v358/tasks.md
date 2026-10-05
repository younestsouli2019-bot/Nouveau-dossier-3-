# Git Secrets AutoRotate + AutoSync + AutoCoordinate v3.5.8 — Implementation Plan (15 tasks T0→T14)

## Coverage Matrix (13 AC × 15 Tasks — 100% Coverage)
| AC | Primary Task | Backup Task | Pass Threshold |
|----|--------------|-------------|----------------|
| AC1 DPAPI Bootstrap 1× seed | T1 | T0 | 2pts exact |
| AC2 HKDF 8 subkeys len correct | T2 | T10 vec | 2pts exact |
| AC3 Rotate atomic + HMAC sign | T3 | T14 syn | 2pts exact |
| AC4 Adv lock race-free TTL busy | T4 | T9 idem | 2pts exact |
| AC5 Bidirectional sync §A ↔ Lockbox | T5 | T0 ACL | 2pts exact |
| AC6 Process env inject NO Machine | T6 | T5 sync | 2pts exact |
| AC7 DPAPI per-key cache 9 | T7 | T6 inj | 2pts exact |
| AC8 PAT rotate 201 or skip doc | T8 | T14 syn | 2pts scale 0-2 ≥1 |
| AC9 Idempotency fresh age skip | T9 | T4 lock | 2pts exact |
| AC10 HMAC chain 17+ 3samples monotone | T10 | T14 syn | 2pts scale 0-2 ≥2 |
| AC11 Zeroize 9/9 + shadow compare | T11 | T0 ACL | 2pts exact |
| AC12 Gitleaks gate + rollback | T12 | T3 rot | 2pts exact |
| AC13 Composite ≥21/26 pts | T14 | ALL | 2pts scale 0-2 ≥1 |

---

## Task 0: BOOTSTRAP — Dirs + ACLs
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: None
- **Description**:
  - Create `.keys/`, `.keys/rotate/`, `reports/git-secrets-autorotate-v358/`, `data/out/` (if not exist recursive).
  - Apply ACL `icacls .keys /inheritance:r /grant:r "%USERNAME%:(OI)(CI)(F)" "Administrators:(OI)(CI)(F)" /deny "Everyone:(OI)(CI)(RX)"` Windows deny Everyone read.
  - Pre-create 13 placeholder reports `01_… 13_…` before reads (ENOENT pattern SPEC6).
  - Append `.keys/**` exclusion to `.gitignore` L33 after existing doomsday line.
- **Acceptance Criteria Addressed**: AC1, AC5, AC11
- **Test Requirements**:
  - `rule` T0.TR1: `ls .keys/` returns 2 subdirs + ACL icacls output contains EXACT substring `"Everyone:(DENY)(R)"` (0 Everyone read).
  - `rule` T0.TR2: `.gitignore L33` contains EXACT string `.keys/**` gitignored (verified grep).
  - `rule` T0.TR3: `countNonGitkeep(reports/…)` = 14 exact (01..13 + master_sha256.txt pre-placeholder).

---

## Task 1: DPAPI Seed Locker (Bootstrap 1× Only)
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T0
- **Description**:
  - Implement bootstrap flow: node spawn powershell.exe `-Command "& { Add-Type -AssemblyName System.Security; $bytes=[Text.Encoding]::UTF8.GetBytes($env:SEED_PLAIN); $entropy=[Text.Encoding]::UTF8.GetBytes('v358-swarm-kms'); $prot=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,'CurrentUser'); [Convert]::ToBase64String($prot) }"` → capture stdout base64 → write `.keys/_seed.dpapi` (UTF-8 BOM).
  - Roundtrip decrypt Unprotect verify compare sha256 plain.
  - Validate Shannon entropy seed ≥ 3.5 bits per char + len ≥64.
- **Acceptance Criteria Addressed**: AC1
- **Test Requirements**:
  - `rule` T1.TR1: seed_roundtrip_sha256(decrypt_protect) == sha256(original_plain_test_vector).
  - `rule` T1.TR2: bootstrap_fail_short_32char exits exitcode 2 documented reason.
  - `rule` T1.TR3: ACL Everyone DENY apply `.keys/_seed.dpapi` L1 ACL match (icacls).

---

## Task 2: HKDF Subkey Derive Deterministic 8
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T1
- **Description**:
  - Pure `hkdf_sha256(ikm, salt, info)` 32-byte out each: extract HMAC salted → expand HMAC info counter=1.
  - Map UNBLOCK8[i] 1:1 format rules: idx0=DATABASE_URL postgres://len120-124 random; idx2/3=alnum≥32 Binance format; idx4=base58≥43 UNLOCK; idx1/5/6=string "true"; idx7=string "60".
  - Test VECTOR_KDF_TEST fixed expected published report appendix A (lengths+hash values).
- **Acceptance Criteria Addressed**: AC2
- **Test Requirements**:
  - `rule` T2.TR1: 8/8 length exact match idx0∈[120,124], idx2/3≥32, idx4≥43.
  - `rule` T2.TR2: VECTOR_KDF_TEST sha256 of concat subkeys match precomputed digest EXACT published L2 report.
  - `rule` T2.TR3: 2 consecutive runs (identical seed+salt+info) return byte-for-byte same values (determinism).

---

## Task 3: Rotate Atomic Write + HMAC Signature
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T2
- **Description**:
  - AES-256-GCM encrypt plaintext=JSON stringify {rotate_version:N, ts:iso, values:[8], pat:str, checksum:sha256(concat)}. PBKDF2 1.2M iters salt 32 random prefix file. Nonce=12 random crypto.randomBytes.
  - Write body: `V358LOCKBOX2 | base64(salt) | base64(nonce) | base64(ciphertext+tag)` + trailing `|HMAC=` + HMAC-SHA256 over entire preceding bytes (key=sha256("v358-hmac-auth"+unlock)).
  - Write tmp `<pid><rand6>.tmp` · fsSync.rename() atomic → final `autorotate.lockbox.enc`. Also copy previous → `.bak-N` keep last 6.
- **Acceptance Criteria Addressed**: AC3
- **Test Requirements**:
  - `rule` T3.TR1: recalc_HMAC(preceding bytes) == stored_HMAC_last_line exact 64hex.
  - `rule` T3.TR2: after rotate 2× successive count .bak* files ≥2 (previous preserved).
  - `rule` T3.TR3: simulate rename fail disk full → exitcode=5 ROTATE_ATOMIC_RENAME_FAIL AND tmp file deleted NO partial.

---

## Task 4: Advisory Lock Multi-instance Coordination
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T0
- **Description**:
  - Advisory lock `.keys/autorotate.lock` O_CREAT|O_EXCL mode 0o600 (throws EEXIST if exists). Body: `pid=<pid>|ts=<iso>|ttl=120|owner_hmac=<hmac(pid|ts, unlock)>`.
  - EEXIST path: stat mtime current → age=now-mtime seconds < ttl(120) → exit3 LOCK_TTL_BUSY detailed reason 40+ chars; age ≥ ttl stale → rm stale lock + re-aqcuire new.
  - Exit all paths: final try/finally unlock rmSync force.
- **Acceptance Criteria Addressed**: AC4
- **Test Requirements**:
  - `rule` T4.TR1: Simulate two parallel node instances `node t7… --rotate=now & node t7… --rotate=now (sleep 100ms)` → Instance B exitcode EXACT 3 AND stdout contains "concurrent rotate detected lock owner pid=".
  - `rule` T4.TR2: 150s after A lock held → instance B acquire SUCCESS (ttl expired stale removed) exitcode0.
  - `rule` T4.TR3: lock file ACL Everyone DENY read post create.

---

## Task 5: Bidirectional Sync Lockbox ↔ Section A §A
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T3
- **Description**:
  - Read lockbox decrypt + parse values8 ordered; parse §A hashtable via owner-handsfree.config.ps1 strict parse method indexOf-first-apostrophe-pair after equals (per SPEC6 T3 algorithm proven accurate).
  - Compute HMAC_ts_lockbox = hmac(lockbox rotate_version+ts, master) + HMAC_ts_sectA = hmac(sectionA values concatenated + file mtimeMs, master). Compare:
    - (a) Lockbox newer → pull overwrite 8 lines §A (Set-Content UTF8 BOM preserve all other lines + single-quote around values).
    - (b) §A newer → push values new rotate version++ lockbox write atomic.
    - (c) Both empty → require_bootstrap exit 2.
- **Acceptance Criteria Addressed**: AC5
- **Test Requirements**:
  - `rule` T5.TR1: Post pull lockbox→§A; Parse §A strict apostrophe method → values8 deep equal lockbox values8 AND order UNBLOCK8.
  - `rule` T5.TR2: Post push §A→lockbox; Rotate_version = prev+1 incremented exactly AND HMAC verified integrity.
  - `rule` T5.TR3: hash mismatch simultaneous edit → exitcode 6 SYNC_DIR_CONFLICT + rollback bak copy restored NO damage.

---

## Task 6: PowerShell Process Env Inject (USER SCOPE ONLY — NO Machine Permanent)
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T5
- **Description**:
  - Pre-Wrapper companion `scripts/autorotate-pre-wrapper.ps1` (NEW dot-source TOP of start-owner-hands-free.ps1 after #Requires):
    - `foreach (k in UNBLOCK8_EXPECTED_ORDER) { [Environment]::SetEnvironmentVariable($k, $lockbox_values[$k], 'Process') }`
    - Verify injection: `foreach { if ((gci "env:$k").Value.Length -ne $expected_len[$k]) { throw failclosed exit 5 } }`
  - NEVER call SetEnvironmentVariable for scope 'User' or 'Machine' (hard check; grep for those strings in function → throw if found).
- **Acceptance Criteria Addressed**: AC6
- **Test Requirements**:
  - `rule` T6.TR1: After injection, `env:\DATABASE_URL.Length` = 122 (valid range) AND 8/8 keys present Process scope.
  - `rule` T6.TR2: Registry HKLM permanent env query: 8 keys return "not found" (verification `cmdkey /list` + reg query HKLM Environment).
  - `rule` T6.TR3: Code grep `SetEnvironmentVariable.*['\"]Machine['\"]` in runner/pre-wrapper → count=0 (forbidden literal).

---

## Task 7: DPAPI Per-Key Roaming Cache (9 files: 8UNBLOCK + 1PAT)
- **Status**: `pending`
- **Priority**: `medium`
- **Depends On**: T6
- **Description**:
  - For each UNBLOCK8 subkey value + GitHub PAT value: DPAPI Protect individual → write `.keys/rotate/key_<KEY_NAME>.dpapi` base64 UTF8.
  - Fast path restart: If rotate_version matches manifest `.keys/rotate/_manifest.json` (rotate_version match) → use DPAPI cache skip HKDF derive. If version mismatch delete ALL cache files invalidate.
- **Acceptance Criteria Addressed**: AC7
- **Test Requirements**:
  - `rule` T7.TR1: count = 9 files EXACT + manifest file = 10 total.
  - `rule` T7.TR2: Roundtrip unprotect each file → sha256 matches lockbox value hash 9/9.
  - `rule` T7.TR3: After rotate_version++ next rotate; count cache files AFTER invalidate = 0 (delete_all called before new write).

---

## Task 8: GitHub PAT AutoRotate (201 Created Or Honest Documented Skip)
- **Status**: `pending`
- **Priority**: `medium`
- **Depends On**: T3
- **Description**:
  - Parse existing PAT from base64 decode of credential.helper=store: read `C:\Users\Dell\.git-credentials` (or fallback project-local `.git/credentials` if exists) base64 decode lines match regex `^https://x-access-token:<ghp_.*>@github.com/`.
  - Optional: `--github-pat-id=<id>` numeric ID. Call GET /authorizations → find id match → POST /authorizations/cli/<id> body {scopes:["repo","read:org"]} auth Bearer <OLD_PAT> → 201 response {token:<NEW_ghp_…>}.
  - Success: rewrite credentials base64 update (atomic tmp→rename). Network fail / no scopes: SKIP with ≥40 char reason "GitHub PAT rotate SKIPPED: network unreachable or PAT not admin scopes add --github-pat-id=XYZ"
- **Acceptance Criteria Addressed**: AC8
- **Test Requirements**:
  - `rubric` T8.TR1: Network real → new token prefix `ghp_` len=93 AND credential.helper base64 decoded new match (2pts). Network down mock → skip_reason len≥40 chars documented honest (1pt). No attempt anything (missing PAT file) → 0pts.
  - `rule` T8.TR2: Never print PAT unmasked stdout/stderr; maskSecret first4…last3 always.
  - `rule` T8.TR3: File permission `.git-credentials` post write → icacls Everyone DENY read apply.

---

## Task 9: Idempotency Fresh Age Skip Default 1440 Min (24h)
- **Status**: `pending`
- **Priority**: `medium`
- **Depends On**: T3
- **Description**:
  - Parse lockbox rotate_version iso ts field `rotate_ts:iso` → age_min = (Date.now() - Date.parse(rotate_ts))/(1000*60). Compare flag --min-age-minutes (default 1440).
  - If age_min < threshold: exit0 skip, stdout: "IDEM SKIP rotate age=Xmin threshold=Ymin 0 writes". Return NO tmp files.
  - Force rotate: `--force-rotate` flag (ignore age check).
- **Acceptance Criteria Addressed**: AC9
- **Test Requirements**:
  - `rule` T9.TR1: Consecutive runs 60 seconds apart default → second exit0 AND stdout contains "IDEM SKIP rotate".
  - `rule` T9.TR2: Stat lockbox mtimeMs tolerance 10ms unchanged before/after second run (0 writes actual).
  - `rule` T9.TR3: `--force-rotate` flag ignores age → new rotate_version+1 and new mtime > previous.

---

## Task 10: HMAC Append-Only Chain Integrity (17+ lines · 3/3 Samples Match · Monotonic)
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T0
- **Description**:
  - NDJSON log `data/out/git-secrets-autorotate-v358.ndjson` line format = step|iso_ts|json_payload|hmac_sha256. 1st line ROTATE_INIT; T0..T14 lines; 0 backup lines (3 additional copies last 6); final line ROTATE_COMPLETE = ≥ 17 lines total.
  - HMAC key: OWNER_EXEC_UNLOCK from DPAPI cache; if len<43 → DUMMY HMAC KEY `SWARM-AUTOROTATE-DUMMY-KEY-V358-00000000000000000000` (47 chars).
  - Monotonic timestamp check: foreach next_line_cursor ts >= previous ts (allow equal same millisecond; NEVER <).
- **Acceptance Criteria Addressed**: AC10
- **Test Requirements**:
  - `rubric` T10.TR1: Scale 0-2. Anchors 0:<13 lines; 1:13-16 lines OR samples fail; 2:≥17 lines + samples 3,9,15 recalc EXACT digest match + monotone no backward. Score must be 2/2 (pass threshold).
  - `rule` T10.TR2: Two consecutive runs append lines; lines are cumulative NOT truncated (append-only semantic).
  - `rule` T10.TR3: Corrupt 1 char in line 9 HMAC digest → recalc detect corrupt report line index exitcode=7 HMAC_CHAIN_BROKEN rollback to previous chain.bak if exists.

---

## Task 11: Zeroization Memory Buffer After Use
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T2,T5
- **Description**:
  - Declare ALL plaintext buffers as Uint8Array explicit scope block. Immediately after use + sync done: `buf.fill(0x00)` (overwrite plaintext with zeros). Counter zeroized_count increment each fill operation.
  - Shadow compare verification: compute sha256(buffer) BEFORE fill (expected) AFTER fill → MUST NOT equal expected (all zeros digest = specific value… match = fail).
  - Log final stdout "zeroized 9/9 buffers: UNBLOCK8(8) + PAT(1) = 9 total" with counter.
- **Acceptance Criteria Addressed**: AC11
- **Test Requirements**:
  - `rule` T11.TR1: Counter final printed = 9 EXACT.
  - `rule` T11.TR2: Shadow compare digest NOT match plaintext digest 9/9 (all successfully zeroized).
  - `rule` T11.TR3: grep code for values leaks in logging maskSecret utility used on all non-zeroize-write stdouts → count plaintext 0 lines.

---

## Task 12: Gitleaks Pre-Commit Gate + Auto Rollback
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T3,T5,T7
- **Description**:
  - Before runner exit success (all writes done), spawn `gitleaks detect --no-banner --no-git -r json --report-format=json -c .gitleaks.toml --path=. --exit-code=1 --redact` (gitleaks on PATH? check! If gitleaks command not found → honest skip with 40+ char "gitleaks binary missing on PATH install gitleaks to enable gate" documented).
  - If exitcode != 0 (leaks found): copy autorotate.lockbox.enc → `.bak-leak-detected-<ts>`; rollback lockbox to PREVIOUS .bak-N latest; rmSync tmp files; delete fresh 9 cache DPAPI files invalidate; exitcode = 4 LEAK_DETECTED; detailed stdout 1 leak per pattern.
- **Acceptance Criteria Addressed**: AC12
- **Test Requirements**:
  - `rule` T12.TR1: Simulate leak echo DATABASE_URL=<actual_plain> → .keys/_leak_test.txt → spawn runner detect → exitcode EXACT 4 AND rollback successful (prev lockbox .bak restored via hash equality check).
  - `rule` T12.TR2: leak_test file auto-removed post rollback (not remain fs).
  - `rule` T12.TR3: No leak scenario → gitleaks exit0 + runner exit0 pipeline success.

---

## Task 13: Pre-Wrapper PS Hook Integration
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T6
- **Description**:
  - Create NEW file `scripts/autorotate-pre-wrapper.ps1`. Top of existing `start-owner-hands-free.ps1` after `#Requires -RunAsAdministrator` + dot-source:
    ```powershell
    # Autorotate Pre-Wrapper Hook (security-class)
    if (Get-Item "$PSScriptRoot\autorotate-pre-wrapper.ps1" -ErrorAction SilentlyContinue) {
      . "$PSScriptRoot\autorotate-pre-wrapper.ps1"
      if ($LASTEXITCODE -ge 2 -and $LASTEXITCODE -ne 3) { failClosedExit5 "Autorotate pre-hook exit=$LASTEXITCODE. Abort before rails." }
    }
    ```
  - Exit 0 or 3 (lock busy allowed) → continue; exit ≥2 else → failclosed exit5 wrapper stop.
- **Acceptance Criteria Addressed**: AC1 (pre-wrapper validates seed), AC6 (env inject)
- **Test Requirements**:
  - `rule` T13.TR1: Parse `start-owner-hands-free.ps1` line-by-line → after #Requires, exists new dot-source autorotate block (grep count≥1).
  - `rule` T13.TR2: Pre-wrapper returns exit 2 (bootstrap missing) → companion abort exit 5 (failclosed captured LASTEXITCODE 5).
  - `rule` T13.TR3: Pre-wrapper returns exit 3 (lock busy) → wrapper continues (tolerated, next run try later).

---

## Task 14: Final Synopsis · Composite AC Scoring 26pts · ExitCode Gate
- **Status**: `pending`
- **Priority**: `high`
- **Depends On**: T1..T13
- **Description**:
  - Tally AC1..AC12 rules 2pts each = 24. AC8+AC10 rules rubric bonus capped. AC13 composite = if GrandTotal >=25 → 2; 23-24 → 1.5; 21-22 → 1; <21 →0.
  - Compute AC13 score: add to GrandTotal (cap 26 pts max).
  - If GrandTotal >= 21: exit0 PASS. Write 13_report_final_synopsis.md 13 rows table verdicts. Print banner `SPEC git-secrets-autorotate-v3.5.8 GrandTotal=XX/26 ≥21 PASS`.
  - If GrandTotal <21: exit1 FAIL. Write failed tasks list with remediation steps explicit 1 per failing AC.
- **Acceptance Criteria Addressed**: AC13
- **Test Requirements**:
  - `rubric` T14.TR1: Scale 0-2. 0:<21 FAIL exit1; 1:21-24 → 1-1.5 pts; 2:≥25 → 2pts. Must be ≥1 overall PASS gate.
  - `rule` T14.TR2: 13_report_final_synopsis.md contains 13 rows table (AC1..AC13). No missing rows. All green PASS AC rows have check.
  - `rule` T14.TR3: Master SHA file `reports/git-secrets-autorotate-v358/master_sha256.txt` = SHA256 over concatenation (reports01.md..12.md + runner source hash + spec/tasks sha). Fresh unique per run.
