[CmdletBinding()]
param(
    [switch]$FORCE_RELOAD_HANDSFREE
)

$ErrorActionPreference = 'Stop'

# ============================================================
#  OWNER HANDS-FREE v3.5.8 Companion Runner (Admin PS)
#  Purpose:
#    T-0:   Autorotate pre-hook: rotate UNBLOCK8 keys fresh via custom local KMS (SPEC7 git-secrets-autorotate-v358)
#    T-0.5: SPEC8 SWARM REVENUES AUTO-ROUTE: collect all sources -> BUCKET_PCT 10/40/30/20 -> bucket-ordered dispatch SAL->DEBT->SOV->OPS -> HMAC chain
#    T-1:   Dot-source .swarm/owner-hands-free.config.ps1 (36 keys)
#    T-2:   Count 8 minimal unblock set -- if <8 -> FAIL-CLOSED exit 5
#    T-3:   Structural checks G2/G3/G4 lengths -- if bad -> exit 5
#    T-4:   Inject 36 secrets into Process scope only (NFR-5)
#    T-5:   Call scripts/run-live-crypto-po.ps1 -Verbose
#    T-6:   Propagate LASTEXITCODE
# ============================================================

# Autorotate Pre-Wrapper Hook (security-class SPEC git-secrets-autorotate-v358)
$AUTOROTATE_PRE = Join-Path $PSScriptRoot 'autorotate-pre-wrapper.ps1'
if (Test-Path $AUTOROTATE_PRE -ErrorAction SilentlyContinue) {
  Write-Host '[HANDS-FREE] T-0: autorotate pre-hook'
  . $AUTOROTATE_PRE
  $autoExit = $LASTEXITCODE
  if ($autoExit -ge 2 -and $autoExit -ne 3) {
    Write-Host "[HANDS-FREE] autorotate FAIL exit=$autoExit (>=2 and !=3 LOCK_BUSY) -> failclosed exit5 before any rails"
    if (Test-Path function:failClosedExit5) { failClosedExit5 "Autorotate pre-hook exit=$autoExit abort before rails" } else { exit 5 }
  }
}

# ================================================================
# PHASE 0.4: SPEC8 PREFLIGHT VALIDATOR (0 sends, external audit)
#   S0 → fixtures T13 / inbox clean
#   S1 → G1-G4 4/4
#   S2 → 5/5 rail matrix alive ≥ 1
#   S3 → Neon DB reachable
#   S4 → Binance /api/v3/ping reachable
#   S5 → Capability flags ≥ 2
#   S6 → Bucket split + envelope ≤ 200 USD (MAX)
#   S7 → DB RevenueEvent sum query (manual neon SQL editor)
#   S8 → HORS 12 signoff lines print
# Exit: 0 ok / 12 NEED CONFIG / 13 HARD PREFLIGHT FAIL
# ================================================================
$PREFLIGHT_SCRIPT = Join-Path $PSScriptRoot 'spec8-preflight-v358.mjs'
$SPEC8_WET_RUN_WANTED = $false
$SCRIPT:PREFLIGHT_EXIT = -1
if (Test-Path $PREFLIGHT_SCRIPT) {
  Write-Host '[HANDS-FREE] T-0.4: spec8-preflight-v358 (0 sends, 9 checks green/red)' -ForegroundColor Cyan
  & node $PREFLIGHT_SCRIPT
  $SCRIPT:PREFLIGHT_EXIT = [int]$LASTEXITCODE
  if ($SCRIPT:PREFLIGHT_EXIT -ge 13) {
    failClosedExit5 ("SPEC8 PREFLIGHT HARD FAIL exit={0} -> NE PAS lancer LIVE. Corriger infra/creds avant reprise." -f $SCRIPT:PREFLIGHT_EXIT)
  } elseif ($SCRIPT:PREFLIGHT_EXIT -eq 12) {
    Write-Warning '[HANDS-FREE] preflight exit=12 NEED CONFIG -> running PLAN MODE ONLY (0 sends, 0 DB writes). Live wet-run desactive.'
    $SPEC8_WET_RUN_WANTED = $false
  } elseif ($SCRIPT:PREFLIGHT_EXIT -eq 0) {
    Write-Host '[HANDS-FREE] preflight exit=0 ALLOWS live -> ask signataire wet-run confirmation (default N -> plan)' -ForegroundColor Green
    $confirmation = Read-Host '  ATTENTION: EXECUTION WET-RUN REELLE (argent reel possible). Continuer ? [O/N] (defaut=N)'
    if ($confirmation -match '^[oOyY]$') { $SPEC8_WET_RUN_WANTED = $true } else { $SPEC8_WET_RUN_WANTED = $false }
  } else {
    Write-Warning ("[HANDS-FREE] preflight exit={0} unmapped -> plan mode only." -f $SCRIPT:PREFLIGHT_EXIT)
  }
}
$env:SPEC8_WET_RUN_CONFIRMED_AT = if ($SPEC8_WET_RUN_WANTED) { (Get-Date -Format o) } else { '' }

# ================================================================
# PHASE 0.5: SWARM REVENUES AUTO-ROUTE (SPEC MODE #8 v3.5.8)
# Order enforced by design: autorotate (DPAPI fresh) -> preflight -> swarm route
#   -> inject + gates -> live-crypto wrapper.
# Tolerate exit code 0 (success) OR exit 3 (LOCK BUSY).
# Exit code >= 7 -> Hard fail-closed -> abort wrapper exit 5
# (forensic marker: cross-bucket diversion / zero-loss delta > 1 cent)
# ================================================================
$SWARM_ROUTE_SCRIPT = Join-Path $PSScriptRoot 'swarm-revenues-auto-route-v358.mjs'
if (Test-Path $SWARM_ROUTE_SCRIPT -ErrorAction SilentlyContinue) {
  if ($SPEC8_WET_RUN_WANTED) {
    $modeLabel = '--WET-RUN (EXPLICIT LIVE, requires HORS signoff interactif + TTY + capability flags per rail)'
    $swarmArgs = @($SWARM_ROUTE_SCRIPT, '--WET-RUN')
  } else {
    $modeLabel = 'PLAN ONLY (0 sends, 0 DB writes, owner hands-free signature bypass NOT used for sends)'
    $swarmArgs = @($SWARM_ROUTE_SCRIPT, '--owner-hands-free-mode')
  }
  Write-Host ('[HANDS-FREE] T-0.5: swarm-revenues-auto-route (SPEC8) collect -> split -> bucket order -> HMAC chain  [{0}]' -f $modeLabel)
  & node @swarmArgs
  $swarmExit = $LASTEXITCODE
  if ($swarmExit -ge 7) {
    Write-Host ("[HANDS-FREE] swarm route FAILCLOSED exit={0} (>=7 = forensic marker: zero-loss delta or cross-bucket fraud) -> abort wrapper exit=5" -f $swarmExit)
    if (Test-Path function:failClosedExit5) { & failClosedExit5 ("SPEC8 swarm-route hard exit={0} -- manual investigation required" -f $swarmExit) } else { exit 5 }
  }
  if (($swarmExit -ne 0) -and ($swarmExit -ne 3)) {
    Write-Warning ("[HANDS-FREE] swarm route exit={0} (tolerated: NOT in set 0 or 3, but <7 -- continuing; check data/out/swarm-revenues-plan.json)" -f $swarmExit)
  }
  Write-Host ("[HANDS-FREE] T-0.5 completed exit={0}  wet_run_active={1}" -f $swarmExit, $SPEC8_WET_RUN_WANTED)
}

# ------------------------------------------------------------
# T2-5: Resolve repo ROOT
# ------------------------------------------------------------
$ROOT = Split-Path -Parent $PSScriptRoot
$CONFIG_PATH = Join-Path $ROOT '.swarm\owner-hands-free.config.ps1'
$WRAPPER_PATH = Join-Path $ROOT 'scripts\run-live-crypto-po.ps1'

Write-Host '[HANDS-FREE] START owner-hands-free v3.5.8'
Write-Host "[HANDS-FREE]   ROOT       = $ROOT"
Write-Host "[HANDS-FREE]   CONFIG     = $CONFIG_PATH"
Write-Host "[HANDS-FREE]   WRAPPER    = $WRAPPER_PATH"

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
function maskSecret([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return '<empty len=0>' }
    if ($s.Length -ge 6) {
        return ($s.Substring(0,4) + '...' + $s.Substring($s.Length-2,2) + ' len=' + $s.Length)
    } else {
        return ( ('*' * $s.Length) + ' len=' + $s.Length )
    }
}
function failClosedExit5([string]$msg) {
    Write-Host ''
    Write-Host "FAIL-CLOSED exit=5 -> $msg"
    Write-Host ''
    exit 5
}

# ------------------------------------------------------------
# T2-6: Config file must exist
# ------------------------------------------------------------
if (-not (Test-Path -LiteralPath $CONFIG_PATH -PathType Leaf)) {
    failClosedExit5 "[T2-6] Config file not found. Signataire: 1) mkdir .swarm (si absent) ; 2) copier template owner-hands-free.config.ps1; 3) remplir 8 minimal unblock set."
}

# ------------------------------------------------------------
# T2-6b: SANITIZE CONFIG (PERMANENT BOM/INVISIBLE FIX)
#   - PowerShell 5.0 parser chokes on multiple leading U+FEFF (UTF-8 BOM)
#     glued to the first '#' comment line. Reproducible symptom:
#     "Le terme << <U+FEFF><U+FEFF>...# >> n'est pas reconnu..."
#   - Normalize file IN PLACE ONCE per wrapper invocation:
#       * strip U+FEFF / U+200B (ZWSP) / U+00A0 (NBSP) / U+202E (RLO) / U+202D (LRO)
#       * normalize CRLF line endings
#       * write back with UTF-8 WITHOUT BOM (Encoding.UTF8 w/ emitBOM=$false PS6+)
#   - Idempotent (no-op if already clean), safe for secrets (no changes to VALUES),
#     zero risk because comments are re-prefix '#' standard.
# ------------------------------------------------------------
try {
    $rawBytes = [System.IO.File]::ReadAllBytes($CONFIG_PATH)
    $cfgText  = [System.Text.Encoding]::UTF8.GetString($rawBytes)
    $bomsBefore = ([regex]::Matches($cfgText, "`u{FEFF}")).Count
    if ($bomsBefore -gt 0 -or $cfgText -match "`u{200B}|`u{00A0}|`u{202E}|`u{202D}") {
        $cfgText = $cfgText -replace "`u{FEFF}", ''
        $cfgText = $cfgText -replace "`u{200B}", ''
        $cfgText = $cfgText -replace "`u{202E}", ''
        $cfgText = $cfgText -replace "`u{202D}", ''
        $cfgText = $cfgText -replace "`u{00A0}", ' '
        $cfgText = $cfgText -replace "`r?`n", "`r`n"
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($CONFIG_PATH, $cfgText, $utf8NoBom)
        Write-Host ("[HANDS-FREE] T2-6b Config sanitized: removed BOMs={0}, invisible chars, wrote UTF-8 NO-BOM idempotent." -f $bomsBefore) -ForegroundColor DarkYellow
    } else {
        Write-Host '[HANDS-FREE] T2-6b Config clean (0 BOMs, 0 invisible chars) — skip.' -ForegroundColor Gray
    }
} catch {
    failClosedExit5 "[T2-6b] Config sanitize FAIL (read/write access?): $_"
}

# ------------------------------------------------------------
# T2-7: Dot-source + sanity count=36
# ------------------------------------------------------------
try {
    $Global:OWNER_HANDSFREE_SKIP_VALIDATION_ON_LOAD = $true
    . $CONFIG_PATH
} catch {
    failClosedExit5 "[T2-7a] Config parse FAIL (after T2-6b sanitize): $_"
}

if ($null -eq $OWNER_HANDSFREE_SECRETS) {
    failClosedExit5 "[T2-7b] OWNER_HANDSFREE_SECRETS variable absente dans config."
}

if ($OWNER_HANDSFREE_SECRETS.Count -ne 36) {
    failClosedExit5 "[T2-7c] Config.Count=$($OWNER_HANDSFREE_SECRETS.Count). Attendu EXACTEMENT 36 keys (matching run-live-crypto-po.ps1 §Step1)."
}

# ------------------------------------------------------------
# T2-8: 8 minimal unblock set count≥8
# ------------------------------------------------------------
$UNBLOCK8 = @('DATABASE_URL','LIVE_BANK_API','BINANCE_API_KEY','BINANCE_API_SECRET','OWNER_EXEC_UNLOCK','OWNER_HANDS_FREE_POLICY','CEX_DIRECT_DEPOSIT_ENABLED','RELEASE_AMOUNT_OVERRIDE_USD')
[int]$present8 = 0
$missing8 = New-Object System.Collections.Generic.List[string]
foreach ($k in $UNBLOCK8) {
    $v = $OWNER_HANDSFREE_SECRETS[$k]
    if (-not [string]::IsNullOrWhiteSpace($v)) { $present8++ } else { $missing8.Add($k) }
}
Write-Host "[HANDS-FREE] T2-8 8-unblock: present=$present8/8"
foreach ($k in $UNBLOCK8) {
    $v = $OWNER_HANDSFREE_SECRETS[$k]
    $tag = if ([string]::IsNullOrWhiteSpace($v)) { '  [MISSING]' } else { '' }
    Write-Host "   - $k = $(maskSecret $v)$tag"
}

if ($present8 -lt 8) {
    failClosedExit5 "[T2-8] Minimal 8-unblock count=$present8<8. 8 requis: 1)DATABASE_URL len>=122 2)LIVE_BANK_API=true 3)BINANCE_API_KEY len>=32 4)BINANCE_API_SECRET len>=32 5)OWNER_EXEC_UNLOCK len>=43 6)OWNER_HANDS_FREE_POLICY=true 7)CEX_DIRECT_DEPOSIT_ENABLED=true 8)RELEASE_AMOUNT_OVERRIDE_USD=60. MANQUANTS: $($missing8 -join ', ')."
}

# ------------------------------------------------------------
# T2-9: Structural gates G2 (DB len≥120), G3 (Binance KEY/SECRET len≥32), G4 (UNLOCK len≥43)
# ------------------------------------------------------------
$db_len = ([string]$OWNER_HANDSFREE_SECRETS['DATABASE_URL']).Length
if ($db_len -lt 120) { failClosedExit5 "[T2-9 G2] DATABASE_URL len=$db_len<120. Attendu Neon Postgres PROD pooled URL ~len=122." }

$bk_len = ([string]$OWNER_HANDSFREE_SECRETS['BINANCE_API_KEY']).Length
$bs_len = ([string]$OWNER_HANDSFREE_SECRETS['BINANCE_API_SECRET']).Length
if ($bk_len -lt 32 -or $bs_len -lt 32) { failClosedExit5 "[T2-9 G3] BINANCE_API_KEY len=$bk_len / BINANCE_API_SECRET len=$bs_len. Attendu >=32 chacun (Spot Withdraw dual scope HMAC/Ed25519)." }

$un_len = ([string]$OWNER_HANDSFREE_SECRETS['OWNER_EXEC_UNLOCK']).Length
if ($un_len -lt 43) { failClosedExit5 "[T2-9 G4] OWNER_EXEC_UNLOCK len=$un_len<43. Attendu high-entropy >=43 chars." }

Write-Host '[HANDS-FREE] T2-9 gates structurels: G2=OK G3=OK G4=OK'

# ------------------------------------------------------------
# T2-10: Inject 36 secrets into Process scope (NFR-5: NEVER User/Machine scope)
# ------------------------------------------------------------
[int]$injected = 0
try {
    foreach ($kv in $OWNER_HANDSFREE_SECRETS.GetEnumerator()) {
        $k = [string]$kv.Key
        $v = [string]$kv.Value
        if ([string]::IsNullOrEmpty($v)) { continue }

        if (-not $FORCE_RELOAD_HANDSFREE) {
            $existing = [Environment]::GetEnvironmentVariable($k, [EnvironmentVariableTarget]::Process)
            if (-not [string]::IsNullOrEmpty($existing)) {
                Write-Host "   SKIP (already present Process scope): $k = $(maskSecret $existing)"
                continue
            }
        }

        Set-Item -Path ("Env:\" + $k) -Value $v -Force -ErrorAction Stop | Out-Null
        [Environment]::SetEnvironmentVariable($k, $v, [EnvironmentVariableTarget]::Process)
        Set-Variable -Name $k -Value $v -Scope Global -Force -ErrorAction SilentlyContinue

        $injected++
        Write-Host "   INJECT $k = $(maskSecret $v)"
    }
    Write-Host "[HANDS-FREE] T2-10 injection in-process: $injected/36 keys newly set (idempotent NFR-6: already-present skipped)"
} catch {
    failClosedExit5 "[T2-10] Injection FAIL: $_"
}

# ------------------------------------------------------------
# T2-11 Node 24.x check (NFR-9 optional warning)
# ------------------------------------------------------------
try {
    $nv = & node -v 2>$null
    if ($nv -match '^v(\d+)\.') {
        $major = [int]$Matches[1]
        if ($major -eq 24) { Write-Host "[HANDS-FREE] T2-11 node.js OK: $nv" }
        else { Write-Warning "[HANDS-FREE] T2-11 node.js=$nv, attendu v24.x (necessitent Node 24 LTS pour outils v358 en aval)." }
    } else { Write-Warning '[HANDS-FREE] T2-11 node -v non interpretable.' }
} catch {
    Write-Warning '[HANDS-FREE] T2-11 node.js introuvable (run-live-crypto-po.ps1 PS-only OK; outils paiement/ledger TypeScript en ont besoin).'
}

# ------------------------------------------------------------
# T2-12: Verify wrapper exists before call
# ------------------------------------------------------------
if (-not (Test-Path -LiteralPath $WRAPPER_PATH -PathType Leaf)) {
    failClosedExit5 "[T2-12] run-live-crypto-po.ps1 introuvable: $WRAPPER_PATH"
}

# ------------------------------------------------------------
# T2-13: Execute run-live-crypto-po.ps1 -Verbose, propagate LASTEXITCODE
# ------------------------------------------------------------
Write-Host ''
Write-Host '[HANDS-FREE] T2-12 EXEC -> call run-live-crypto-po.ps1'
Write-Host '------------------------------------------------------------'

$after = 0
try {
    & $WRAPPER_PATH -Verbose
    if ($global:LASTEXITCODE -ne $null -and $global:LASTEXITCODE -ne 0) { $after = $global:LASTEXITCODE }
} catch {
    Write-Host "[HANDS-FREE] Exception from run-live-crypto-po.ps1: $_"
    $after = 99
}

Write-Host '------------------------------------------------------------'
Write-Host "[HANDS-FREE] T2-13 run-live-crypto-po.ps1 exit code = $after"

if ($after -eq 0) {
    Write-Host ''
    Write-Host '[HANDS-FREE] SUCCESS v3.5.8'
    Write-Host '   -> Rapport: reports/secrets-payouts/00_final_master.json'
    Write-Host '   -> Logs   : logs/swarm_clickless/latest.json'
} else {
    Write-Host ''
    Write-Host "[HANDS-FREE] FAILED v3.5.8 exit=$after"
    Write-Host '   -> Logs: logs/swarm_clickless/latest.json'
}

Write-Host "[HANDS-FREE] END exit=$after"
exit $after
