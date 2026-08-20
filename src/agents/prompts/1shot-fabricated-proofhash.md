{% raw %}# 1-SHOT: Fabricated proofHash — literal `sha256_{email}_{amount}_{ts}`

## INPUT
> RevenueEvent row id REV-47 — `proofType=sha256`, `proofHash=sha256_younesdgc@gmail.com_47_1717080000000`,
> `amountUSD=47.00`, `verified=true`, `channel=stripe`.
> Sibling row REV-912 has `proofHash=sha256_younesdgc@gmail.com_32_1717084000000`, same pattern.

## RULE-APPLY CHAIN OF THOUGHT
1. From validation table in system prompt (`proofHash` row):
   * FABRICATED pattern = literal format `sha256_<email>_<amount>_<ts>`. → BOTH HIT.
   * Not FABRICATED = 64 hex, deterministic, matches actual `SHA-256(payload)` when payload is reconstructed.
2. Rule 1 of finding generation → ≥2 sources required.
   * Source 1: `base44_export RevenueEvent` shows both rows.
   * Source 2: `data/quarantine/` already has REV-47 from phase-1 audit.  Source 3: CSV row 2,451 matches amount $47. → 3 sources.
3. Compute state_hash for these two rows: $47 differs from $32, so separate buckets (expected).
4. Severity = HIGH (fabricated proof → verified=true trusted → revenue inflated, but not CRITICAL without paired settlement that actually moved money; in our case settlement_ledger has none marked inbound yet, so HIGH is correct).

## EXPECTED FINDINGS JSON
```json
[
  {
    "rule_id": "FABRICATED-001",
    "severity": "HIGH",
    "entity": "RevenueEvent",
    "entity_id": "REV-47",
    "state_hash": "7704a3ff37c82df…",
    "summary": "proofHash literal 'sha256_<email>_47_<ts>' pattern, not real SHA-256. verify=true is misleading.",
    "evidence_links": [
      {"source": "base44_export",   "path": "data/financial/base44_export_RevenueEvent.json"},
      {"source": "prior_quarantine","path": "data/quarantine/F1787176654540_RevenueEvent_REV-47_1.json"},
      {"source": "csv_matched", "path": "reports/reconciliation_report.csv", "row": 2451}
    ],
    "recommended_action": "QUARANTINE + SET VERIFIED_FALSE",
    "needs_human_review": true
  },
  {
    "rule_id": "FABRICATED-001",
    "severity": "HIGH",
    "entity": "RevenueEvent",
    "entity_id": "REV-912",
    "state_hash": "2ef533a0111bf34…",
    "summary": "sibling literal sha256_…_32_… same fabrication pattern — keep pattern-flag HIGH",
    "evidence_links": [
      {"source": "base44_export",   "path": "data/financial/base44_export_RevenueEvent.json"},
      {"source": "csv_matched", "path": "reports/reconciliation_report.csv", "row": 3112}
    ],
    "recommended_action": "QUARANTINE + SET VERIFIED_FALSE",
    "needs_human_review": true
  }
]
```
{% endraw %}
