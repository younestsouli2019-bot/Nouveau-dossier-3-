import { NextResponse } from 'next/server'
import { findCompletedWithoutExternalRef, findFictionalSettlements, findUnverifiedRevenue, findSuspiciousVerifiedRevenue, findProcurementDiscrepancies, findDeliveredWithoutReceipt } from '@/lib/strict-enforcement'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [noRef, fictional, unverifiedRev, suspiciousRev, procDisc, deliveredNoReceipt] = await Promise.all([
      findCompletedWithoutExternalRef(),
      findFictionalSettlements(),
      findUnverifiedRevenue(),
      findSuspiciousVerifiedRevenue(),
      findProcurementDiscrepancies(),
      findDeliveredWithoutReceipt(),
    ])

    const totalViolations = noRef.length + fictional.length + unverifiedRev.length + suspiciousRev.length + procDisc.length + deliveredNoReceipt.length

    return NextResponse.json({
      success: true,
      totalViolations,
      critical: noRef.length + fictional.length,
      warnings: unverifiedRev.length + deliveredNoReceipt.length,
      info: suspiciousRev.length + procDisc.length,
      categories: {
        settlementsWithoutExternalRef: { count: noRef.length, items: noRef, rule: 'RWC-STRICT-001' },
        fictionalSettlements: { count: fictional.length, items: fictional, rule: 'RWC-STRICT-004' },
        unverifiedRevenue: { count: unverifiedRev.length, items: unverifiedRev, rule: 'RWC-STRICT-010' },
        suspiciousVerifiedRevenue: { count: suspiciousRev.length, items: suspiciousRev, rule: 'RWC-STRICT-011' },
        procurementDiscrepancies: { count: procDisc.length, items: procDisc, rule: 'RWC-PROC-001' },
        deliveredWithoutReceipt: { count: deliveredNoReceipt.length, items: deliveredNoReceipt, rule: 'RWC-PROC-002' },
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Audit/Violations]', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
