#!/bin/sh
# ============================================================
# CORE-PROTECT pre-commit hook — Layer 2/5 of the swarm
#   write-protect stack. Refuses any commit that adds/modifies/
#   removes a file on the 48-entry SWARM CORE critical list
#   unless ONE of the following is true:
#     (a) env SKIP_CORE_PROTECT=1          (local one-off)
#     (b) staged commit message carries the literal tag
#         "[CORE-UPDATE]" somewhere inside
#   Incident avoided: 2026-08-20T00:15 UTC commit 2762682c10
#   ups-lawis accidentally deleted .github/workflows/sync-
#   secrets.yml, gutted .gitignore (50 → 3 lines), and
#   re-added 183 tracked catalogue ZIP bloat files (~40 MB).
#   This hook aborts that exact failure mode BEFORE any
#   git object is written. Install / uninstall via:
#     pwsh scripts/guard/install-core-protect-hook.ps1
#     pwsh scripts/guard/install-core-protect-hook.ps1 -U
# ============================================================
set -eu

if [ "${SKIP_CORE_PROTECT:-0}" = "1" ]; then
  echo "[core-protect] SKIP_CORE_PROTECT=1 set; bypassing core gate." 1>&2
  exit 0
fi

# ------------------------------------------------------------------
# BEGIN CORE LIST — kept here intentionally so the hook is self-
# contained even without network / repo context. Must be kept in
# lock-step with:
#   scripts/guard/verify-core.ps1
#   scripts/guard/apply-attrib-readonly.ps1
#   .github/workflows/protect-core.yml
#   .gitattributes (-merge guard lines)
# ------------------------------------------------------------------
CORE_FILES="
.gitignore
.gitattributes
package.json
package-lock.json
prisma/schema.prisma
CHANGELOG.md
RELEASE_MANIFEST.json
.github/workflows/sync-secrets.yml
.github/workflows/deploy-pages.yml
.github/workflows/main.yml
.github/workflows/org-broadcast.yml
.github/workflows/protect-core.yml
scripts/swarm-autonomy-daemon.mjs
scripts/swarm-improve-loop.mjs
scripts/START-SWARM.cmd
scripts/STOP-SWARM.cmd
scripts/guard/core-integrity.sha256manifest
scripts/guard/verify-core.ps1
scripts/guard/apply-attrib-readonly.ps1
scripts/guard/install-core-protect-hook.ps1
scripts/guard/pre-commit.hook.sh
scripts/mirrors/sync-mirrors.cmd
scripts/mirrors/backup-doomsday-vault.local.cmd
scripts/mirrors/secure-cloud-upload.cmd
src/lib/atomic-simulation.ts
src/lib/audit-agent.ts
src/lib/escrow-vaults.ts
src/lib/settlement-engine.ts
src/lib/strict-enforcement/audit-reconciliation.ts
src/lib/owner-config.ts
src/lib/strict-enforcement/crypto-utils.ts
src/app/api/webhooks/github-secrets/route.ts
src/app/api/settlements/wet-run/route.ts
src/locking/distlock.py
src/locking/tests/test_distlock.py
src/locking/requirements.txt
contracts/escrow/CounterpartyEscrow.sol
contracts/escrow/interfaces/IHierarchicalEscrow.sol
contracts/escrow/libraries/UniqueStateHash.sol
contracts/escrow/ARCHITECTURE.md
src/agents/prompts/registry.json
src/agents/prompts/system-prompt-audit-critical.md
src/agents/prompts/system-prompt-duplicate-isolation.md
src/agents/prompts/1shot-cannibal-cluster-payoneer-9x150.md
src/agents/prompts/1shot-fabricated-proofhash.md
src/agents/prompts/tool-prompt-load-evidence-csv.md
src/agents/prompts/tool-prompt-quarantine-write.md
reports/policy/PRECAUTIONS_MATRIX.md
"

CHANGED="$(git diff --cached --name-only --diff-filter=ACMRT)"

HIT=""
for f in $CORE_FILES; do
  [ -z "$f" ] && continue
  if printf '%s\n' "$CHANGED" | grep -Fxq "$f"; then
    HIT="$HIT $f"
  fi
done

if [ -n "$HIT" ]; then
  MSG_BUFF=""
  for mf in .git/COMMIT_EDITMSG .git/MERGE_MSG; do
    if [ -f "$mf" ]; then MSG_BUFF="$MSG_BUFF $(cat "$mf")"; fi
  done
  if printf '%s' "$MSG_BUFF" | grep -q '\[CORE-UPDATE\]'; then
    echo "[core-protect] [CORE-UPDATE] tag found; allowing core change." 1>&2
    exit 0
  fi

  echo "********************************************************************************" 1>&2
  echo "[CORE-PROTECT] REFUSING commit. STAGED changes touch SWARM CORE critical files:" 1>&2
  for h in $HIT; do echo "   - $h"; done 1>&2
  echo "" 1>&2
  echo "Recent precedent for this gate: on 2026-08-20 commit 2762682c10 ups-lawis" 1>&2
  echo "accidentally DELETED .github/workflows/sync-secrets.yml (required to push" 1>&2
  echo "OPENROUTER/ZAI secrets from GitHub -> swarm app), gutted .gitignore (50 -> 3 lines)" 1>&2
  echo "and re-added 183 tracked catalogue ZIP bloat files (~40 MB)." 1>&2
  echo "" 1>&2
  echo "If this is a LEGITIMATE core update, use ONE of:" 1>&2
  echo "  A.  SKIP_CORE_PROTECT=1 git commit ...           # local one-off" 1>&2
  echo "  B.  git commit -m \"[CORE-UPDATE] <section>: <reason>\"   # audited, CI also OK" 1>&2
  echo "" 1>&2
  echo "CORE file allowlist lives in scripts/guard/pre-commit.hook.sh." 1>&2
  echo "********************************************************************************" 1>&2
  exit 1
fi
exit 0
