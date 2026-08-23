import { NextResponse } from 'next/server'
import { getAuditChain, verifyAuditChainIntegrity, getLedgerSnapshots } from '@/lib/strict-enforcement'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [chain, integrity, snapshots] = await Promise.all([
      getAuditChain(100),
      verifyAuditChainIntegrity(),
      getLedgerSnapshots(10),
    ])
    return NextResponse.json({ success: true, chain, integrity, snapshots })
  } catch (error) {
    console.error('[Audit/Chain]', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
