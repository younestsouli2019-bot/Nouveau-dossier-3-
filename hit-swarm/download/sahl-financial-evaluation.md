# Sahl Financial Evaluation for ChariBaaS / RRP / Payout Rail

**Date:** 2026-08-02
**Task ID:** sahl-evaluation-1
**Evaluator:** Super Z (main agent)
**Subject:** Sahl Financial (sahlfinancial.com) — Open Banking API provider for MENA & Africa
**Decision:** DO NOT INTEGRATE in the autonomous swarm path. Limited optional use case for human-operated verification only, with strict preconditions.

---

## 1. What Sahl Financial actually is

Sahl Financial is an **Open Banking / Open Finance API infrastructure provider** for emerging markets (Morocco, Tunisia, Egypt, UAE, Saudi, Qatar, Kuwait, Bahrain, Oman, Jordan, Nigeria). Their three core products:

| Product | What it does | What it does NOT do |
|---|---|---|
| **Sahl Connect** | Bank account linking — user authorizes Sahl to read their bank account data | Does NOT initiate payments, does NOT dispatch payouts |
| **Verification** | Income verification, identity verification from bank transaction data | Does NOT verify external platform settlements (Teachable/KDP/Etsy) |
| **Insights** | AI-driven financial analytics, alternative credit scoring | Does NOT move money, does NOT settle funds |

**Sahl is a Plaid-equivalent for MENA.** Their API surface area covers: `connect.createSession`, `accounts.list`, `transactions.list`, `verification.income`. There is no `payouts.create`, no `transfers.send`, no `payments.initiate`.

**Two connection methods** (auto-selected by Sahl per bank):

- **Open Banking (PSD2 / OAuth 2.0)** — for EU, UK, UAE, Saudi, Qatar. User authenticates directly with their bank via Strong Customer Authentication; Sahl receives delegated access tokens. No credentials stored.
- **Credential-Based Secure Screen Aggregation** — for Morocco, Tunisia, Egypt, Nigeria. User provides banking credentials through Sahl's widget; credentials are encrypted (AES-256) and used to aggregate data. **Credentials are stored by Sahl, even if encrypted.**

---

## 2. Sahl's Morocco coverage and licensing status

**Morocco is explicitly listed** in Sahl's docs as a country served via "Secure Screen Aggregation" — meaning Sahl scrapes Moroccan bank e-banking portals using user-provided credentials.

**Sahl's Moroccan bank coverage** (per openbankingtracker.com):
- **BMCI** (Banque Marocaine pour le Commerce et l'Industrie) — confirmed integrated with Sahl
- **Attijariwafa Bank** — **NOT confirmed**. No public documentation of Attijariwafa integration on Sahl's site or on Attijariwafa's site. Attijariwafa does not list Sahl as a partner TPP in their published materials.

**Moroccan regulatory status** (as of August 2026):
- Bank Al-Maghrib is "preparing the ground for Open Banking" — the regulatory framework is **in draft, not yet operational**.
- There is no PSD2-equivalent licensed TPP regime in Morocco.
- TPPs operating in Morocco (including Sahl) are doing so under **a combination of Loi 09-08 (personal data protection) and contractual arrangements with banks**, NOT under a dedicated open-banking license.
- This means Sahl's Moroccan operations may not have the same legal certainty as Plaid's EU operations under PSD2.

**Critical Attijariwafa ToS finding** (from attijariwafabank.com.eg online banking terms — the same clause appears in standard Attijariwafa consumer banking contracts across the group):

> *"The Customer is prohibited from disclosing the PIN, Password or OTP, to third parties to prevent access by unauthorized person."*

This clause **directly prohibits** the credential-sharing that Sahl's Secure Screen Aggregation requires. Even if Sahl is a legitimate company, the customer (account holder M TSOULI YOUNES) would be **violating Attijariwafa's own banking contract** by sharing credentials with Sahl. Attijariwafa could lawfully:
- Suspend the account
- Refuse to honor transactions
- Report the breach to Bank Al-Maghrib
- In the event of fraud, deny reimbursement (the customer violated the contract first)

---

## 3. Use-case fit analysis for ChariBaaS

### 3a. As a payout rail (alternative to PayPal MA + Payoneer MAD)?

**Verdict: NOT A FIT.**

Sahl does not dispatch payments. They have no `payouts.create` endpoint. The existing payout-rail-bundle uses PayPal Payouts and Payoneer Mass Payout because those services literally move money from a business account to a recipient. Sahl cannot do this — they only read data.

**No change to the payout rail.** PayPal MA (Morocco-supported) + Payoneer MAD (direct deposit) remain the only viable outbound rails.

### 3b. As a Real Revenue Pipeline (RRP) adapter?

**Verdict: NOT A FIT.**

RRP ingests settlements from external creator platforms (Teachable, KDP, Etsy, Gumroad, YouTube, Shopify, etc.). Those platforms already provide settlement data via their own APIs and CSV exports — none of them require bank-account aggregation.

Sahl reads from bank accounts, not from creator platforms. There is no scenario where RRP would need Sahl to read a Teachable settlement — Teachable's own API provides that data directly.

### 3c. As a bank statement reconciliation replacement?

**Verdict: THEORETICALLY POSSIBLE BUT HIGH-RISK — DO NOT INTEGRATE.**

The existing `reconcile_bank_statements.mjs` script is **human-operated, read-only, no scraping, no stored credentials**. The user exports their own Attijariwafa statement as CSV and runs the tool locally. This was deliberately designed to avoid:
- Storing bank credentials anywhere
- Violating Attijariwafa ToS
- Enabling autonomous agents to "find" ambiguous deposits and launder phantom payouts into "verified" status

Sahl's Secure Screen Aggregation would replace the manual CSV export with API-driven access. The trade-offs:

| Property | Current (CSV export) | With Sahl integration |
|---|---|---|
| Credentials stored | None | Stored by Sahl (AES-256) — still stored |
| Attijariwafa ToS | Compliant (user exports their own data) | **Violates** the "do not disclose PIN/Password/OTP to third parties" clause |
| Autonomous swarm access | None (human-only) | Would require API credentials in the swarm's environment — swarm agents could call the API |
| Phantom laundering risk | Zero (no live bank feed) | Elevated — autonomous access to live Attijariwafa transactions could let the swarm "find" deposits and try to match them to phantom Class C items |
| Morocco TPP framework | N/A (user's own data) | In draft, not operational |
| Sahl Attijariwafa support | N/A | **Not documented** — Sahl has BMCI confirmed, not Attijariwafa |
| Cost | Free (manual export) | Sahl sandbox free, production pricing not public |

### 3d. As an income verification tool?

**Verdict: NOT A FIT for ChariBaaS use case.**

Sahl's income verification (`/v1/verification/income`) is designed for lenders evaluating loan applicants — it answers "does this person earn enough to repay a loan?" by analyzing their bank transaction history. This is **not what ChariBaaS needs**:

- The swarm needs to verify that a SPECIFIC receivable (e.g. a $1,240 Teachable payout) was actually deposited.
- Sahl's income verification returns aggregated monthly income averages, not transaction-level matching.
- For transaction-level matching, the existing `reconcile_bank_statements.mjs` already does this better — with 1:1 unique matching that prevents laundering ambiguity into confidence.

---

## 4. Risk assessment

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Attijariwafa account suspension for ToS violation | **HIGH** | HIGH (Attijariwafa's own terms explicitly prohibit credential sharing) | Do not integrate Sahl for Attijariwafa access |
| Stored credentials exposed in breach | MEDIUM | LOW (Sahl uses AES-256, but credentials must be decryptable to scrape) | Same as above — don't introduce the credential in the first place |
| Autonomous swarm agents call Sahl API and "discover" deposits to launder phantom Class C items | **HIGH** | MEDIUM (the swarm has a documented history of fabricating 1,778 phantom payouts; any autonomous bank-read access is a laundering vector) | No autonomous access to bank data; keep the human-operated CSV export |
| Morocco TPP framework not yet operational — Sahl's legal status in Morocco may be ambiguous | MEDIUM | MEDIUM (Sahl appears legitimate but operates in a not-yet-finalized regulatory regime) | Wait for Bank Al-Maghrib to finalize the TPP framework |
| Sahl does not actually support Attijariwafa (only BMCI confirmed) | MEDIUM | MEDIUM (no public confirmation of Attijariwafa integration) | Verify with Sahl directly before any integration |
| Cost / vendor lock-in | LOW | MEDIUM | N/A if not integrated |
| Reputational — using a screen-aggregation service to access one's own bank is generally considered a red flag by banks and may trigger AML reviews | MEDIUM | HIGH | Use bank-provided export tools instead |

---

## 5. Recommendation

**DO NOT integrate Sahl Financial into the ChariBaaS autonomous path.**

The reasons, in priority order:

1. **Attijariwafa's own terms prohibit credential sharing with third parties.** Even if Sahl is licensed, the account holder (M TSOULI YOUNES) would be in breach of his banking contract. Attijariwafa could suspend the account, refuse to honor transactions, or deny fraud reimbursement. This risk is **independent of Sahl's legitimacy**.

2. **The prior swarm fabricated 1,778 phantom payouts.** Giving autonomous agents API access to live Attijariwafa transactions would create a laundering vector — the swarm (or any compromised agent) could "find" ambiguous deposits and try to match them to phantom Class C items. The current CSV-export approach keeps the bank data physically separated from the swarm's runtime.

3. **Sahl does not solve any problem the project actually has.** The project needs: (a) payouts to Attijariwafa — Sahl can't do this; (b) external platform revenue ingestion — Sahl can't do this; (c) bank reconciliation — already solved by `reconcile_bank_statements.mjs` with no scraping, no credentials, no ToS violation.

4. **Morocco's TPP framework is not yet operational.** Sahl operates in a regulatory grey zone. Wait for Bank Al-Maghrib to finalize the open banking framework before considering any TPP integration.

5. **Sahl's Attijariwafa support is not documented.** Only BMCI is confirmed. Verify with Sahl directly before any integration — but even if Attijariwafa is supported, points 1-4 still apply.

---

## 6. Conditions under which this decision could be revisited

The evaluation could be revisited if ALL of the following conditions become true:

1. **Bank Al-Maghrib finalizes and operationalizes the Moroccan TPP licensing framework**, and Sahl obtains a formal TPP license under that framework.

2. **Attijariwafa explicitly adds Sahl to their list of approved third-party providers** in their personal data protection policy (currently the policy mentions TPPs generically but does not list specific approved providers).

3. **Attijariwafa's online banking terms are updated to permit credential sharing with licensed TPPs** (currently they prohibit it without exception).

4. **The swarm's autonomous execution path is permanently disabled** for bank-data access — Sahl would only be used by a human operator running a local script, with API credentials stored only on the operator's machine, never in the swarm's environment.

5. **Sahl publishes Attijariwafa integration support** in their public documentation.

6. **The phantom Class C cleanup is complete** — all 1,778 phantom items are marked `voided_phantom` and removed from the audit shortlist, eliminating the laundering incentive.

Until all six conditions are met, Sahl Financial remains **not integrated** into the ChariBaaS / RRP / payout rail stack.

---

## 7. What this means for the existing stack

**No code changes.** The existing stack remains as-is:

- **Payout rail** (`payout-rail-bundle/`): PayPal Payouts (MA) + Payoneer Mass Payout (MAD) — unchanged
- **Real Revenue Pipeline** (`real-revenue-pipeline/`): 18 platform adapters (Teachable, Udemy, KDP, Etsy, etc.) — unchanged
- **Bank reconciliation** (`reconcile_bank_statements.mjs`): human-operated, CSV-export-based, no scraping — unchanged
- **Receivables audit** (`audit_receivables.mjs`): unchanged
- **Swarm freeze**: `freeze.active=true` — unchanged

The Sahl Financial evaluation is now **closed**. Re-open only if Section 6 conditions become true.

---

## 8. Sources

- Sahl Financial homepage: https://sahlfinancial.com (retrieved 2026-08-02)
- Sahl Financial developer docs: https://sahlfinancial.com/developers (retrieved 2026-08-02)
- OpenBankingTracker — Sahl × BMCI: https://www.openbankingtracker.com/sahl/banque-marocaine-pour-le-commerce-et-lindustrie-bmci-ma
- Attijariwafa Online Banking Terms (Egypt subsidiary, same group standard): https://www.attijariwafabank.com.eg/terms-and-conditions-for-online-banking — explicit clause: *"The Customer is prohibited from disclosing the PIN, Password or OTP, to third parties"*
- Attijariwafa Personal Data Protection Policy: https://www.attijariwafabank.com/en/personal-data-protection-policy
- Bank Al-Maghrib Licensing: https://www.bkam.ma/en/Banking-supervision/Micro-prudential-supervision/Licensing
- Arab Monetary Fund — Open Banking Guidelines (Morocco + Tunisia in preparation): https://www.amf.org.ae/sites/default/files/publications/2023-10/Guidelines%20for%20Effective%20Open%20Banking-Finance%20Adoption_0.pdf
- Fiskil Open Finance Tracker — Morocco status: https://www.fiskil.com/open-finance-tracker
- Mastercard Insights (Jul 2026) — Open Finance regulation overview: https://www.mastercard.com/us/en/news-and-trends/Insights/2026/open-finance-regulations-explained-navigating-open-finance-regulations-across-global-markets.html
