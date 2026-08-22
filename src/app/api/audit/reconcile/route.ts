import { NextResponse } from 'next/server'
import { runFullReconciliation } from '@/lib/strict-enforcement'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const report = await runFullReconciliation()
    return NextResponse.json({ success: true, ...report })
  } catch (error) {
    console.error('[Audit/Reconcile]', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
