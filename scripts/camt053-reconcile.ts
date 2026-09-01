// Offline Camt.053 reconciliation harness (Attijariwafa Bank Europe).
// Maps native ISO 20022 Camt.053 XML -> parseCamt053 -> exact-match auto-settle.
// Fail-closed: only writes when an EXACT amount+currency match exists; a non-matching
// statement yields an unmatched report and writes nothing.
//
// Pass a path to a real bank statement:  tsx scripts/camt053-reconcile.ts ./stmt.xml
// With no arg, runs a synthetic non-matching sample to prove the loop (no writes).
import 'dotenv/config';
import fs from 'fs';
import { parseCamt053, runBankReconciliation } from '../src/lib/bank-reconciliation';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <Ntry>
        <Amt Ccy="USD">1234.56</Amt>
        <AcctSvcrRef>SYNTHETIC-NO-MATCH-001</AcctSvcrRef>
        <BookgDt><Dt>2026-08-25</Dt></BookgDt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <NtryDtls><TxDtls>
          <Ref>SYNTHETIC-NO-MATCH-001</Ref>
          <Rmted><Cdtr><Nm>DO NOT SETTLE</Nm></Cdtr></Rmted>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

async function main() {
  const arg = process.argv[2];
  let input: string;
  let source: string;
  if (arg) {
    if (!fs.existsSync(arg)) { console.error('[recon] file not found:', arg); process.exit(1); }
    input = fs.readFileSync(arg, 'utf8');
    source = arg;
  } else {
    input = SAMPLE;
    source = '(synthetic no-match sample)';
  }

  console.log('[recon] Camt.053 source:', source);
  const parsed = parseCamt053(input);
  console.log('[recon] parsed bank entries:', parsed.length);

  const report = await runBankReconciliation(input);

  console.log('\n[recon] ===== RECONCILIATION REPORT ====');
  console.log('  timestamp          :', report.timestamp);
  console.log('  internal settlements:' , report.totalInternalSettlements);
  console.log('  bank entries       :', report.totalBankEntries);
  console.log('  matched            :', report.matched, '(exact=' + report.exactMatches +
    ' fx=' + report.currencyMismatches + ' disc=' + report.amountDiscrepancies + ' ref=' + report.referenceOnlyMatches + ')');
  console.log('  duplicates blocked :', report.duplicatesBlocked);
  console.log('  total discrepancy $:', report.totalDiscrepancyUsd.toFixed(2));
  console.log('  unmatched internal :', report.unmatchedInternal);
  console.log('  human sign-off req :', report.humanSignoffRequired.length);
  console.log('[recon] done (reads DB; writes ONLY on exact real match).');
  process.exit(0);
}

main().catch(e => {
  console.error('[recon] fatal:', e);
  process.exit(1);
});
