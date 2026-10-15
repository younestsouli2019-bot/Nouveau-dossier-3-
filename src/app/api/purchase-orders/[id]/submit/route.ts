import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * POST /api/purchase-orders/[id]/submit
 * Soumet un PO statut DRAFT vers statut PENDING_APPROVAL.
 *
 * 🚧 PROTÉGÉ: requireOpsAuth en tête.
 * 🚫 4-LEDGER HARD RULE: JAMAIS D'AUTO-APPROBATION, MÊME SOUS $500.
 *    (Cette règle était présente L29-62 en ancienne version. SUPPRIMÉE.)
 *    Toute approbation requiert une identité humaine vérifiée via POST
 *    /approve ou /bulk-approve (tous deux auth-gated).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const { id } = await params
    const actor = resolveOpsIdentity(request)

    const purchaseOrder = await db.purchaseOrder.findUnique({ where: { id } })
    if (!purchaseOrder) {
      return NextResponse.json(
        { success: false, error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    if (purchaseOrder.status !== 'draft') {
      return NextResponse.json(
        { success: false, error: `Cannot submit PO in status '${purchaseOrder.status}'` },
        { status: 400 }
      )
    }

    const now = new Date()

    // Normal submit flow — SEULEMENT vers pending_approval.
    // Pas d'auto-approve. Jamais.
    const [updated] = await db.$transaction([
      db.purchaseOrder.update({
        where: { id },
        data: {
          status: 'pending_approval',
          submittedAt: now,
          // @ts-ignore
          submittedBy: actor,
        },
      }),
      db.pOApproval.create({
        data: {
          purchaseOrderId: id,
          action: 'submitted',
          performedBy: actor,
          fromStatus: 'draft',
          toStatus: 'pending_approval',
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      data: updated,
      autoApproved: false,  // JAMAIS true
      nextStep: 'pending_human_approval_required',
    })
  } catch (error) {
    console.error('Error submitting purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to submit purchase order' },
      { status: 500 }
    )
  }
}

function resolveOpsIdentity(request: NextRequest): string {
  const header = request.headers.get('x-ops-identity')
  if (header && header.trim().length >= 3) return header.trim().slice(0, 64)
  const opsSecret = request.headers.get('x-ops-secret')
  if (opsSecret) return 'ops-secret-authenticated'
  return 'same-origin-operator'
}
