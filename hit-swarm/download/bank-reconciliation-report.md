# Bank Statement Reconciliation Report

**Run ID:** BANKRECON_1785495716194
**Reconciled at:** 2026-07-31T11:01:56.216Z
**Account:** Attijariwafa 810-0004482000613213-72 (synthetic test statement)

## Inputs
- Bank statement: `/home/z/my-project/download/synthetic-attijariwafa-statement.csv`
- Receivables audit: `/tmp/Nouveau-dossier-3-/data/security/receivables-audit-latest.json`
- Bank transactions parsed: 23 (17 deposits, 6 withdrawals)
- Expected receivables: 1778

## Summary
| Status | Count | Total |
|---|---|---|
| Matched (deposit found) | 0 | $0.00 |
| Unmatched (no deposit) | 1741 | $35542.96 |
| Ambiguous (multiple candidates) | 37 | — |
| Extra deposits (no matching receivable) | 17 | $33120.84 |

## Interpretation
**None of the expected receivables appeared as deposits in the bank statement.**
Combined with the receivables audit (which classified all 1,778 items as Class C — phantom),
this confirms that the swarm fabricated the payout queue. **No real money was ever due, and no real money ever arrived.**

## Per-item results

| Item ID | Expected | Status | Matched bank tx |
|---|---|---|---|
| offline_PayoutItem_1774904439991_127436011 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904440010_777182145 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904440020_274920420 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904440027_795553868 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904440041_160327619 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904440053_348897268 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904440108_3082109 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904441382_460653563 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904441405_258084903 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904441411_792946926 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904441418_272705781 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904441425_614448011 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904441431_698812124 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904441440_519942429 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904441446_15812389 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904441455_775382766 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904441462_231656745 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904441473_511897596 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904441480_548804014 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904441492_476023922 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904441547_651614080 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904442034_167159825 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904442494_935176347 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904442501_301656174 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904442510_332464730 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904442518_486349748 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904442526_984846984 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904442538_6500525 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904442545_96521813 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904442554_626891340 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904442560_858913610 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904442570_11182522 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904442577_604715951 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904442587_654684368 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904443886_566121734 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904443908_325017919 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904443965_851428178 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904445364_687533115 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904445390_51162958 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904445401_651165675 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904445412_843041114 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904445426_121788444 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904445441_269365596 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904445450_50616149 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904445460_172801005 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904446062_918781004 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904446805_177353011 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904446813_327523897 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904446822_379948339 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904446833_272147019 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904446841_16363365 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904446851_408064715 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904446867_245005771 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904446889_176523674 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904446900_510252503 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904446912_460148603 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904446923_582193776 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904446930_601814110 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448033_332408520 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904448049_182078103 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448056_124739723 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904448063_11147457 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448071_376271800 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904448077_704206531 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448083_505400902 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904448088_840276852 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448094_411525224 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904448099_928827654 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448105_674080153 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904448110_26382744 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448115_639503101 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904448122_17397527 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904448166_790453892 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904449122_827220376 | $30 USD | ambiguous | — |
| offline_PayoutItem_1774904449127_103536425 | $10 USD | unmatched | — |
| offline_PayoutItem_1774904495991_600533568 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904497721_266240873 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904556096_162192881 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904557726_392394142 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904616086_30395638 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904617730_62851205 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904676099_994419359 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904677738_906507830 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904736107_698430478 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904737753_80286456 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904796115_856492064 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904797757_835660464 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904856129_700773564 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904857772_839201674 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904916142_807560080 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904917781_371296959 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904976146_239485681 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774904977795_561485426 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774905036155_315072441 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774905037793_307703422 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774905096169_543080517 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774905097797_77995524 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774905156169_835917424 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774905157806_243015117 | $19.99 USD | unmatched | — |
| offline_PayoutItem_1774905216175_512280902 | $19.99 USD | unmatched | — |
| ... (1678 more) | | | |