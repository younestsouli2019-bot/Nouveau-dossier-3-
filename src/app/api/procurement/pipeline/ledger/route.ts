import { NextRequest, NextResponse } from 'next/server'
import { getSwarmLedgerSnapshot, recordSwarmPayment } from '@/lib/procurement/settlement'

/**
 * GET  /api/procurement/pipeline/ledger — swarm ledger snapshot (revenue, spend, surplus)
 * POST /api/procurement/pipeline/ledger — pay procurement items from the swarm ledger
 *   Body: { procurementItemIds: string[], provider?: string, providerRef?: string }
 */
export async function GET() {
  try {
    const snapshot = await getSwarmLedgerSnapshot()
    return NextResponse.json({ success: true, snapshot })
  } catch (error) {
    console.error('Error reading swarm ledger:', error)
    return NextResponse.json({ success: false, error: 'Failed to read swarm ledger' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { procurementItemIds, provider, providerRef, performedBy } = body as {
      procurementItemIds: string[]
      provider?: string
      providerRef?: string
      performedBy?: string
    }

    if (!Array.isArray(procurementItemIds) || procurementItemIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'procurementItemIds (non-empty array) is required' },
        { status: 400 },
      )
    }

    const result = await recordSwarmPayment({
      procurementItemIds,
      provider,
      providerRef,
      performedBy: performedBy ?? 'api',
    })
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Error paying procurement from swarm ledger:', error)
    return NextResponse.json({ success: false, error: 'Failed to pay procurement from swarm ledger' }, { status: 500 })
  }
}
