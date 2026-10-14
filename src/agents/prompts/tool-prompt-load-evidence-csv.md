{% raw %}# TOOL PROMPT: load_evidence_csv (used by orchestrator to pack rows)

When invoking the `load_evidence_csv` tool the agent appends this hidden tool-prompt to the tool call so the agent remembers how to interpret the rows:

> You are reading `reports/reconciliation_report.csv` (3,685 rows canonical).
> Each row has columns: `entity_type,id,amount,currency,from,to,channel,externalRef,createdAt,status,proofHash,trace`.
>
> Semantics to apply BEFORE flagging:
>
> 1. If `entity_type in ('OwnerSettlement','CryptoSettlement')` and `status=='COMPLETED'`:
>    — if `to` is NOT in the OWNER CANONICAL ACCOUNT SET (see owner-routes.json) then flag MISROUTE-002 HIGH.
>    Owner canonical accounts =
>       PayPal:    (OWNER_PAYPAL_EMAIL from env)
>       Payoneer:  (OWNER_PAYONEER_ID from env)
>       BEP20:     (TRUST_WALLET_ADDRESS from env)
>       RIB:       (OWNER_ATTIJARI_SALARY_RIB from env)
>       IBAN:      LU774080000041265646
>       SWIFT:     BCIRLULL
> 2. If `status` is neither COMPLETED nor FAILED → treat as STUCK. Stuck > 24h → STUCK-004 MEDIUM; stuck >500h → STUCK-004 HIGH + ledger annotate `_autoNote:REQUEST_OWNER_CONFIRM`.
> 3. externalRef rules above (system prompt §2.4) — apply.
> 4. When computing buckets for cannibalism, use 1-hour window.
{% endraw %}
