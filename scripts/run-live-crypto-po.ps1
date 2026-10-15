#Requires -Version 5.1
<#
.SYNOPSIS
  Autonomous wrapper for LIVE CRYPTO SEND + PO DELIVERY AUDIT pipeline v3.5.8.
  - Injects 36 rail secrets IN-PROCESS (PowerShell env propagation FIX)
  - NO raw secrets stored in this file -- source from Windows Credential Manager / vault / GitHub secrets.
  - Executes sequentially: (1) owner payout release autorun, (2) PO proof fail-closed audit, (3) summary.
  - Fail-closed: if <8 secrets load -> NOOP exit 2 immediately.

.DESCRIPTION
  PERMANENT WORKAROUND PowerShell env propagation bug (child spawn inherits empty env block in older PS 5.1):
  We BOTH set $env:KEY = VALUE (for PS provider) AND [Environment]::SetEnvironmentVariable(k, v, 'Process')
  BEFORE calling node. This matches the autorun-owners-full-v354 harness pattern (process.env assign
  IN-PROCESS before execFileSync child spawn -- no .env files, no external propagation dependency).

  SOURCE SECRETS FROM (0 fabrication rule -- NEVER paste raw values below):
    - Windows Credential Manager: cmdkey /list -> Read via CredMan module or user interactive paste.
    - GitHub repo secrets: gh secret list -R younestsouli2019-bot/Nouveau-dossier-3- -> gh secret view <name>
    - User private vault: only YOU (Financial Supervisor, signataire CIN A337773) hold true values.

  USAGE (Admin HORS Trae sandbox recommended -- avoids askpass.sh MSYS2 crash + credential lock restriction):
    powershell -ExecutionPolicy Bypass -NoProfile -File scripts/run-live-crypto-po.ps1 -Verbose

.NOTES
  - Dossier Contentieux Attijariwafa $149k Phase 2 -- every output is AUDIT TRAIL EVIDENCE.
  - v3.5.8 L2 routing: preset wallet 0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7 (Arbitrum One USDC).
  - Phone rule (active): POs written ONLY if proof hash in out/received/ or exports/bank-wire/.
#>

[CmdletBinding()]
param(
  [switch]$SkipOwnerPayouts,
  [switch]$SkipPoAudit,
  [switch]$DryRunRail
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$SEP = ("=" * 90)
$PRESET_L2_WALLET = "0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot
try {
  if (-not (Test-Path "package.json")) { throw "FATAL: package.json not found at $RepoRoot (not in repo root)" }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "FATAL: node.exe not in PATH" }
  if (-not (Test-Path "out\received")) { New-Item -ItemType Directory -Path "out\received" -Force | Out-Null }
  if (-not (Test-Path "exports\bank-wire")) { New-Item -ItemType Directory -Path "exports\bank-wire" -Force | Out-Null }

  Write-Host $SEP
  Write-Host "CRITICAL FINANCIAL AGENT v3.5.8 -- LIVE RUN WRAPPER (ENV IN-PROCESS)"
  Write-Host "Dossier Contentieux: signataire Younes Tsouli CIN A337773 -- Agence 018 Rabat Agdal"
  Write-Host ("Timestamp: " + [DateTimeOffset]::UtcNow.ToString('o'))
  Write-Host $SEP
  Write-Host ""

  # =========================================================================
  # STEP 1: INJECT 36 ENV KEYS -- IN-PROCESS (PS5.1 propagation FIX)
  #   REPLACE EVERY $null VALUE WITH THE TRUE SECURE VALUE BEFORE RUN.
  #   0 FABRICATION: NEVER commit raw values. Placeholder = $null = NOT SET.
  # =========================================================================
  $SecretsToInject = [ordered]@{
    # --- Neon Postgres PROD (permanent: length 122 exact when valid) ---
    DATABASE_URL                          = $null
    # --- Live rail flags ---
    LIVE_BANK_API                         = $null
    # --- Attijariwafa PSD2 Contentieux branch 018 Rabat Agdal ---
    ATTIJARI_CLIENT_ID                    = $null
    ATTIJARI_CLIENT_SECRET                = $null
    ATTIJARI_API_BASE                     = $null
    ATTIJARI_PSD2_CODE                    = $null
    # --- Stripe Connect ---
    STRIPE_SECRET_KEY                     = $null
    STRIPE_ACCOUNT_ID                     = $null
    STRIPE_CONNECTED_ACCOUNT_ID           = $null
    # --- Payoneer Business ---
    PAYONEER_CLIENT_ID                    = $null
    PAYONEER_CLIENT_SECRET                = $null
    PAYONEER_ACCESS_TOKEN                 = $null
    # --- PayPal (v1 live + PPP2 CIP dossier CIP-MA-147672146951995880) ---
    PAYPAL_CLIENT_ID                      = $null
    PAYPAL_CLIENT_SECRET                  = $null
    PAYPAL_PPP2_CLIENT_ID                 = $null
    PAYPAL_PPP2_CLIENT_SECRET             = $null
    # --- USDC Legacy BSC sender (new routing = CEX direct L2) ---
    USDC_RPC_URL                          = $null
    USDC_SENDER_PRIVATE_KEY               = $null
    # --- CEX Direct Deposit (v3.5.8 L2 bypass L1 bridge gas) ---
    BINANCE_API_KEY                       = $null
    BINANCE_API_SECRET                    = $null
    BYBIT_API_KEY                         = $null
    BYBIT_API_SECRET                      = $null
    BITGET_API_KEY                        = $null
    BITGET_API_SECRET                     = $null
    # --- ERC-4337 Paymasters (v3.5.8 AA -- gasless send) ---
    PIMLICO_API_KEY                       = $null
    STACKUP_PAYMASTER_RPC                 = $null
    USE_ERC4337_PAYMASTER                 = $null
    # --- Zero-Gas L2 Ecosystems (v3.5.8 new) ---
    IMMUTABLE_API_KEY                     = $null
    LOOPRING_API_KEY                      = $null
    LOOPRING_ACCOUNT_ID                   = $null
    # --- Routing + execution gates (v3.5.8) ---
    CEX_DIRECT_DEPOSIT_ENABLED            = $null
    RELEASE_AMOUNT_OVERRIDE_USD           = $null
    OWNER_EXEC_UNLOCK                     = $null
    OWNER_HANDS_FREE_POLICY               = $null
    AUTO_CONFIRM_OWNER_BATCHES            = $null
    DAEMON_HANDS_FREE_TICK                = $null
  }

  Write-Host "[Step1] INJECTING 36 secrets IN-PROCESS (propagation-safe: env + Process scope BOTH set)"
  Write-Host "       (placeholder = null = NOT SET -- set true values from YOUR secure vault BEFORE run)"
  Write-Host ""
  $injectedCount = 0
  foreach ($k in $SecretsToInject.Keys) {
    $v = $SecretsToInject[$k]
    if ($null -ne $v -and [string]$v.Length -gt 0) {
      Set-Item -Path ("env:" + $k) -Value $v -Force | Out-Null
      [Environment]::SetEnvironmentVariable($k, [string]$v, [EnvironmentVariableTarget]::Process)
      $injectedCount++
      $vs = [string]$v
      if ($vs.Length -le 8) {
        $vMask = $vs
      } else {
        $vMask = ($vs.Substring(0,4) + "..." + $vs.Substring($vs.Length - 2, 2) + " len=" + $vs.Length)
      }
      Write-Host ("  [OK  ] " + $k + " -> " + $vMask)
    } else {
      $existingEnv = $null
      if (Test-Path ("env:" + $k)) { $existingEnv = Get-Item -Path ("env:" + $k) | Select-Object -ExpandProperty Value }
      $existingNet = [Environment]::GetEnvironmentVariable($k, [EnvironmentVariableTarget]::Process)
      $hasExisting = (-not [string]::IsNullOrEmpty($existingEnv)) -or (-not [string]::IsNullOrEmpty($existingNet))
      if ($hasExisting) {
        $preserved = if (-not [string]::IsNullOrEmpty($existingEnv)) { $existingEnv } else { $existingNet }
        Set-Item -Path ("env:" + $k) -Value $preserved -Force | Out-Null
        [Environment]::SetEnvironmentVariable($k, [string]$preserved, [EnvironmentVariableTarget]::Process)
        $injectedCount++
        if ($preserved.Length -le 8) {
          $pMask = [string]$preserved
        } else {
          $pMask = ($preserved.Substring(0,4) + "..." + $preserved.Substring($preserved.Length - 2, 2) + " len=" + $preserved.Length)
        }
        Write-Host ("  [PRES] " + $k + " -> " + $pMask + " (inherited from parent Process env, preserved)")
      } else {
        if (Test-Path ("env:" + $k)) { Remove-Item -Path ("env:" + $k) -Force }
        [Environment]::SetEnvironmentVariable($k, $null, [EnvironmentVariableTarget]::Process)
        Write-Host ("  [SKIP] " + $k + " -> placeholder null (MISSING FROM SECURE INJECTION POINT)")
      }
    }
  }
  Write-Host ""
  if ($injectedCount -ge 8) {
    Write-Host ("Injected secrets: " + $injectedCount + " / " + $SecretsToInject.Count) -ForegroundColor Green
  } else {
    Write-Host ("Injected secrets: " + $injectedCount + " / " + $SecretsToInject.Count) -ForegroundColor Yellow
  }

  # =========================================================================
  # STEP 2: FAIL-CLOSED GATE -- if <8 secrets loaded OR any mandatory key missing -> STOP exit 2
  # =========================================================================
  Write-Host ""
  Write-Host "[Step2] FAIL-CLOSED GATE CHECK: require >=8 secrets AND DATABASE_URL len>=120 AND BINANCE creds set AND OWNER_EXEC_UNLOCK len>=43"
  $gateSecrets = ($injectedCount -ge 8)
  $dbUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL','Process')
  $gateDb = [bool]$dbUrl -and ($dbUrl.Length -ge 120)
  $bKey = [Environment]::GetEnvironmentVariable('BINANCE_API_KEY','Process')
  $bSec = [Environment]::GetEnvironmentVariable('BINANCE_API_SECRET','Process')
  $gateCex = [bool]$bKey -and [bool]$bSec
  $unlock = [Environment]::GetEnvironmentVariable('OWNER_EXEC_UNLOCK','Process')
  $gateUnlock = [bool]$unlock -and ($unlock.Length -ge 43)
  $allGates = ($gateSecrets -and $gateDb -and $gateCex -and $gateUnlock)

  $g1txt = if ($gateSecrets) { ("PASS (" + $injectedCount + " loaded)") } else { ("FAIL (" + $injectedCount + " loaded)") }
  $g2txt = if ($gateDb) { "PASS (len=" + $dbUrl.Length + ")" } else { "FAIL (no DATABASE_URL or len<120)" }
  $g3txt = if ($gateCex) { "PASS" } else { "FAIL (BINANCE_API_KEY / SECRET MISSING)" }
  $g4txt = if ($gateUnlock) { ("PASS (len=" + $unlock.Length + ")") } else { "FAIL (OWNER_EXEC_UNLOCK len < 43)" }
  Write-Host ("  G1 secrets >= 8: " + $g1txt)
  Write-Host ("  G2 DATABASE_URL len>=120: " + $g2txt)
  Write-Host ("  G3 BINANCE creds: " + $g3txt)
  Write-Host ("  G4 OWNER_EXEC_UNLOCK len>=43: " + $g4txt)

  if ($allGates) {
    Write-Host "  ALL GATES: PASSED --> proceed live execution" -ForegroundColor Green
  } else {
    Write-Host "  ALL GATES: BLOCKED --> FAIL-CLOSED NOOP (0 DB write, 0 CEX call)" -ForegroundColor Red
  }
  Write-Host ""

  if (-not $allGates) {
    Write-Warning "GATE FAIL -- early exit 2 per fail-closed doctrine. No external calls made."
    Write-Warning "To UNBLOCK: edit this script (scripts/run-live-crypto-po.ps1) Step1 $SecretsToInject. Replace 8 key values from your vault, THEN re-run."
    Write-Host ""
    Write-Host "Minimal unblock injection set (8 values -- enable crypto send to Arbitrum preset L2 wallet):"
    Write-Host "  1. DATABASE_URL                  (len=122 Neon postgres PROD)"
    Write-Host "  2. LIVE_BANK_API                 = true"
    Write-Host "  3. BINANCE_API_KEY               (official Binance Spot withdrawal perm)"
    Write-Host "  4. BINANCE_API_SECRET            (matching Ed25519 or HMAC secret)"
    Write-Host "  5. OWNER_EXEC_UNLOCK             (any high-entropy len>=43, e.g. 3x UUID concat)"
    Write-Host "  6. OWNER_HANDS_FREE_POLICY       = true"
    Write-Host "  7. CEX_DIRECT_DEPOSIT_ENABLED    = true    (AUTO network -> ARBITRUM not BSC)"
    Write-Host "  8. RELEASE_AMOUNT_OVERRIDE_USD   = 60      (releases BC646 held=$63.67 even if <$120 default)"
    exit 2
  }

  # =========================================================================
  # STEP 3: Run pipeline (gates PASSED)
  # =========================================================================
  $AuditLine = @()
  $AuditLine += "[AUDIT WRAPPER START] $(Get-Date -Format o)"
  $AuditLine += ("  injected_secrets=" + $injectedCount)

  # Optional: CryptoRail DRY RUN first (if -DryRunRail)
  if ($DryRunRail) {
    Write-Host "[DryRunRail] Running CryptoRailManager.checkRails() + submit dryRun (no side effects, no CEX calls)..."
    $dryJs = (
      "import { CryptoRailManager, SUPPORTED_NETWORKS, getOwnerCryptoAddresses } from './src/crypto/crypto-rail.mjs';" + [Environment]::NewLine +
      "(async () => {" + [Environment]::NewLine +
      "  const PRESET = `"$PRESET_L2_WALLET`";" + [Environment]::NewLine +
      "  const mgr = new CryptoRailManager();" + [Environment]::NewLine +
      "  const rails = await mgr.checkRails();" + [Environment]::NewLine +
      "  console.log('== CryptoRail.checkRails() LIVE INVENTORY ==');" + [Environment]::NewLine +
      "  console.log(JSON.stringify({ networks: rails.networks, directDepositEnabled: rails.directDepositEnabled, destinationL2: rails.destinationL2, SUPPORTED_NETWORKS: SUPPORTED_NETWORKS, allowedAddrsLoaded: getOwnerCryptoAddresses().size }, null, 2));" + [Environment]::NewLine +
      "  console.log('');" + [Environment]::NewLine +
      "  console.log('== submit({dryRun:true, amount:60, network:AUTO, providers:[binance]}) ==');" + [Environment]::NewLine +
      "  try {" + [Environment]::NewLine +
      "    const result = await mgr.submit({ address: PRESET, amount: 60, idempotencyKey: 'WRAPPER-DRYRUN-' + Date.now(), dryRun: true, providers: ['binance'], network: 'AUTO' });" + [Environment]::NewLine +
      "    console.log('submit dryRun result:', JSON.stringify(result, null, 2));" + [Environment]::NewLine +
      "  } catch (e) {" + [Environment]::NewLine +
      "    console.log('submit dryRun THREW code=' + (e.code || 'n/a') + ':', e.message);" + [Environment]::NewLine +
      "  }" + [Environment]::NewLine +
      "})().catch(e => { console.error('FATAL rail dryrun:', e); process.exit(3); });"
    )
    $dryJs | & node --input-type=module 2>&1 | ForEach-Object { Write-Host ("  [node] " + $_); $AuditLine += ("  [rail-dryrun] " + $_) }
    if ($LASTEXITCODE -ne 0) { Write-Warning ("Rail dryrun exited " + $LASTEXITCODE + " (non-fatal if missing flags are reason)") }
  }

  # (A) Owner payout full autorun S0..S6 -- unless -SkipOwnerPayouts
  if (-not $SkipOwnerPayouts) {
    Write-Host ""
    Write-Host "[Step3a] RUNNING autorun-owners-full-v354.mjs --> releaseOwnerFunds (BC646 held=63.67 USD -> override=60 -> preset Arbitrum L2)"
    Write-Host ("  Expected route: railClass=L2_CRYPTO_DIRECT_CEX, preferredNetwork=arbitrum, destination=" + $PRESET_L2_WALLET.Substring(0,8) + "..." + $PRESET_L2_WALLET.Substring($PRESET_L2_WALLET.Length-4,4))
    $AuditLine += ("[autorun-owners-full] START (override_USD=" + [Environment]::GetEnvironmentVariable('RELEASE_AMOUNT_OVERRIDE_USD','Process') + ")")
    & node scripts/autorun-owners-full-v354.mjs 2>&1 | ForEach-Object { Write-Host ("  [autorun] " + $_); $AuditLine += ("  [autorun] " + $_) }
    $exitAutorun = $LASTEXITCODE
    if ($exitAutorun -eq 0) {
      Write-Host ("  autorun exit code: " + $exitAutorun) -ForegroundColor Green
    } else {
      Write-Host ("  autorun exit code: " + $exitAutorun) -ForegroundColor Red
    }
    $AuditLine += ("[autorun-owners-full] EXIT=" + $exitAutorun)
  }

  # (B) PO receipts fail-closed audit -- unless -SkipPoAudit
  if (-not $SkipPoAudit) {
    Write-Host ""
    Write-Host "[Step3b] RUNNING po-receipts-failclosed-audit-v355.mjs --> scan out/received + exports/bank-wire"
    Write-Host "  Doctrine: 0 fabrication. Write ONLY where proof hash AND orderRef AND recipient MATCH (3-way strict)."
    $AuditLine += "[po-audit-failclosed] START watched=[out/received,exports/bank-wire]"
    if (Test-Path "scripts/po-receipts-failclosed-audit-v355.mjs") {
      & node scripts/po-receipts-failclosed-audit-v355.mjs 2>&1 | ForEach-Object { Write-Host ("  [poaudit] " + $_); $AuditLine += ("  [poaudit] " + $_) }
      $exitPo = $LASTEXITCODE
      if ($exitPo -eq 0) {
        Write-Host ("  po-audit exit code: " + $exitPo) -ForegroundColor Green
      } else {
        Write-Host ("  po-audit exit code: " + $exitPo) -ForegroundColor Yellow
      }
      $AuditLine += ("[po-audit-failclosed] EXIT=" + $exitPo)
    } else {
      Write-Host "  [WARN] Script scripts/po-receipts-failclosed-audit-v355.mjs NOT FOUND -- skip PO audit"
      $AuditLine += "[po-audit-failclosed] SCRIPT_NOT_FOUND (skip)"
    }
  }

  # =========================================================================
  # STEP 4: Write audit trail append-only to disk (Contentieux dossier evidence)
  # =========================================================================
  $AuditDir = Join-Path $RepoRoot "data\out\audit"
  if (-not (Test-Path $AuditDir)) { New-Item -ItemType Directory -Path $AuditDir -Force | Out-Null }
  $AuditFile = Join-Path $AuditDir ("run-live-crypto-po_" + (Get-Date -Format "yyyyMMdd_HHmmss_UTC") + ".ndjson")
  $AuditLine | ForEach-Object {
    $obj = [PSCustomObject]@{ ts = Get-Date -Format o; line = $_ }
    Add-Content -Path $AuditFile -Value (ConvertTo-Json $obj -Compress) -Encoding UTF8
  }
  Write-Host ""
  Write-Host $SEP
  Write-Host ("[FINAL] Audit trail written to: " + $AuditFile)
  Write-Host "  This file is HMAC-append-only candidate for AuditLedger table in Neon -- use finagent-hmac.mjs to seal."
  Write-Host $SEP
  exit 0
} finally {
  Pop-Location
}
