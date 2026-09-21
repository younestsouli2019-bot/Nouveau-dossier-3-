import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkProcurementBudget, approvePurchaseOrderWithBudgetCheck } from '@/lib/strict-enforcement/strict-procurement'

function extractApprover(request: NextRequest): string {
  const h = request.headers.get('x-performed-by') || request.headers.get('x-submitted-by') || request.headers.get('x-ops-secret')
  if (h && h.length > 0) return h.length > 8 ? `${h.slice(0,8)}…${h.slice(-4)}` : h
  return 'system'
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const approver = extractApprover(request)

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
    const submitAudit = {
      purchaseOrderId: id,
      action: 'submitted' as const,
      performedBy: approver,
      fromStatus: 'draft',
      toStatus: 'pending_approval',
    }

    // Auto-approve POs under $500 — BUT ONLY IF budget check passes (fail-closed).
    // If budget check fails for <$500, do NOT approve; fall through to normal pending_approval.
    if (purchaseOrder.totalAmount < 500 && purchaseOrder.currency === 'USD') {
      try {
        const budget = await checkProcurementBudget(purchaseOrder.totalAmount, purchaseOrder.currency)
        if (budget.ok) {
          const r = await approvePurchaseOrderWithBudgetCheck(id, approver)
          if (r.approved) {
            // Ensure the 'submitted' audit row also exists for traceability (approvePurchaseOrder only writes 'approved').
            try {
              await db.pOApproval.create({ data: submitAudit }).catch(() => null)
            } catch {}
            return NextResponse.json({
              success: true,
              data: r.receipt,
              autoApproved: true,
              budgetCheck: { ok: true, spendable: budget.spendable, required: budget.required, currency: budget.currency },
            })
          }
        }
        // Budget fail for <$500: do NOT auto-approve (fail-closed). Continue pending_approval below.
      } catch (autoApprovalErr) {
        console.error('[PO submit] Auto-approval under $500 attempt failed; falling back to pending_approval:', autoApprovalErr)
      }
    }

    // Normal submit flow (or fallback from failed auto-approval)
    const [updated] = await db.$transaction([
      db.purchaseOrder.update({
        where: { id },
        data: {
          status: 'pending_approval',
          submittedAt: now,
        },
      }),
      db.pOApproval.create({ data: submitAudit }),
    ])

    return NextResponse.json({ success: true, data: updated, autoApproved: false })
  } catch (error) {
    console.error('Error submitting purchase order:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Failed to submit purchase order' },
      { status: 500 }
    )
  }
}
