#!/bin/sh
# ============================================================
# CORE-PROTECT commit-msg hook — Layer 2/5 of the swarm
#   write-protect stack. Refuses any commit that adds/modifies/
#   removes a file on the SWARM CORE critical list
#   unless ONE of the following is true:
#     (a) env SKIP_CORE_PROTECT=1          (local one-off)
#     (b) the proposed commit message carries the literal tag
#         "[CORE-UPDATE]" somewhere inside
#
# WHY commit-msg AND NOT pre-commit:
#   git runs `pre-commit` BEFORE it obtains the commit message, so a
#   pre-commit hook can only ever read the PREVIOUS message out of
#   .git/COMMIT_EDITMSG. The tag check therefore read stale data and was
#   wrong in BOTH directions: it silently allowed an untagged CORE change
#   (whenever the previous commit happened to carry the tag) and refused a
#   correctly tagged one. githelp:githooks says pre-commit "takes no
#   parameters, and is invoked before obtaining the proposed commit log
#   message", whereas commit-msg "takes a single parameter, the name of the
#   file that holds the proposed commit log message". That parameter is $1.
#
# Incident avoided: 2026-08-20T00:15 UTC commit 2762682c10
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
# PROPOSED MESSAGE -- git hands us the path of the message file as $1.
# FAIL-CLOSED if we cannot read it: without the message we cannot tell a
# tagged (allowed) commit from an untagged (refused) one.
# ------------------------------------------------------------------
MSG_FILE="${1:-}"
if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
  echo "[core-protect] FAIL-CLOSED: commit-msg hook received no readable message file (arg='$MSG_FILE')." 1>&2
  exit 1
fi

# ------------------------------------------------------------------
# CORE LIST -- read from the single canonical allowlist. It used to be
# inlined here, which allowed it to drift from verify-core.ps1 /
# apply-attrib-readonly.ps1 / .gitattributes. It is no longer a copy.
# ------------------------------------------------------------------
ROOT_FOR_CORE="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
CORE_LIST_FILE="$ROOT_FOR_CORE/scripts/guard/core-files.txt"
if [ ! -f "$CORE_LIST_FILE" ]; then
  echo "[core-protect] FAIL-CLOSED: CORE list missing: $CORE_LIST_FILE" 1>&2
  exit 1
fi
# tr -d '\r': core.autocrlf=true hands a Windows checkout a CRLF copy of the
# list while `git diff --cached --name-only` emits LF paths. Without this the
# paths would never compare equal and the gate would silently stop blocking.
CORE_FILES="$(grep -vE '^[[:space:]]*(#|$)' "$CORE_LIST_FILE" | tr -d '\r')"

CHANGED="$(git diff --cached --name-only --diff-filter=ACMRTD)"

HIT=""
for f in $CORE_FILES; do
  [ -z "$f" ] && continue
  if printf '%s\n' "$CHANGED" | grep -Fxq "$f"; then
    HIT="$HIT $f"
  fi
done

if [ -n "$HIT" ]; then
  if grep -q '\[CORE-UPDATE\]' "$MSG_FILE"; then
    echo "[core-protect] [CORE-UPDATE] tag found in proposed message; allowing core change." 1>&2
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
  echo "CORE file allowlist lives in scripts/guard/core-files.txt." 1>&2
  echo "********************************************************************************" 1>&2
  exit 1
fi
exit 0
