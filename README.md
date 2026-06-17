# Owner Hands-Free (Live) — CI Hardening Kit v2

**v2 upgrade of the fix kit.** v1 (commit `0ae4e4a`) successfully removed the
dangling `.qodo/rank` submodule and bumped `owner-handsfree-live.yml` to
`@v5`. v2 finishes the job across the **whole repo** and adds **preventive
guarding** so this class of failure cannot recur.

## What v1 did (already merged)

Commit `0ae4e4a` on `main`:
- Removed the dangling `.qodo/rank` gitlink (mode `160000`, no `.gitmodules` URL) — unblocked `Owner Hands-Free (Live)` run #172.
- Bumped `actions/checkout@v4`/`upload-artifact@v4` -> `@v5` in `owner-handsfree-live.yml` only.
- Added `submodules: false` guard to both checkout steps.

Result: **`Owner Hands-Free (Live)` checkout no longer fails with exit 128.**

## Why v2 is needed

After v1, an audit of the repo revealed three gaps:

1. **6 of 7 workflows still use deprecated `actions/*@v4`.** The Node 20
   deprecation warning (force-migrated to Node 24 on 2026-06-16) appears in
   every run of `ci.yml`, `cloud-watchdog.yml`, `deploy.yml`,
   `deploy-site-runner.yml`, `finance-diagnose-runner.yml`, `payout-now.yml`.
   `Khwarizmian Swarm CI #50` is currently failing partly on this.
2. **No prevention.** The `.qodo/rank` bug was the *second* dangling-gitlink
   failure on this system (`CoNrAd2525/swarm` had `rank_mirror` removed on
   2026-05-30 for the same reason). Without a CI gate, a third instance is
   inevitable.
3. **No secret gate.** The uploaded `security_audit.json` shows **12 leaked
   PayPal credentials** (client_id + client_secret) embedded in
   `Mission_export (72).csv`. The swarm ships `scan_credentials.py` that
   *detects* them, but no workflow *gates* on it — they ship to every checkout.

## What v2 does

### A. Bumps ALL 7 workflows to `@v5`

`push-all-fixes.mjs` fetches each workflow file via the GitHub API, rewrites
`actions/<name>@v4` -> `@v5` (leaving `@v4.x.y` major.minor pins untouched),
and commits all 7 in one fast-forward commit.

### B. Adds `guard-repo-integrity.yml`

A new workflow in `.github/workflows/` that runs on **push, PR, and every 6h**,
and FAILS the build if any of:

| Check | What it catches |
|-------|-----------------|
| 1. Dangling gitlink | Any `160000` tree entry with no `.gitmodules` URL (the `.qodo/rank` / `rank_mirror` bug) |
| 2. Deprecated actions | Any `actions/*@v4` reference in any workflow (Node 20 EOL) |
| 3. Leaked credentials | PayPal/Stripe/GitHub tokens / private keys via `scan_credentials.py` |

This is the **preventive** layer v1 lacked. The guard runs on its own commit
when you push it, so you immediately see a green (or red) check.

### C. Local doctor + pre-push hook

`doctor.mjs` runs the same three checks locally before you push, plus two
extras (clean working tree, `.gitmodules` consistency). `install-hook.sh`
wires it as a git `pre-push` hook so broken commits never leave your machine.

## Kit layout (clear separation, v1 lesson)

```
kit-v2/
├── README.md                          <- you are here
├── CHANGELOG.md                       <- v1 -> v2 diff
├── repo-changes/                      <- files that go INTO the repo
│   └── guard-repo-integrity.yml       <- new preventive CI workflow
└── tooling/                           <- laptop-only files (do NOT commit)
    ├── doctor.mjs                     <- local preflight
    ├── push-all-fixes.mjs             <- API push: bumps all workflows + adds guard
    ├── verify-v2.mjs                  <- post-push verifier (all workflows + guard)
    └── install-hook.sh                <- installs pre-push git hook
```

**v1 lesson applied:** v1's kit files (README, INVESTIGATION, apply.sh, *.mjs,
*.patch) got committed to the repo root by the merge — kit cruft in the
production tree. v2 keeps `tooling/` clearly separate; only
`repo-changes/guard-repo-integrity.yml` lands in the repo.

## How to apply v2

### Route A — API push (recommended, no clone)

```bash
export GH_TOKEN=ghp_xxx   # classic PAT `repo` scope
cd kit-v2
node tooling/push-all-fixes.mjs
node tooling/verify-v2.mjs
```

The push script:
1. Fetches each of the 7 workflow files from the API.
2. Rewrites `@v4` -> `@v5`, creates blobs.
3. Reads `repo-changes/guard-repo-integrity.yml`, creates a blob.
4. Builds a new tree on top of `main`, commits, fast-forwards (`force:false`).

### Route B — local clone + hook

```bash
git clone https://github.com/younestsouli2019-bot/Nouveau-dossier-3-.git
cd Nouveau-dossier-3-

# 1. Run the doctor to see current state
node /path/to/kit-v2/tooling/doctor.mjs .

# 2. Install the pre-push hook for future pushes
bash /path/to/kit-v2/tooling/install-hook.sh

# 3. Add the guard workflow
cp /path/to/kit-v2/repo-changes/guard-repo-integrity.yml .github/workflows/

# 4. Bump all workflows (sed, leaves @v4.x.y pins alone)
sed -i -E 's@(actions/[a-z-]+)@v4($|\\s)@\1@v5\2@g' .github/workflows/*.yml

# 5. Verify locally, then commit + push (hook runs doctor automatically)
node /path/to/kit-v2/tooling/doctor.mjs .
git add .github/workflows/
git commit -m "fix(ci): bump all workflows to @v5 + add guard-repo-integrity"
git push origin main
```

## After v2 lands

- The **guard-repo-integrity** workflow runs on the push commit itself and
  every 6h thereafter. A red guard run = someone introduced a dangling
  gitlink, an `@v4` action, or a hardcoded secret. Fix before merging.
- All 7 scheduled/on-push workflows now run on Node 24 natively — no more
  deprecation warnings, no more forced-migration risk on 2026-09-16.
- The `Owner Hands-Free (Live)` cron (`*/10 * * * *`) will proceed past
  checkout into the reconcile chain. If it then fails inside
  `validate-owner-routing-env` / `plaid-preflight` / `assert-live-chain`,
  that is a **separate** secrets/env problem — capture the annotations and
  trace from there.

## Security action item (urgent, out of scope for this kit)

The uploaded `security_audit.json` shows **12 exposures of PayPal live
credentials** in `Mission_export (72).csv`. After v2 lands, the guard will
*block* future such commits, but the **already-committed credentials must be
rotated** — they are in git history. Steps:

1. Rotate the PayPal client_id `AZYO-dwFY_...` and client_secret `EKAFqkcxpz...`
   at https://developer.paypal.com/dashboard/applications.
2. Purge the CSV from history (e.g. `git filter-repo --path 'Mission_export (72).csv' --invert-paths`) and force-push, OR at minimum ensure the new
   creds never enter git again (the guard now enforces this).
3. Re-issue any downstream services that consumed the old creds.

This kit does **not** do the rotation for you — it only stops the bleeding.

## Token safety

- Pass `GH_TOKEN` via env var, never commit it.
- The scripts only call `api.github.com` and print the commit URL.
- Revoke the PAT after the push if it was temporary.

## Provenance

v2 produced 2026-06-17, after reviewing the post-`0ae4e4a` repo state and the
uploaded `khwarizmian-swarm.zip` (which contained `security_audit.json` with
12 credential findings + `scan_credentials.py`).
