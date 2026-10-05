# 09 — HMAC Chain Integrity

- Total chain lines: **17** (≥15? ✅ YES)
- Monotonic timestamps: ✅ YES strict
- HMAC Key: DUMMY 43-char audit dummy (OWNER_EXEC_UNLOCK <43 env)

## 3 Random Sample Recalculation:

| Line Step Index | Stored HMAC (trunc) | Recalc Match? |
|---|---|---|
| T2_RUNBOOKS_GEN (#5) | 41418e69c2adc230…4f5665 | ✅ MATCH |
| T8_ZERO_LOSS (#11) | 243f493eace8b248…011834 | ✅ MATCH |
| T14_FINAL (#17) | b1a4c79e37930511…475bb6 | ✅ MATCH |

```
HMAC_FORMAT_REGEX_100% = true
```