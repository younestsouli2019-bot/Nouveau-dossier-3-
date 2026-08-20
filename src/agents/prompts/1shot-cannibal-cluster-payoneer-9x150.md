{% raw %}# 1-SHOT: Cannibal cluster — 9× $150 Payoneer + 5× mg5ikgvtp

## INPUT (abridged)
> "We have 3,685 rows in reconciliation_report.csv.  We bucket by amount/channel/destination/1h-window.
> One bucket has size = **9 rows × $150 × Payoneer × younestsouli2019@gmail.com** in a 12-minute window
> 2026-05-30 between 14:00 and 14:12 UTC.  Five of the 9 rows share externalRef = `mg5ikgvtp`; the
> remaining four have refs `PA123456789012345`, `PAY_9A8B7C6D5E4F3G`, `7JURR3NM2G5K6P`, and `FAKE_PAYOUT_DO_NOT_TRUST`."

## EXPECTED FINDINGS OUTPUT (parsed by quarantine-writer script)

```json
[
  {
    "rule_id": "CANNIBAL-003",
    "severity": "CRITICAL",
    "entity": "PayoutItem",
    "group_size": 9,
    "state_hash": "c45c89a6bf77cf014e6928ba…",
    "group_ids_in_bucket": ["PI-A","PI-B","PI-C","PI-D","PI-E","PI-F","PI-G","PI-H","PI-I"],
    "keep_id": "PI-H",
    "quarantine_ids": ["PI-A","PI-B","PI-C","PI-D","PI-E","PI-F","PI-G","PI-I"],
    "summary": "9× $150 Payoneer cluster 12min: 5 share mg5ikgvtp faker; keep PI-H (ref PAY_9A8B7C6D5E4F3G — 16 chars, high entropy, rule_1+rule_3)",
    "evidence_links": [
      {"source": "authoritative_csv", "path": "reports/reconciliation_report.csv", "rows":[3212,3214,3218,3223,3231,3240,3245,3250,3257]},
      {"source": "base44_export", "path": "data/financial/base44_export_1787176654540.json"}
    ],
    "recommended_action": "QUARANTINE_2_THROUGH_N",
    "needs_human_review": false,
    "isolation_subagent_ran": true
  },
  {
    "rule_id": "FABRICATED-001",
    "severity": "HIGH",
    "entity": "PayoutItem",
    "entity_id": "PI-I",
    "state_hash": "c45c89a6bf77cf014e6928ba…",
    "summary": "PI-I has ref 'FAKE_PAYOUT_DO_NOT_TRUST' — faker pattern; already quarantined above.  Raise HIGH to owner.",
    "evidence_links": [
      {"source": "base44_export", "path": "data/financial/base44_export_1787176654540.json", "row": "PI-I.externalRef"}
    ],
    "recommended_action": "FLAG_IN_WELCOME_DIGEST",
    "needs_human_review": true
  }
]
```

## WHY THE KEEP IS PI-H (chain of thought)

1. Apply RUBRIC rule_1.  Eligible "keepers" = rows whose externalRef has ≥ 6 alphanumeric AND does NOT match FAKER pattern (mg5ikgvtp → **FAKER** because it's low-entropy length 8 AND reused 5 times; `FAKE_…` prefix → **FAKER**).  Left with 2 rows: PA123456789012345 (length 17, looks PayPal-ish), PAY_9A8B7C6D5E4F3G (length 16, looks payout-ish).
2. rule_2: PA123456789012345 createdAt=14:00:18 vs PAY_9A8B7C6D5E4F3G=14:00:07. PAY_9A8B7C6D5E4F3G is OLDER → keep PAY_9A8B7C6D5E4F3G = PI-H.
3. (rule_3 tiebreak unnecessary but confirms: Shannon entropy of PAY_9A8B7C6D5E4F3G is higher due to mixed-case + digits.)

**The sub-agent returns this exact JSON.  The orchestrator writes quarantine entries for the 8 loser IDs.**
{% endraw %}
