# T3 Push Runbook HORS Trae Sandbox (NG6 Compliant)

> NG6 DOCTRINE: NEVER run `git push` inside Trae sandbox. Use Admin PowerShell OUTSIDE Trae IDE.

## A. Prérequis (Admin PowerShell HORS Trae)

- Close Trae IDE FULLY (all windows)
- Open PowerShell as **Administrateur** (Run as Administrator)
- Ensure Git Credential Manager Core is configured: `git credential-manager-core version`
- Current working dir is repo root

## B. Étapes d'exécution (6 pas)

```powershell
# Step 1: Nav to repo
cd "C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)"

# Step 2: Clear stale credential locks (NG6 MSYS2 crash fix)
Remove-Item -Force -ErrorAction SilentlyContinue "$env:USERPROFILE\.git-credentials.lock"

# Step 3: Config local identity (if missing)
git config user.name "Younes Tsouli (Signataire CIN A337773)"
git config user.email "younes.tsouli.signataire-a337773@proton.me"

# Step 4: Fetch remote with manager-core bypass (CRITICAL for sandbox lock)
git -c credential.helper=manager-core fetch https-origin

# Step 5: Rebase ours to resolve parallel 298-course-catalog divergence (FORCE-WITH-LEASE ONLY, NEVER --NUKE)
git -c credential.helper=manager-core rebase -X ours https-origin/main

# Step 6: Push with force-with-lease (fail-closed if remote changed behind our back)
git -c credential.helper=manager-core push --force-with-lease https-origin HEAD:main
```

## C. Template de vérification SHA

After Step 6, run this equality check:

```powershell
$LOCAL_SHA = "9a5bc44d8bd86da17849795acda9412aff6e2989"
$REMOTE_SHA = git rev-parse https-origin/main
$EQUALITY = if ($LOCAL_SHA -eq $REMOTE_SHA) { "✅ OK - SHA local == remote" } else { "❌ FAIL - divergence detected, re-run Step 4-6" }
Write-Host "LOCAL  = $LOCAL_SHA"
Write-Host "REMOTE = $REMOTE_SHA"
Write-Host "STATUS = $EQUALITY"
```

> Expected result: STATUS = ✅ OK
