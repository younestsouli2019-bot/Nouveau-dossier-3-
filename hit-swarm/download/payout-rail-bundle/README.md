# Payout Rail — ChariBaaS Swarm

A **legitimate payout rail** for the ChariBaaS swarm that moves money only when
all of the following are true:

1. The PayoutItem is classified **Class A** by the receivables audit
   (`audit_receivables.mjs`) — i.e. it is backed by a real settled merchant
   event with a verified merchant identity.
2. The recipient has passed **KYC verification** (manually approved by the
   operator with documented evidence).
3. The operator has explicitly set `PAYOUT_MODE=live` **both** in the
   environment **and** on the CLI (`--mode live`). Defence in depth.
4. The rail is one of the licensed/registered PSPs supported for Morocco:
   - **PayPal Payouts API** (primary) — supported for Morocco since 2023.
   - **Payoneer Mass Payout** (secondary) — direct MAD deposit to Moroccan banks.
   - Stripe Connect is NOT wired here because Morocco is not directly supported.

The rail **never** pays Class B or Class C items. It **never** auto-batches. It
**never** circumvents the swarm-wide freeze. Every action is recorded in an
append-only JSONL audit log.

---

## Files

```
src/payouts/
  rail.mjs          Base class — enforces the 7 safety gates (Class A, KYC, idempotency,
                    dry-run, confirmation, audit log, no auto-batch).
  paypal.mjs        PayPal Payouts API adapter (OAuth2 + /v1/payments/payouts).
  payoneer.mjs      Payoneer Mass Payout API adapter (token + /v4/payments).
  kyc.mjs           KYC gate — manual operator approval, stored locally.
  audit_log.mjs     Append-only JSONL audit log (system of record).
  cli.mjs           Command-line interface.
.github/workflows/
  payout-rail.yml   Manual dispatch workflow. Requires 'payout-live' GitHub
                    environment with required reviewers for live mode.
.env.example        Template for secrets — copy to .env, fill in, never commit.
.gitignore          Patterns that must be ignored (secrets + payout runtime data).
data/
  payouts/          audit.jsonl lives here (created at runtime)
  kyc/              kyc-db.json lives here (created at runtime)
```

---

## Quick start

```bash
# 1. Apply the bundle to your local clone
bash /home/z/my-project/download/payout-rail-bundle/apply.sh /path/to/Nouveau-dossier-3-

# 2. Run the receivables audit (if not already done)
node /home/z/my-project/scripts/audit_receivables.mjs
# → produces data/security/receivables-audit-latest.json with per-item audit_class

# 3. Copy .env.example to .env and fill in real PayPal sandbox credentials
cd /path/to/Nouveau-dossier-3-
cp .env.example .env
# Edit .env: set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENVIRONMENT=sandbox

# 4. KYC-verify the recipient (you, once)
KYC_DB_PATH=data/kyc/kyc-db.json \
  node src/payouts/cli.mjs kyc verify younestsouli2019@gmail.com \
    --operator younes \
    --evidence 'drivers-license.jpg' \
    --evidence 'proof-of-address-utility-bill.pdf' \
    --rail paypal

# 5. Dry-run a Class A item (there are none currently — this is illustrative)
KYC_DB_PATH=data/kyc/kyc-db.json \
  node src/payouts/cli.mjs pay offline_PayoutItem_<id> --rail paypal

# 6. Live payout (requires PAYOUT_MODE=live in env AND --mode live on CLI)
PAYOUT_MODE=live KYC_DB_PATH=data/kyc/kyc-db.json \
  node src/payouts/cli.mjs pay offline_PayoutItem_<id> --rail paypal --mode live
```

---

## Secret checklist

Add these as **GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions):

| Secret | Required for | Notes |
|---|---|---|
| `PAYOUT_MODE_LIVE` | Live payouts | Set to the literal string `live`. Required for the workflow's defence-in-depth check. |
| `PAYPAL_CLIENT_ID` | PayPal rail | REST app credentials from PayPal Developer dashboard. |
| `PAYPAL_CLIENT_SECRET` | PayPal rail | Same source as client ID. |
| `PAYPAL_ENVIRONMENT` | PayPal rail | `sandbox` or `live`. |
| `PAYONEER_PARTNER_ID` | Payoneer rail | Issued by Payoneer when your Mass Payout account is approved. |
| `PAYONEER_API_KEY` | Payoneer rail | Same source. |
| `PAYONEER_ENVIRONMENT` | Payoneer rail | `sandbox` or `live`. |

Also create a **GitHub Environment** named `payout-live` (repo → Settings → Environments)
with **Required reviewers** set to your own GitHub user. This adds an approval
gate before any live payout can run in Actions.

---

## KYC procedure

Every recipient must be KYC-verified before the first payout. This is a **manual**
process — the rail does not do automated identity verification. The operator
(you) must collect and retain:

1. **Government-issued photo ID** of the recipient (passport, national ID card,
   or driver's license).
2. **Proof of address** matching the recipient's name (utility bill, bank
   statement, or tax document less than 3 months old).
3. **Proof of account ownership** for the destination rail:
   - PayPal: a screenshot of the recipient's PayPal account profile showing
     the email and account holder name.
   - Payoneer: a screenshot of the recipient's Payoneer account showing the
     email and linked bank account.
4. **Source-of-funds declaration** — a short statement from the recipient
   explaining what services they performed to earn the payout. This is
   required by PayPal/Payoneer anti-money-laundering (AML) rules.

Store the evidence files **outside the repo** (e.g. in 1Password, a sealed
Drive folder, or a sealed local directory). In the KYC record, store only
**references** to those files (filenames or document IDs), never the files
themselves.

```bash
node src/payouts/cli.mjs kyc verify <recipient-email> \
  --operator <your-handle> \
  --evidence 'kyc/<recipient>/passport.jpg' \
  --evidence 'kyc/<recipient>/utility-bill.pdf' \
  --evidence 'kyc/<recipient>/paypal-profile-screenshot.png' \
  --evidence 'kyc/<recipient>/source-of-funds.txt' \
  --rail paypal
```

---

## The 7 safety gates (enforced by `rail.mjs`)

| # | Gate | What it does |
|---|---|---|
| 1 | Class A enforcement | Rejects any item with `audit_class !== 'A'`. |
| 2 | KYC gate | Rejects if the recipient has no approved KYC record for the rail. |
| 3 | Idempotency | If the item is already settled in the audit log, returns `already_settled` without making an API call. |
| 4 | Dry-run by default | If `PAYOUT_MODE !== 'live'`, returns a `DRY_<rail>_<hash>` stub. No external call. |
| 5 | Confirmation gate | Settles only after the rail returns a real `external_ref` (PAYID-*, MassPay-*, etc.). |
| 6 | Append-only audit log | Every action (prepare, dispatch, settle, reject) is appended to `data/payouts/audit.jsonl`. |
| 7 | No auto-batch | `pay-batch` is a CLI-level loop, not a single API call. Each item has its own audit entry and idempotency key. |

---

## Country availability (verified 2026-07-31)

| Rail | Send from Morocco | Receive in Morocco | Notes |
|---|---|---|---|
| PayPal Payouts | Yes (business account required, Payouts API must be enabled) | Yes (recipient needs PayPal account linked to Moroccan bank) | Source: developer.paypal.com/docs/payouts/standard/reference/country-feature |
| Payoneer Mass Payout | Yes (Mass Payout account required) | Yes (direct deposit to CIH, Attijariwafa in MAD, ~2% FX fee) | Source: payoneer.com/marketplace/mass-payouts-platform |
| Stripe Connect | No (Morocco not in supported countries) | N/A | Workaround: US LLC or Estonia entity. Not wired in this bundle. |

---

## What this rail does NOT do

- It does **not** read or write Attijariwafa RIB numbers into the repo.
  Recipient identification is by PayPal email or Payoneer payee email — the
  bank account linkage happens inside PayPal/Payoneer, not in our code.
- It does **not** bypass the swarm freeze. If `freeze.active=true` in
  `.autonomous-state.json`, you must explicitly unfreeze the swarm yourself
  before running payouts. The rail does not do it for you.
- It does **not** process Class B items. Those need manual verification of
  the underlying receivable first (request settlement statements from the
  named merchant).
- It does **not** process Class C items. Ever. Those are voided, not paid.
- It does **not** automate KYC. The operator must manually verify each
  recipient and retain evidence off-repo.

---

## Audit log format

Every line in `data/payouts/audit.jsonl` is a JSON object:

```json
{
  "ts": "2026-07-31T12:34:56.789Z",
  "run_id": "RAIL_1785493496789",
  "action": "dispatch",
  "rail": "paypal",
  "item_id": "offline_PayoutItem_1774904439991_127436011",
  "batch_id": "BATCH_PLAID_1774904438359",
  "amount": 19.99,
  "currency": "USD",
  "recipient_hash": "sha256:abc123def4567890",
  "result": "ok",
  "external_ref": "PAYID-XYZ123ABC",
  "error": null,
  "operator": "younes",
  "env": {
    "PAYOUT_MODE": "<present>",
    "PAYPAL_CLIENT_ID": "<present>",
    "PAYPAL_CLIENT_SECRET": "<present>",
    "PAYPAL_ENVIRONMENT": "<present>",
    "KYC_REQUIRE_BEFORE_PAYOUT": "<present>"
  },
  "note": "DRY RUN — no external API call made"
}
```

Recipient identifiers are hashed (SHA-256, truncated to 16 hex chars) so the
audit log does not store raw PII. The full recipient is recoverable only by
re-hashing candidate identifiers and comparing. Secret **values** are never
logged — only whether each expected env var is `<present>` or `<absent>`.

---

## Local verification (run by `apply.sh`)

The apply script runs a smoke test:

```
[verify] running: node src/payouts/cli.mjs kyc list (in /path/to/repo)
KYC records: 0
```

If you see that, the CLI is wired correctly. To run end-to-end tests:

```bash
cd /path/to/Nouveau-dossier-3-

# Test 1: KYC list (empty)
KYC_DB_PATH=data/kyc/kyc-db.json node src/payouts/cli.mjs kyc list

# Test 2: KYC verify (creates a record)
KYC_DB_PATH=data/kyc/kyc-db.json node src/payouts/cli.mjs kyc verify test@example.com \
  --operator tester --evidence doc1.pdf --evidence doc2.jpg --rail paypal

# Test 3: KYC status (should show approved)
KYC_DB_PATH=data/kyc/kyc-db.json node src/payouts/cli.mjs kyc status test@example.com

# Test 4: Attempt to pay a Class C item (should be rejected)
KYC_DB_PATH=data/kyc/kyc-db.json node src/payouts/cli.mjs pay <any-item-id> --rail paypal
# Expected: status=rejected error=not_class_a

# Test 5: Audit log tail
node src/payouts/cli.mjs audit-log tail --n 10
```

---

## Reconciled with the current state of the swarm

As of 2026-07-31, the receivables audit (`AUDIT_1785493783560`) classifies
all 1,778 `failed_recoverable` PayoutItems as **Class C (phantom)**. That
means **this rail has nothing to pay right now**. It exists so that when
future *legitimate* Class A receivables arrive (e.g. real MTurk Requester
settlements, real PayPal business inflows, real Payoneer mass-pay receipts),
they can be paid out safely through a confirmed rail with full audit trail.

To use the rail for real money:

1. Generate a real Class A receivable (e.g. complete a real MTurk HIT batch
   as a human worker, or sell a real service to a real client who pays via
   PayPal business inflow).
2. Record it as an `Earning` in the store with `source` set to the real
   platform name (e.g. `mturk`, `paypal_business`), `settlement_id` set
   to the platform's transaction ID, and `settledAt` set to the settlement
   timestamp.
3. Re-run `audit_receivables.mjs` — the new earning will be classified
   Class A if the merchant identity is verifiable.
4. KYC-verify the recipient (yourself, if you're the payee).
5. Dry-run the payout, inspect the audit log, then live-run it.

Until step 1 happens, the rail sits idle and the audit log stays empty.
