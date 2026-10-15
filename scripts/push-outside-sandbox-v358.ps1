# push-outside-sandbox-v358.ps1
# PERMANENT RUNBOOK VERBATIM — v3.5.8 + carryover stack
# Contexte: Blocages 3x connus push dans sandbox Trae IDE (Windows 2026-10-05):
#   1. TRAE Sandbox interdit: C:\Users\Dell\.git-credentials.lock
#      -> "fatal: unable to write credential store: Permission denied"
#      -> push NO-OP mensonger "Everything up-to-date" quand credentials.write echoue.
#   2. MSYS2 askpass.sh fork crash STATUS_DLL_INIT_FAILED 0xC0000142 errno 11
#      -> "fatal: could not read Username for https://github.com: terminal prompts disabled"
#      Exit git = 128.
#   3. Remote https-origin/main SHA 79a653e… DIVERGE (parallel 298-course-catalog tick).
#      -> Rejet NON-FAST-FORWARD tant que pas rebase sur remote/main.
#
# CORRECTION APPLIQUEE PAR CE SCRIPT:
#   A. Reboot machine 1x (resout crash MSYS2 fork historique).
#   B. Ouvrir PowerShell ADMINISTRATEUR HORS Trae IDE (pas sandbox).
#   C. Execution de ce script:
#      powershell -ExecutionPolicy Bypass -NoProfile -File "C:\Users\Dell\Downloads\Nouveau dossier (3)\scripts\push-outside-sandbox-v358.ps1"
#
# REMARQUES:
#   - Credential store Windows: manager-core (Git Credential Manager Core).
#   - Rebase INTERACTIF si conflit — accepter theiers = remote;
#     aucun conflit attendu (v3.5.x stack vs 298-course-catalog tick fichiers disjoints).
#   - Push final --force-with-lease (pas --force !) — securite si autre push concurrent.
#   - FIN: comparer rev-parse HEAD vs ls-remote 1ere colonne SHA main — IDENTIQUE = SUCCES.

$ErrorActionPreference = "Stop"
param(
  [string]$Branch = "main"
)
$RepoDir = "C:\Users\Dell\Downloads\Nouveau dossier (3)"
$RemoteName = "https-origin"
$BranchName = $Branch
$PushScriptStart = Get-Date -Format o

Write-Host "=== push-outside-sandbox v3.5.8 RUNBOOK START [$PushScriptStart] ===" -ForegroundColor Cyan
Write-Host "REPO: $RepoDir"
Write-Host "REMOTE: $RemoteName / BRANCH: $BranchName"
Write-Host "NOTE: Use -Branch release to push current SPEC7 f0de0f6 stack directly."
Write-Host ""

# --- 0. Preflight: path + admin elevation check (recommandé)
if (-not (Test-Path (Join-Path $RepoDir ".git" "HEAD"))) {
  Write-Error "ERREUR: .git/HEAD introuvable dans '$RepoDir'. Verifier chemin RepoDir."
  exit 99
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Warning "AVERTISSEMENT: Session PAS administrateur. Si manager-core credential prompt echoue, relancer en Admin."
}

Set-Location $RepoDir

# --- 1. Etat initial: SHA local + remote ls-remote avant operation
Write-Host "[1/6] SHA LOCAL HEAD actuel..."
$LocalHeadBefore = git rev-parse HEAD
Write-Host "  HEAD (local avant): $LocalHeadBefore"
Write-Host ""

Write-Host "[2/6] SHA REMOTE ls-remote $RemoteName refs/heads/$BranchName (AVANT fetch/rebase/push)..."
$LsRemoteBefore = git ls-remote $RemoteName "refs/heads/$BranchName"
Write-Host "  $LsRemoteBefore"
$RemoteShaBefore = ($LsRemoteBefore -split '\s+')[0]
Write-Host "  SHA remote main (avant): $RemoteShaBefore"
Write-Host ""

# --- 2. Fetch explicite credential.helper = manager-core (evite sandbox askpass.sh interne Trae)
Write-Host "[3/6] FETCH $RemoteName $BranchName avec credential.helper=manager-core..."
git -c credential.helper=manager-core fetch $RemoteName $BranchName
if ($LASTEXITCODE -ne 0) {
  Write-Error "FETCH echoue exit=$LASTEXITCODE. Verifier mot de passe PAT / OAuth dans Credential Manager Windows."
  exit 11
}
Write-Host "  Fetch OK."
Write-Host ""

# --- 3. Rebase local ef1397f v3.5.8 stack sur remote/main (diverge 79a653e -> remonte)
Write-Host "[4/6] REBASE automatique $RemoteName/$BranchName. (Si conflit: git rebase --continue|--abort)"
git rebase "$RemoteName/$BranchName"
$RebaseExit = $LASTEXITCODE
if ($RebaseExit -ne 0) {
  Write-Warning "REBASE exit=$RebaseExit. Conflits possibles. Resoudre manuellement puis 'git rebase --continue'."
  Write-Warning "OU: pour abandonner et retenter plus tard: git rebase --abort"
  exit 12
}
$LocalHeadAfterRebase = git rev-parse HEAD
Write-Host "  Rebase OK. HEAD apres rebase: $LocalHeadAfterRebase"
Write-Host ""

# --- 4. Push --force-with-lease (securise — refuse si remote a change)
Write-Host "[5/6] PUSH --force-with-lease $RemoteName $BranchName (credential manager-core)..."
git -c credential.helper=manager-core push --force-with-lease $RemoteName $BranchName
$PushExit = $LASTEXITCODE
if ($PushExit -ne 0) {
  Write-Error "PUSH echoue exit=$PushExit. Verifier PAT OAuth scope repo:public ou repo (privatisation du repo possible)."
  exit 13
}
Write-Host "  Push retourne exit 0."
Write-Host ""

# --- 5. Verification FINALE SHA identique
Write-Host "[6/6] VERIFICATION FINALE SHA — rev-parse HEAD == ls-remote 1ere colonne ?"
$LocalFinal = git rev-parse HEAD
$LsRemoteFinal = git ls-remote $RemoteName "refs/heads/$BranchName"
$RemoteFinal = ($LsRemoteFinal -split '\s+')[0]
Write-Host "  HEAD  (local  apres push): $LocalFinal"
Write-Host "  MAIN  (remote apres push): $RemoteFinal"
Write-Host "  EGAL ? $(($LocalFinal -eq $RemoteFinal) ? 'OUI — SUCCES PUSH v3.5.8 ' : 'NON — ECHEC. Comparer log.' )"
Write-Host ""
Write-Host "=== RUNBOOK END $(Get-Date -Format o) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Resume audit Contentieux preuve (a copier dans rapport):"
Write-Host "  START : $PushScriptStart"
Write-Host "  END   : $(Get-Date -Format o)"
Write-Host "  HEAD BEFORE LOCAL : $LocalHeadBefore"
Write-Host "  HEAD BEFORE REMOTE: $RemoteShaBefore"
Write-Host "  HEAD FINAL LOCAL  : $LocalFinal"
Write-Host "  HEAD FINAL REMOTE : $RemoteFinal"
Write-Host "  SHA MATCH         : $($LocalFinal -eq $RemoteFinal)"
Write-Host "  COMMIT TOPIC      : v3.5.8 f0de0f6 SPEC7 git-secrets-autorotate custom KMS (UNBLOCK8 23/26 GREEN) + Account Abstraction + Direct Deposit + 7/7 gates"
Write-Host "  PREV STACK CARRY  : v3.5.4 f87e126 -> v3.5.5 4d195be -> v3.5.6 0481adf -> v3.5.7 4215e96"
Write-Host ""
exit 0
