# 🔐 Pre-Set Owner Accounts — Disbursement Architecture

## Overview

Implements the **platform-mediated settlement with auto-payout to pre-set owner accounts** pattern.

```
Buyer → Platform Settlement Account → [verify + split + fee deduct] → Auto-payout to Pre-Set Owner Account
```

This is what Stripe Connect, Adyen MarketPay, and Wise Platform do under the hood:
funds touch the platform briefly (for compliance), then auto-payout to the owner's
pre-registered, KYC-verified account.

---

## Why Not Direct-to-Owner?

| Reason | Explanation |
|--------|-------------|
| **AML** | Regulators require a controlled intermediary that can monitor/flag/freeze flows |
| **KYC** | Platform must verify both sender AND receiver |
| **PSD2 / SCA** | EU requires Strong Customer Authentication per-transaction |
| **Licensing** | Payment facilitator licenses require touching funds |
| **Reconciliation** | Single-ledger operation vs many-to-many |
| **Refunds** | Internal ledger adjustment vs external pull-back |
| **Fee collection** | Trivial during intermediary settlement |

---

## Components

### 1. `src/finance/PreSetOwnerAccountManager.mjs`

Manages the pre-set account registry:
- **Register** — add a new payout destination (email, IBAN, wallet)
- **Verify** — mark KYC/KYB verification (manual, Plaid, Stripe Identity, Wise KYC)
- **Activate** — set as current payout target for a rail
- **Lookup** — get active account for a given rail

Pre-set accounts are stored in `.swarm/preset-accounts.json`.

### 2. `src/finance/AutoDisbursementEngine.mjs`

Handles the final disbursement leg:
- Looks up active pre-set account for the rail
- Runs ownership enforcement (`resolveDestination` + `enforceOwnership`)
- Calculates fees (processing + platform)
- Builds gateway instruction
- Records immutable audit trail (SHA-256 destination hash)

### 3. `src/policy/owner-payout-policy.ts`

Defines:
- Pre-set account policies (limits, cooldown, jurisdiction)
- Rail recommendation engine (best rail for amount + jurisdiction)
- Payout validation (single limit, daily limit, cooldown)

### 4. `scripts/preset-account-cli.mjs`

CLI for managing pre-set accounts:
```bash
# Register
node scripts/preset-account-cli.mjs register --rail=wise --destination=DE89370400440532013000 --label="Wise IBAN"

# Verify KYC
node scripts/preset-account-cli.mjs verify --id=preset_wise_001 --method=plaid

# Activate for auto-payout
node scripts/preset-account-cli.mjs activate --id=preset_wise_001

# List all
node scripts/preset-account-cli.mjs list

# Simulate disbursement
node scripts/preset-account-cli.mjs disburse --rail=wise --amount=1500 --settlement=sett_001 --dry-run
```

---

## Supported Rails

| Rail | Max Single | Daily Limit | SCA Required | Jurisdiction |
|------|-----------|-------------|-------------|-------------|
| PayPal | $10,000 | $50,000 | ✓ | MA |
| Wise | $25,000 | $100,000 | ✓ | EU |
| Payoneer | $5,000 | $20,000 | ✗ | MA |
| Crypto | $50,000 | $200,000 | ✗ | GLOBAL |
| Stripe | $25,000 | $100,000 | ✓ | US |
| Bank Wire | $50,000 | $200,000 | ✗ | GLOBAL |

---

## Integration with Existing Settlement Flow

```
orchestrate-settlement.mjs
       │
       ▼
1. Settlement completes (platform holds funds)
       │
       ▼
2. AutoDisbursementEngine.disburseToPresetAccount()
       │
       ├── getActivePresetAccount(rail)     ← PreSetOwnerAccountManager
       ├── resolveDestination()             ← ownership policy
       ├── enforceOwnership()                ← ownership enforcement
       ├── calculateFees()                   ← fee structure
       │
       ▼
3. Gateway instruction prepared
       │
       ▼
4. ExternalGatewayManager executes via rail gateway
       │
       ▼
5. Immutable audit trail recorded
```

---

## Compliance Checklist

- [x] Platform touches funds (settlement intermediary)
- [x] KYC on receiving side (pre-set accounts verified before activation)
- [x] SCA enforcement (per-rail SCA flag in policy)
- [x] Fraud detection window (settlement → disbursement delay)
- [x] Fee collection (calculated at disbursement, deducted from gross)
- [x] Audit trail (SHA-256 destination hash, timestamp, KYC metadata)
- [x] Daily limits + cooldowns (per-rail policy)
- [x] Geo-policy (PayPal restrictions enforced)

---

*Implemented: 2026-08-20 · Architecture: platform-mediated auto-disbursement*
