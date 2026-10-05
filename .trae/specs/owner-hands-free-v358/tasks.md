# TASKS — Ownership Hands-Free Policy v3.5.8
## Serial T0→T4 tasks, 10 AC mapping, ≥2 TRs per AC

---

### Phase Setup: Directories
```
$ROOT = repo root
New-Item -ItemType Directory -Force $ROOT/.swarm 2>&1 | Out-Null  # .gitignored later
New-Item -ItemType Directory -Force $ROOT/.trae/specs/owner-hands-free-v358 2>&1 | Out-Null
```

---

## TASK T0 — Pre-flight: KNOWN_36_KEYS listée exacte + validateurs
**Fichiers touchés**: (read-only) scripts/t5-secrets-payouts-po-v358.mjs#L124-L175 (KNOWN_36_KEYS)

**TRs Testable Rules**:
- [T0-1] **Extract KNOWN_36_KEYS array** exact order from t5 runner lines L124→L175. Save list in memory (const).
- [T0-2] **Count = 36 keys exactly**. If ≠36 abort.

**AC map**: AC-8 (rubric foundation), AC-1 (keys list later)

---

## TASK T1 — Créer `.swarm/owner-hands-free.config.ps1` 36 keys template placeholder
**Fichiers créés**: `.swarm/owner-hands-free.config.ps1` (.gitignoré, signataire-owned)

**Règles obligatoires T1**:
- [T1-1] Header `# owner-hands-free.config.ps1` + banner 3 lignes: "SIGNATAIRE ONLY", "100% PRIVÉ GITIGNORED", "NE JAMAIS COMMITTER CE FICHIER".
- [T1-2] Déclaration `$OWNER_HANDSFREE_SECRETS = [ordered]@{...}` L'ordre DOIT correspondre KNOWN_36_KEYS (T0) index 0..35.
- [T1-3] **8 Minimal Unblock Set** (index exact, KNOWN_36_KEYS match):
  0. `DATABASE_URL` = '' + comment `# 1. Neon PROD pooled len≈122`
  1. `LIVE_BANK_API` = '' + comment `# 2. 'true'`
  2. `BINANCE_API_KEY` = '' + comment `# 3. len≥32 SPOT Withdraw`
  3. `BINANCE_API_SECRET` = '' + comment `# 4. len≥32 Ed25519 Secret`
  4. `OWNER_EXEC_UNLOCK` = '' + comment `# 5. len≥43 HMAC high entropy`
  5. `OWNER_HANDS_FREE_POLICY` = '' + comment `# 6. 'true'`
  6. `CEX_DIRECT_DEPOSIT_ENABLED` = '' + comment `# 7. 'true'`
  7. `RELEASE_AMOUNT_OVERRIDE_USD` = '' + comment `# 8. '60'`
- [T1-4] Les 28 autres (index 8..35) = valeurs '' + comment unique décrivant chaque secret (SUPABASE_URL, PAYPAL_CLIENT_ID, BANKING_CIRCLE_*, WISE, PAYONEER, ATTIJARI_CIB, ETH_ARB_PROVIDER, OWNER_WALLET_ARB_0X).
- [T1-5] Fichier UTF-8 with BOM. Trailing newline final.

**Test T1**:
```powershell
$configPath = "$ROOT/.swarm/owner-hands-free.config.ps1"
. $configPath  # dot-source
$count = $OWNER_HANDSFREE_SECRETS.Count
$keys = @($OWNER_HANDSFREE_SECRETS.Keys)
# → $count == 36 (T1-5a); $keys[0..7] = (T1-3 exact names) (T1-5b); 28+ others known (T1-4)
```

**AC map**: AC-1 (rule), AC-8 (rubric, order 36/36), AC-9 (HowTo embedded comments)

---

## TASK T2 — Créer CMD wrapper `scripts/START-OWNER-HANDS-FREE.cmd` + PS1 companion
**Fichiers créés**:
- `scripts/START-OWNER-HANDS-FREE.cmd` (one-click launcher)
- `scripts/start-owner-hands-free.ps1` (la logique réelle en PowerShell, appelée par le CMD avec élévation auto)

**Règles obligatoires T2 CMD**:
- [T2-1] CMD entête `@echo off`, `setlocal enableextensions enabledelayedexpansion`, `set ROOT=%~dp0..`
- [T2-2] **Auto-elevation Admin**: Si non admin → `powershell -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -NoProfile -NoExit -File ""%ROOT%\scripts\start-owner-hands-free.ps1"" -Verbose' -Verb RunAs"` → exit 6.
- [T2-3] Si admin → `powershell -ExecutionPolicy Bypass -NoProfile -File "%ROOT%\scripts\start-owner-hands-free.ps1" -Verbose`. Capturer `%ERRORLEVEL%`, exitter avec même code.

**Règles obligatoires T2 PS1 companion `start-owner-hands-free.ps1`**:
- [T2-4] **Param [switch]$Verbose** supporté.
- [T2-5] `$ROOT = Split-Path -Parent $PSScriptRoot` (resolve repo root from scripts\ folder).
- [T2-6] `$CONFIG_PATH = Join-Path $ROOT ".swarm\owner-hands-free.config.ps1"`. If **NOT Test-Path $CONFIG_PATH** → Write-Error "T2-6 FAIL: Signataire doit d'abord copier template .swarm/owner-hands-free.config.ps1 et remplir 8 minimal unblock set." → exit 5.
- [T2-7] Dot-source `. $CONFIG_PATH`. Si `$OWNER_HANDSFREE_SECRETS -eq $null` → exit 5. Si `$OWNER_HANDSFREE_SECRETS.Count -ne 36` → exit 5.
- [T2-8] **Check 8 minimal unblock set** (first 8 KNOWN_36_KEYS):
  ```
  $unblock = @('DATABASE_URL','LIVE_BANK_API','BINANCE_API_KEY','BINANCE_API_SECRET','OWNER_EXEC_UNLOCK','OWNER_HANDS_FREE_POLICY','CEX_DIRECT_DEPOSIT_ENABLED','RELEASE_AMOUNT_OVERRIDE_USD')
  $present = 0
  foreach ($k in $unblock) { if (-not [string]::IsNullOrWhiteSpace($OWNER_HANDSFREE_SECRETS[$k])) { $present++ } }
  ```
  If **$present -lt 8** → Write-Error "FAIL_CLOSED count=$present/8 minimal unblock set attendus (8). AC-1 AC-2: DATABASE_URL len≥122, LIVE_BANK_API=true, BINANCE_KEY len≥32, BINANCE_SECRET len≥32, UNLOCK len≥43, HANDS_FREE=true, CEX_DIRECT_DEPOSIT=true, RELEASE_OVERRIDE=60 → manquants (8 - $present)" → **exit 5 FAIL_CLOSED** (avant appel run-live-crypto-po.ps1, AC-4).
- [T2-9] **Structural checks 4 gates (G2,G3,G4) before exec**:
  - G2 DATABASE_URL: length ≥ 120? If not → exit 5 message "DATABASE_URL too short".
  - G3 BINANCE_API_KEY length ≥32? BINANCE_API_SECRET length ≥32? Either fail → exit 5.
  - G4 OWNER_EXEC_UNLOCK length ≥43? No → exit 5.
- [T2-10] **Inject in Process scope (Permanent only Process — never User/Machine NFR-5)**:
  ```powershell
  foreach ($kv in $OWNER_HANDSFREE_SECRETS.GetEnumerator()) {
    Set-Item -Path "Env:\$($kv.Key)" -Value $kv.Value -Force  # $env:VAR
    Set-Variable -Name $kv.Key -Value $kv.Value -Scope Global  # $Variable:
    if ($VerbosePreference -ne 'SilentlyContinue') {
      $masked = if ($kv.Value.Length -ge 6) { $kv.Value.Substring(0,4) + '…' + $kv.Value.Substring($kv.Value.Length-2,2) + ' len=' + $kv.Value.Length } else { ('*'*$kv.Value.Length) + ' len=' + $kv.Value.Length }
      Write-Verbose "  INJECT $($kv.Key) = $masked"
    }
  }
  ```
- [T2-11] Vérif Node.js 24.x (NFR-9): `node -v 2>$null | Select-String '^v24\.'` → si non, Write-Warning mais continuer (run-live-crypto-po.ps1 est PowerShell).
- [T2-12] **& call target script**: `$WRAPPER = Join-Path $ROOT "scripts\run-live-crypto-po.ps1" ; & $WRAPPER -Verbose`.
- [T2-13] **Capture LASTEXITCODE**. If `$LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0` → "Wrapper terminé exit=$LASTEXITCODE. Consulter logs/swarm_clickless/latest.json". Exit code = $LASTEXITCODE. Else → "Wrapper terminé OK. Consulter reports/secrets-payouts/00_final_master.json". Exit 0.
- [T2-14] **Transient tmp cleanup NFR-8**: tmp files tmp_proc_*.cjs auto.

**AC map**: AC-3, AC-4, AC-5, AC-6, AC-10

---

## TASK T3 — Update `.gitignore` pour 100% exclusion .swarm/ secrets + HowTo spec check
**Fichiers modifiés**: `.gitignore` (L1→ajout section owner-hands-free)

**Règles T3**:
- [T3-1] Ajouter section comment bloc:
  ```
  # ============================================================
  # OWNER HANDS-FREE v3.58 Private Local Config (Signataire ONLY)
  # 100% EXCLUDED from git. NEVER commit these files.
  # ============================================================
  .swarm/**
  !.swarm/.gitkeep        # (optionnel, mais non créé — on garde directory via mkdir)
  ```
- [T3-2] Vérifier `git check-ignore --quiet .swarm/owner-hands-free.config.ps1 ; echo $LASTEXITCODE` → code **0** (fichier ignoré).
- [T3-3] Vérifier AC-9: documentation HowTo section présente (§6 du spec.md + commentaires T1 config + T2 messages verbose).

**AC map**: AC-2, AC-9 (rubric 2/2 if 8+3 items trouvés)

---

## TASK T4 — Smoke Test (mock placeholder ET simulation partielle)
**Fichiers touchés**: Aucun code (read-only) → 2 tests séparés:

**Smoke A — PLACEHOLDER config (vide, default)**
- [T4-1] Vider/s'assurer .swarm/owner-hands-free.config.ps1 8 minimal unblock set = '' (placeholder).
- [T4-2] Run `powershell -ExecutionPolicy Bypass -NoProfile -File scripts/start-owner-hands-free.ps1`.
- [T4-3] **Attendu EXIT CODE = 5** (AC-4 rule). Si 0 → FAIL.
- [T4-4] Stdout/err contient substring **"FAIL_CLOSED"** + **"count="** + **"minimal unblock set"**.

**Smoke B — SIMULATED VALID CONFIG (temporary, nettoyé immédiatement)**
*Mode mock — 0 vraies valeurs, juste remplissage structurel*:
- [T4-5] Créer backup temporaire config: `.swarm/_backup_before_mock.ps1` (immédiatement supprimé à T4-9).
- [T4-6] Modifier 8 champs config temporairement:
  ```
  DATABASE_URL = 'postgres://user:pass@ep-long-pool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&options=project%3Dep-long-pool-123456'  # len=122
  LIVE_BANK_API = 'true'
  BINANCE_API_KEY = ('k'*32)
  BINANCE_API_SECRET = ('s'*32)
  OWNER_EXEC_UNLOCK = ('u'*43)
  OWNER_HANDS_FREE_POLICY = 'true'
  CEX_DIRECT_DEPOSIT_ENABLED = 'true'
  RELEASE_AMOUNT_OVERRIDE_USD = '60'
  ```
- [T4-7] Run wrapper: `powershell -ExecutionPolicy Bypass -NoProfile -File scripts/start-owner-hands-free.ps1` (temps max 10s — on sait que run-live-crypto-po.ps1 va échouer gates car DATABASE_URL factice). On vérifie **Seulement que wrapper appelle run-live-crypto-po.ps1**. AC-5 validé si wrapper n'a pas exit 5 avant et que log "INJECT DATABASE_URL = post…gh len=122" présent stdout Verbose.
- [T4-8] **Nettoyage RAPIDE**: restaurer config placeholder (supprimer mock values).
- [T4-9] Supprimer `.swarm/_backup_before_mock.ps1`.
- [T4-10] AC-7 NG2: `(Get-ChildItem out/received -Recurse -File -ErrorAction 0 | Where-Object { $_.Name -ne '.gitkeep' }).Count` = AVANT === APRÈS (identique, 0 nouveau fichiers).

**AC map**: AC-4, AC-5, AC-7

---

## TASK T5 — Final artifacts + changelog v3.5.8 entry
**Fichiers touchés**: CHANGELOG.md (prepend line v3.5.8 hands-free feature)
- [T5-1] Prepend 1-liner CHANGELOG: `* v3.5.8 (feat OWNER HANDS-FREE): Auto 8 minimal unblock set injection + 1-click CMD launcher scripts/START-OWNER-HANDS-FREE.cmd + .swarm/ config template .gitignored. Exit 5 FAIL_CLOSED if config empty. Signataire HowTo §6 spec.`

---

## AC → TRs Map (tous AC ≥ 2 TRs)

| AC | Testables minimum 2 |
|---|---|
| AC-1 | T1-2, T1-5 (count=36) + T2-7 (count=36 verify) |
| AC-2 | T3-1 ignore lines + T3-2 check-ignore exit 0 |
| AC-3 | T2-1 CMD exists + T2-5 PS1 root resolve + T2-8 count≥8 check |
| AC-4 | T4-1 placeholder + T4-3 exit=5 + T4-4 FAIL_CLOSED string |
| AC-5 | T4-6 mock values len correct + T4-7 inject verbose present + calls run-live |
| AC-6 | Grep wrapper CMD+PS1 0 occurrence `git push` + read T2-12 |
| AC-7 | T4-10 avant/après count same out/received non-.gitkeep = 0 |
| AC-8 | T0-1 KNOWN_36_KEYS order exact + T1-2 ordered dict → compare keys arrays 36/36 |
| AC-9 | Spec §6 8+3 items HowTo + T1 comment per 8 minimal keys + T2-8 error string list |
| AC-10 | T2-8 count≥8 gate + T2 structural G2-G4 + T2-13 LASTEXITCODE propagate |

---

*FIN TASKS owner-hands-free-v358 SP2*
