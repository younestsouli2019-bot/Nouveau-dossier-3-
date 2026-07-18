# Changelog — 2026-01-13

## Architecture Improvements
- Introduced shared CLI args utility at `src/utils/cli.mjs` for consistent parsing.
- Refactored scripts to use shared parser:
  - `scripts/convert-legacy-csv-to-xls.mjs`
  - `scripts/execute-bitget-settlement.mjs`
  - `src/monitor-health.mjs`
  - `src/ap2-verify.mjs`
  - `src/sync-paypal-payout-batch.mjs`
  - `src/paypal-webhook-server.mjs`

## Settlement Enhancements
- Enhanced Bitget standalone settlement script:
  - Added CLI overrides: `--coin`, `--network`, `--address`, `--amount`.
  - Balance check now respects selected coin (e.g., TON).
  - Automatic manual instruction JSON generation on failure under `settlements/crypto/`.
- Executed TON micro-withdraw attempt via Bitget:
  - Exchange responded with permission error: `Incorrect permissions, need withdraw write permissions`.
  - Manual instruction JSONs queued for immediate manual execution.

## Verification
- Language diagnostics show no issues in updated files.
- Balance checks confirm TON availability; programmatic withdrawal requires enabling Bitget “withdraw write” permission.

