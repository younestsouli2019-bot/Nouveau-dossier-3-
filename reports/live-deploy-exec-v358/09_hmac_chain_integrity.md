# 09 — HMAC Chain Integrity

- Total chain lines: **17** (≥15? ✅ YES)
- Monotonic timestamps: ✅ YES strict
- HMAC Key: DUMMY 43-char audit dummy (OWNER_EXEC_UNLOCK <43 env)

## 3 Random Sample Recalculation:

| Line Step Index | Stored HMAC (trunc) | Recalc Match? |
|---|---|---|
| T2_RUNBOOKS_GEN (#5) | 731e0a015914a2a1…1f8822 | ✅ MATCH |
| T8_ZERO_LOSS (#11) | 21422dc3c2582684…017193 | ✅ MATCH |
| T14_FINAL (#17) | ba69dddd724e20ca…9f94e7 | ✅ MATCH |

```
HMAC_FORMAT_REGEX_100% = true
```