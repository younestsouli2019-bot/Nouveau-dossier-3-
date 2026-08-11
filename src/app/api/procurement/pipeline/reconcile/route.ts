import { NextRequest, NextResponse } from 'next/server'
import { reconcileSwarmToOwnerAccounts } from '@/lib/procurement/settlement'

/**
 * POST /api/procurement/pipeline/reconcile
 * Body: { amount?: number }
 * Routes the swarm surplus to eligible owner accounts as INBOUND, PENDING
 * settlements. Owners only RECEIVE. Settlements stay 'pending' until a real
 * funded rail provides an externalRef (RWC-STRICT-001).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { amount } = body as { amount?: number }

    const result = await reconcileSwarmToOwnerAccounts({
      amount: typeof amount === 'number' && amount > 0 ? amount : undefined,
      performedBy: 'api',
    })

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Error reconciling swarm to owner accounts:', error)
    return NextResponse.json({ success: false, error: 'Failed to reconcile swarm to owner accounts' }, { status: 500 })
  }
}
