# Financial Resiliency Risk Assessment

**Status:** Draft for review; not submitted to an enterprise risk register and
not accepted by any executive or control owner.
**Evidence date:** 2026-11-04
**Scope:** Repository configuration and source inspection only. No production
database, processor agreement, bank statement, KYC file, or provider console was
accessed. This is an engineering assessment, not legal or accounting advice.

## Executive summary

The repository already has several relevant safeguards: `Payout.idempotencyKey`,
`PaymentIntent.idempotencyKey`, and `RevenueLedgerEntry.idempotencyKey` are
database-unique; payout state includes provider references and reconciliation
status; and payout status history is represented by `PayoutEvent`. These
controls reduce risk, but source inspection cannot establish that every
money-moving path uses them correctly or that the production database has the
expected schema.

One specific concurrency gap is visible in the RealWorldCerts payment webhook:
it checks for an audit row, updates the sale, and inserts the audit row as
separate operations. The audit table has no uniqueness rule for this event.
Concurrent deliveries of the same valid event can therefore race between the
check and insert. The handler's unique provider transaction ID prevents reuse
of one transaction ID for another sale, but does not make the event-level
check-and-insert atomic.

No defensible dollar estimate, vendor fee, suspension term, regulatory penalty,
or KYC control-completion claim can be made from repository evidence alone.

## Risk register

| ID | Risk and evidence | Preliminary rating | Needed evidence / decision |
|---|---|---|---|
| R-01 | **Duplicate webhook race (RealWorldCerts).** `rwc-payment/route.ts:92-108` checks `AuditLedger` and then separately updates `SalesLedger` and creates the audit record. There is no database uniqueness constraint for `(action, entityId)` on `AuditLedger` (`schema.prisma:516-529`). Two concurrent retries can both observe no audit row and both insert one. This can duplicate the audit count and leave payment/audit state inconsistent; the exact financial effect depends on downstream fulfillment behavior. `SalesLedger.payment_provider_txid` is unique, which is a useful separate safeguard. | Medium pending concurrency test and production evidence | Test duplicate concurrent signed webhooks in an isolated database. Design a durable deduplication key and transaction/constraint that preserves legitimate audit history; inspect existing duplicates before migration. |
| R-02 | **Payout replay / provider timeout exposure.** The `Payout` model has a unique idempotency key, provider references, reconciliation state, and optimistic version field (`schema.prisma:878-905`). Schema comments explicitly say unknown payout outcomes must be reconciled, not blindly retried (`schema.prisma:874-876`). This is meaningful protection, but source review has not traced every live payout execution path or confirmed provider-side idempotency behavior. | Medium, evidence incomplete | Trace each enabled payout workflow and provider adapter. Confirm provider idempotency semantics, durable request-key reuse, ambiguous-timeout handling, and reconciliation coverage. |
| R-03 | **Audit tamper-resistance is not established by the schema.** `AuditLedger` has optional hash fields (`schema.prisma:516-529`); `PayoutEvent` is described as append-only (`schema.prisma:907-920`). A Prisma model/comment does not itself prevent database users or application code from updating/deleting rows, and nullable hashes do not prove a complete chain. | Medium, controls unverified | Inspect database roles, grants, triggers, backups, retention, hash verification, and audit-writer permissions. Do not describe the ledger as immutable until those controls are tested. |
| R-04 | **JIT liquidity, negative balance, and vendor suspension costs.** No processor/bank agreement or account statement was available for this review. | Unquantified | Obtain the applicable agreements and statements through authorized finance/vendor channels. Record overdraft/NSF fees, reserve and negative-balance terms, suspension triggers, notice/cure periods, and settlement timing. |
| R-05 | **KYC and regulatory exposure.** Repository inspection for this assessment did not establish the applicable legal entities, jurisdictions, regulated activities, complete KYC policy, or provider-specific verification requirements. The absence or presence of a table alone does not determine a regulatory violation or penalty. | Unassessed; counsel/compliance review required | Compliance counsel should identify applicable obligations, retention periods, KYC controls, and regulator/acquirer consequences for the actual entities and flows. PCI-DSS consequences are commonly contractual/acquirer-driven; do not treat them as one universal statutory fine. |
| R-06 | **Payout approval gate may not require a reviewer.** The `owner-payout.yml` workflow uses the GitHub `payouts` environment and says required reviewers must be configured. A read-only environment metadata check on 2026-11-04 reported zero protection rules. This does not prove a payout can run (other guards and credentials still apply), but it means the claimed environment approval gate was not demonstrated. | High for governance assurance; execution reachability not established | A repository administrator should configure required environment reviewers and verify the saved environment settings. Do not dispatch a live payout as a test. |

## Exposure worksheet

Populate these inputs from reconciled provider and ledger records. Do not use
assumed rates as if they were measured.

### Duplicate payout loss

Preferred retrospective measure:

`unrecovered duplicate outflow = Σ (duplicate payout amount - recovered amount)`

For a forward-looking scenario, use a value-weighted duplicate rate:

`scenario loss = payout volume over period × duplicate execution rate by value × unrecovered share`

If only a count-based rate is available:

`scenario loss = payout count × duplicate-event rate × average payout amount × unrecovered share`

Record the period, currency, source query/report, numerator, denominator,
recovery cutoff date, and confidence interval. The requested “average daily
payout volume × duplicate webhook error margin” is only defensible if that
margin is measured from comparable traffic and represents the fraction of
**payout value** duplicated. A webhook retry rate is not the same as a duplicate
payout rate.

| Input | Value | Source / period |
|---|---:|---|
| Average daily payout value by currency | Not available | Reconciled payout ledger/provider export required |
| Duplicate payout value / eligible payout value | Not available | Idempotency and provider reconciliation analysis required |
| Unrecovered share at agreed cutoff | Not available | Recovery records required |
| Calculated historical loss / scenario range | Not calculated | Complete inputs first |

### Liquidity and interruption cost

Calculate separately by provider and currency:

`liquidity shortfall = payouts due before funds become available - available cleared balance`

`direct bank/provider cost = contractual overdraft, returned-payment, NSF, reserve, and expedited-funding charges`

`operational interruption cost = contribution margin lost during outage + support/recovery labor + contractual customer impacts`

No vendor terms or verified financial inputs were available, so exact fees,
suspension terms, and business-interruption amounts remain **unknown**, not
zero. Obtain current signed agreements and finance-approved operating data.

### Compliance baseline

There is no universal fine that follows merely from lacking a table named
`audit_logs`. Potential consequences depend on jurisdiction, entity status,
data type, activity, control failure, harm, and contractual obligations.
Likewise, sending a payout to an unverified profile is not enough information
to calculate a specific penalty. Compliance counsel should document applicable
rules and ranges for the actual business before any amount is presented to
leadership.

## Review and risk-decision record

This section is intentionally unsigned. It is not evidence that leadership
reviewed or accepted any risk.

For each risk, the accountable owner should select **remediate**, **mitigate**,
**accept until a stated expiry**, or **reject / request more evidence**. Risk
acceptance should identify the residual risk, business rationale, compensating
controls, review date, and approver authorized under company policy.

Suggested acknowledgement, to be completed only by an authorized approver:

> I have reviewed risk [ID] and its stated evidence and uncertainty. I choose
> [decision] until [expiry/review date]. I understand the residual exposure and
> the documented compensating controls. This decision does not waive legal,
> regulatory, contractual, or customer obligations.

**Approver / role:** ____________________  
**Decision and rationale:** ____________________  
**Date / expiry:** ____________________  
**Required controls and owner:** ____________________

**Risk-register submission:** Not submitted. The repository provides no access
to an internal enterprise risk registry or its accountable owners. Route this
draft through the organization's established compliance/risk channel; do not
bypass controls or represent this document as an official filing.

## Remediation plan

1. **Measure and preserve evidence:** Run the existing aggregate payout audit
   against an authorized read-only database connection; reconcile its output
   with provider exports. Keep identifiers, account details, and secrets out of
   reports. The audit has not been run against the production database in this
   review.
2. **Close the webhook race:** Add a durable, database-enforced deduplication
   key for the specific payment event and make the sale update plus receipt
   write atomic. First inspect existing data for duplicates and test concurrent
   retries in a disposable database. Do not add a uniqueness constraint on a
   status column: multiple payouts and status transitions are legitimate.
3. **Prove payout idempotency end-to-end:** For every enabled rail, verify
   stable request-key reuse and provider semantics. On ambiguous timeouts,
   reconcile before any retry; do not blindly repeat a transfer.
4. **Strengthen audit evidence:** Verify append-only permissions, restricted
   writer roles, backup/retention, and hash-chain verification. Add database
   enforcement only after a migration and rollback plan is reviewed.
5. **Verify human authorization:** Have a repository administrator set and
   independently confirm required reviewers on the `payouts` environment.
   Keep live payout workflows manually dispatched and never use a real
   transfer to validate approval gates.
6. **Run failure-injection drills only in non-production:** Use provider
   sandboxes or isolated staging, test funds, a written scope, observability,
   stop conditions, and a recovery runbook. Do not interrupt a live provider
   connection or create an actual ledger discrepancy to demonstrate risk.

No changes in this assessment authorize a database migration, secret movement,
production deployment, payout, or external risk-register submission.
