# Owner Hands-Free (Live) — CI Fix Kit

Self-contained kit to fix the failing **"Owner Hands-Free (Live)"** GitHub Actions
workflow run #172 in `younestsouli2019-bot/Nouveau-dossier-3-`.

## Root cause (one paragraph)

Run #172 failed with `git exit code 128` during the `actions/checkout` step.
The repo tree contained a submodule **gitlink** at `.qodo/rank` (git mode
`160000`, pinned to commit `a239ad5...`) but **no `.gitmodules` file** existed,
so git had no URL for the submodule and aborted checkout ~20 s into the run,
before any reconcile/settlement script ran. The same failure recurred every
10 min (cron `*/10 * * * *`). A secondary deprecation warning flagged that
`actions/checkout@v4` and `actions/upload-artifact@v4` run on Node.js 20,
which is force-migrated to Node 24 from 2026-06-16.

## What this commit changes

1. **Removes the dangling `.qodo/rank` gitlink** from the repo tree (the actual
   blocker that caused `git` exit 128).
2. **Bumps `actions/checkout@v4` -> `@v5`** and **`actions/upload-artifact@v4` -> `@v5`**
   (Node 24 native — clears the deprecation).
3. **Adds explicit `submodules: false`** to both checkout steps as a defensive
   guard against any future dangling gitlink.

Files changed (2):
```
M  .github/workflows/owner-handsfree-live.yml   (3 action bumps + 2 submodules:false)
D  .qodo/rank                                    (dangling submodule gitlink removed)
```

Local commit produced by the autonomous investigation: `433ea48`.

## Contents of this kit

| File | What it is |
|------|------------|
| `README.md` | This file. |
| `INVESTIGATION.md` | Full root-cause write-up with the exact run annotations and evidence trail. |
| `owner-handsfree-live.yml` | The fixed workflow file (drop-in replacement). |
| `0001-fix-ci-remove-dangling-qodo-rank-submodule-bump.patch` | A `git am`-applicable patch of the full commit. |
| `push-owner-handsfree-fix.mjs` | **Server-side API push script.** Replays the commit via GitHub Git Data API — needs only a token, no local clone. |
| `verify-fix.mjs` | Post-push verifier. Confirms the commit landed, the gitlink is gone, the workflow file is updated, and reports the latest run status. |

## How to apply the fix — pick ONE

All three routes produce the identical commit on `main`.

### Route A — API push (recommended, no clone)

Requires a GitHub token with write access to `Nouveau-dossier-3-`:
- Classic PAT: `repo` scope (or `public_repo` if the repo stays public).
- Fine-grained PAT: **Contents: Read and write** + **Metadata: Read**.

```bash
export GH_TOKEN=ghp_your_token_here
node push-owner-handsfree-fix.mjs
node verify-fix.mjs
```

The push script fast-forwards `main` with `force:false`, so it aborts safely if
`main` has moved since the investigation (no clobber). Re-run after a `git pull`
in that case.

### Route B — local git + patch

```bash
git clone https://github.com/younestsouli2019-bot/Nouveau-dossier-3-.git
cd Nouveau-dossier-3-
git am < 0001-fix-ci-remove-dangling-qodo-rank-submodule-bump.patch
git push origin main
```

### Route C — manual file replacement

```bash
git clone https://github.com/younestsouli2019-bot/Nouveau-dossier-3-.git
cd Nouveau-dossier-3-
cp /path/to/owner-handsfree-live.yml .github/workflows/owner-handsfree-live.yml
git rm --cached .qodo/rank
git add .github/workflows/owner-handsfree-live.yml
git commit -m "fix(ci): remove dangling .qodo/rank submodule + bump checkout/artifact to v5"
git push origin main
```

## After the push lands

- The next scheduled run (every 10 min) will pick up the fix automatically, or
  trigger manually: **Actions tab -> Owner Hands-Free (Live) -> Run workflow**.
- The run should now pass checkout and `npm ci`, then proceed into the
  reconcile/settlement chain:
  `validate-owner-routing-env` -> `plaid-preflight` -> `base44-preflight` ->
  `payoneer-preflight` -> `assert-live-chain` -> `auto-confirm-bank-settlements`
  -> `report-finance-state` / `report-system-snapshot` -> (optional)
  `auto-settle-owner-daemon`.
- If it fails **inside** that chain (e.g. `assert-live-chain` or a preflight),
  that is a **separate** secrets/env problem — not the git-128 blocker, which
  this kit resolves. Capture the new annotations and trace from there.

## Token safety

- Never commit a token. Pass it via the `GH_TOKEN` env var.
- Revoke the PAT immediately after the push if it was temporary.
- The scripts in this kit only call `api.github.com` and print the resulting
  commit URL; they do not exfiltrate the token.

## Provenance

Produced by an autonomous investigation on 2026-06-17. The job log itself was
behind GitHub sign-in ("Sign in to view logs"), so the root cause was pinned
from the run **annotations** + the **repo tree state**, which agree
unambiguously:

```
error   The process '/usr/bin/git' failed with exit code 128
error   The process '/usr/bin/git' failed with exit code 128
warn    No url found for submodule path '.qodo/rank' in .gitmodules
warn    Node.js 20 actions are deprecated ... actions/checkout@v4, actions/upload-artifact@v4
warn    No files were found with the provided path: swarm/exports/reports/*
```

```
$ git ls-tree HEAD .qodo/
160000 commit a239ad56c5b4428578dc611b527f53cb6887102e  .qodo/rank
$ git cat-file -e HEAD:.gitmodules
fatal: path '.gitmodules' does not exist in 'HEAD'
```
