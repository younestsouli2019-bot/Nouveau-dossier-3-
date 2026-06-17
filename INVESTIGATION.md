# Investigation: Owner Hands-Free (Live) — Run #172 Failure

- **Repo:** `younestsouli2019-bot/Nouveau-dossier-3-` (public)
- **Workflow:** `Owner Hands-Free (Live)` — file `.github/workflows/owner-handsfree-live.yml`
- **Run:** #172 — ID `27667269310`
- **Trigger:** schedule (cron `*/10 * * * *`)
- **Commit:** `aea38a7` on `main`
- **Conclusion:** Failure, total duration ~20 s
- **When:** 2026-06-17 05:10 UTC

## Run annotations (2 errors, 3 warnings)

| # | Level | Message |
|---|-------|---------|
| 1 | error | `The process '/usr/bin/git' failed with exit code 128` |
| 2 | error | `The process '/usr/bin/git' failed with exit code 128` |
| 3 | warn  | `No url found for submodule path '.qodo/rank' in .gitmodules` |
| 4 | warn  | `Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: actions/checkout@v4, actions/upload-artifact@v4. Actions will be forced to run with Node.js 24 by default starting June 16th, 2026.` |
| 5 | warn  | `No files were found with the provided path: swarm/exports/reports/*. No artifacts will be uploaded.` |

Annotation #5 is a **downstream** symptom: the job died at checkout before any
script produced reports, so the artifact upload had nothing to upload.

## Workflow structure (the relevant steps)

```yaml
on:
  workflow_dispatch: {}
  schedule:
    - cron: "*/10 * * * *"

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout swarm repo              # <- checks out CoNrAd2525/swarm
        uses: actions/checkout@v4
        with:
          repository: ${{ vars.SWARM_REPO || 'CoNrAd2525/swarm' }}
          ref: ${{ vars.SWARM_REF || 'master' }}
          path: swarm
          fetch-depth: 0
      - name: Checkout runner control repo (overrides)   # <- checks out THIS repo
        uses: actions/checkout@v4
        with:
          fetch-depth: 1
          path: .runner
      - uses: actions/setup-node@v4
      - run: npm ci
        working-directory: swarm
      - name: Apply overrides                  # python copy of .runner/overrides -> swarm
      - name: Live reconcile + owner settlement (gated)   # the real work
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
```

## Root cause — pinned from tree state

The `actions/checkout@v4` of **this repo** (the `path: .runner` step) hit a
submodule gitlink that has no URL:

```
$ git ls-tree HEAD .qodo/
160000 commit a239ad56c5b4428578dc611b527f53cb6887102e  .qodo/rank
$ git cat-file -e HEAD:.gitmodules
fatal: path '.gitmodules' does not exist in 'HEAD'
```

- Mode `160000` = gitlink (submodule pointer).
- No `.gitmodules` = no URL registered for `.qodo/rank`.
- `git checkout -f` therefore cannot resolve the submodule and exits **128**.

This matches annotation #3 exactly: *"No url found for submodule path
'.qodo/rank' in .gitmodules"*.

## Why this is recurring

The schedule fires every 10 minutes, so every run hits the same dangling
gitlink. Recent runs #168-#172 are all 20-55 s long (i.e. dying at the same
spot), confirming a deterministic, not flaky, failure.

## Why the `.qodo/rank` gitlink exists

The repo has a `.qodo/` directory (Qodo / CodiumAI profiler metadata). At some
point `.qodo/rank` was added as a submodule (commit `a239ad5` on 2026-01-12).
The `.gitmodules` entry was later removed (or never committed), leaving the
gitlink dangling. The sibling external repo `CoNrAd2525/swarm` had the same
class of bug with `rank_mirror` — there is a commit titled
*"fix: remove broken rank_mirror submodule"* on 2026-05-30 — which is the
template fix for this exact issue.

## The fix

Two independent, both-correct changes in one commit:

### 1. Remove the dangling gitlink (the actual blocker)

```bash
git rm --cached .qodo/rank
```

This deletes the `160000` tree entry. The `.qodo/` directory itself is not a
submodule and is unaffected.

### 2. Bump deprecated actions + defensive `submodules: false`

```diff
-        uses: actions/checkout@v4
+        uses: actions/checkout@v5
         with:
           ...
           fetch-depth: 0
+          submodules: false
           path: swarm
```

- `@v5` runs on Node 24 (clears deprecation warning #4).
- `submodules: false` is explicit (default is already false, but making it
  explicit prevents any future `submodules: true` + dangling-gitlink
  combination from re-breaking checkout).

Same treatment for the second checkout (`path: .runner`) and for
`actions/upload-artifact@v4 -> @v5`.

## Evidence the fix is correct

- The workflow file's later steps (`validate-owner-routing-env`,
  `plaid-preflight`, `base44-preflight`, `assert-live-chain`,
  `auto-confirm-bank-settlements`, ...) never executed in run #172 — they
  were unreachable behind the checkout failure. Removing the gitlink unblocks
  them.
- The 404 "no reports" warning is downstream of the checkout failure and will
  disappear once the job runs end-to-end.

## What this fix does NOT address

If, after the fix, a subsequent run fails **inside** the reconcile chain
(e.g. `assert-live-chain` aborts because a `BASE44_*` / `PAYONEER_*` /
`PLAID_*` secret is missing or a token is expired), that is a **separate**
secrets/environment problem. The fix kit only resolves the git-128 checkout
blocker and the Node-20 deprecation.

## Verification commands (post-push)

```bash
# Confirm gitlink gone:
git clone https://github.com/younestsouli2019-bot/Nouveau-dossier-3-.git
cd Nouveau-dossier-3-
git ls-tree HEAD .qodo/            # should print nothing
git cat-file -e HEAD:.gitmodules   # still absent (expected — we removed the gitlink, not added a .gitmodules)

# Confirm workflow bumped:
grep -nE 'uses: actions/(checkout|upload-artifact)@|submodules:' .github/workflows/owner-handsfree-live.yml
# expected:
#   16:        uses: actions/checkout@v5
#   23:          submodules: false
#   26:        uses: actions/checkout@v5
#   30:          submodules: false
#  107:        uses: actions/upload-artifact@v5
```

Or use the bundled `verify-fix.mjs` (uses the GitHub API, no clone needed).
