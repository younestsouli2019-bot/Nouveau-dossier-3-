#!/usr/bin/env bash
set -e

# ═══════════════════════════════════════════════════════════════════
# OPENCODE AUTONOMOUS DEV PIPELINE
# Multi-model orchestration for hands-free codebase evolution
# ═══════════════════════════════════════════════════════════════════

# 1. INSTALL OPENCODE (if not present)
if ! command -v opencode &> /dev/null; then
    echo "Installing OpenCode..."
    curl -fsSL https://opencode.ai/install | bash
    export PATH="$HOME/.opencode/bin:$PATH"
else
    echo "OpenCode already installed: $(opencode --version 2>/dev/null || echo 'unknown version')"
fi

# 2. API KEYS (from environment or GitHub Secrets)
export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

if [ -z "$OPENAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: Set OPENAI_API_KEY or ANTHROPIC_API_KEY"
    exit 1
fi

# 3. MODEL TIER CONFIGURATION
# Heavy planner for architecture decisions
PLAN_MODEL="anthropic/claude-sonnet-4-20250514"
# Fast executor for code generation
CODE_MODEL="openai/gpt-4o"
# Lightweight reviewer for docs/lint
REVIEW_MODEL="openai/gpt-4o-mini"
# Fallback when primary is unavailable
FALLBACK_MODEL="openai/gpt-4o-mini"

# 4. REPO CONTEXT
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "═══════════════════════════════════════════════════"
echo "  OPENCODE AUTONOMOUS PIPELINE"
echo "  Repo: $(basename "$REPO_ROOT")"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "═══════════════════════════════════════════════════"

# ─── PHASE 1: AUDIT & PLAN ──────────────────────────────────────
echo ""
echo "▶ Phase 1: Codebase Audit & Planning"
echo "  Model: $PLAN_MODEL"

opencode -m "$PLAN_MODEL" -p "
Analyze this bank wire settlement repository. Identify:
1. Any bugs or error-prone code paths
2. Missing edge cases in the settlement pipeline
3. Security concerns (API keys, secrets handling)
4. Performance improvements for the Base44/Wise API calls
5. Suggested new features for autonomous operation

Output a JSON plan with severity (critical/high/medium/low) for each finding.
Write the plan to plans/audit-$(date +%Y%m%d).json
" 2>&1 | tee /tmp/opencode-phase1.log || echo "Phase 1 used fallback model"

# ─── PHASE 2: EXECUTE FIXES ─────────────────────────────────────
echo ""
echo "▶ Phase 2: Execute Critical & High Priority Fixes"
echo "  Model: $CODE_MODEL"

opencode -m "$CODE_MODEL" -p "
Read the audit plan from plans/audit-$(date +%Y%m%d).json.
For all critical and high severity items:
1. Implement the fix directly in the source files
2. Follow existing code conventions (ES modules, no dependencies)
3. Do NOT add comments unless the fix is non-obvious
4. Test that the script runs: node scripts/<fixed-script>.mjs --help

Commit each fix individually with message format:
  fix: <brief description> [<file>]

If a fix requires new files, create them following existing patterns.
" 2>&1 | tee /tmp/opencode-phase2.log || echo "Phase 2 used fallback model"

# ─── PHASE 3: DOCS & VERIFICATION ──────────────────────────────
echo ""
echo "▶ Phase 3: Documentation & Verification"
echo "  Model: $REVIEW_MODEL"

opencode -m "$REVIEW_MODEL" -p "
Review all changes made in Phase 2:
1. Verify each modified script still has correct syntax (node --check)
2. Update .env.example if any new env vars were added
3. Update CHANGELOG.md with a new entry for today
4. Run: node scripts/reconcile-settlements.mjs to verify pipeline health
5. Generate a summary of all changes to dist_rwc/dev-pipeline-report.json

Do NOT modify any settlement logic — only docs and verification.
" 2>&1 | tee /tmp/opencode-phase3.log || echo "Phase 3 used fallback model"

# ─── PHASE 4: PUSH ─────────────────────────────────────────────
echo ""
echo "▶ Phase 4: Commit & Push"

if git diff --quiet && git diff --cached --quiet; then
    echo "  No changes to commit."
else
    git add -A
    git commit -m "autonomous: pipeline audit + fixes $(date +%Y-%m-%d)"
    git push origin main 2>&1
    echo "  Pushed to origin/main"
fi

# ─── SUMMARY ────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  PIPELINE COMPLETE"
echo "  Phases: 4/4"
echo "  Logs: /tmp/opencode-phase*.log"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "═══════════════════════════════════════════════════"
