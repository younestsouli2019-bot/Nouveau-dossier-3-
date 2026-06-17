# Changelog

## v2 — 2026-06-17 (preventive hardening)

### Added
- **`guard-repo-integrity.yml`** — new CI workflow that fails on
  (a) dangling submodule gitlinks, (b) `actions/*@v4`, (c) leaked credentials.
  Runs on push, PR, and every 6h.
- **`doctor.mjs`** — local preflight that runs the same 3 checks + clean
  working tree + `.gitmodules` consistency.
- **`install-hook.sh`** — wires `doctor.mjs` as a git `pre-push` hook.
- **`push-all-fixes.mjs`** — API push that bumps ALL 7 workflows + adds the
  guard in one fast-forward commit.
- **`verify-v2.mjs`** — verifies all 7 workflows, the guard, and the latest
  run status (v1 only verified one workflow).
- **`repo-changes/` vs `tooling/` separation** — v1's kit files leaked into
  the repo root on merge; v2 keeps laptop-only tooling out of the tree.

### Changed
- Bumps `actions/checkout@v4`, `setup-node@v4`, `setup-python@v4`,
  `upload-artifact@v4`, `deploy-pages@v4` -> `@v5` across **all 7 workflows**
  (v1 only bumped `owner-handsfree-live.yml`).

### Security (urgent, manual)
- Flagged **12 leaked PayPal credentials** in `Mission_export (72).csv` from
  the uploaded `security_audit.json`. The guard will block *new* leaks; the
  already-committed creds must be **rotated** at PayPal and purged from
  history.

## v1 — 2026-06-17 (the fix that landed as 0ae4e4a)

### Fixed
- Removed dangling `.qodo/rank` submodule gitlink (mode `160000`, no
  `.gitmodules` URL) — unblocked `Owner Hands-Free (Live)` run #172
  (`git` exit 128 at checkout).
- Bumped `actions/checkout@v4` -> `@v5` and `actions/upload-artifact@v4` -> `@v5`
  in `owner-handsfree-live.yml` only.
- Added `submodules: false` to both checkout steps.

### Known gaps addressed by v2
- Only 1 of 7 workflows bumped.
- No preventive guard — same bug class could recur (and had recurred before
  as `rank_mirror` on 2026-05-30).
- No secret gate.
- Kit files (README, INVESTIGATION, *.mjs, *.patch, apply.sh) committed to
  repo root on merge.
