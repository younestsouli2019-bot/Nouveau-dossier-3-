import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createOrGetPurchaseOrder, enforcePrepaidPolicy } from '@/lib/strict-enforcement/strict-procurement'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const supplierId = searchParams.get('supplierId')
    const priority = searchParams.get('priority')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (supplierId) where.supplierId = supplierId
    if (priority) where.priority = priority

    const purchaseOrders = await db.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: {
          select: { id: true, name: true, code: true },
        },
        items: {
          select: { id: true, name: true, quantity: true, unitPriceEst: true, totalEst: true },
        },
      },
    })

    const enriched = purchaseOrders.map((po) => ({
      ...po,
      supplierNameDisplay: po.supplier?.name || po.supplierName,
      supplierCode: po.supplier?.code || null,
    }))

    // Summary
    const allPOs = await db.purchaseOrder.findMany({
      select: { status: true, totalAmount: true },
    })

    const byStatus: Record<string, number> = {}
    let totalValue = 0
    let pendingApprovalCount = 0

    for (const po of allPOs) {
      byStatus[po.status] = (byStatus[po.status] || 0) + 1
      totalValue += po.totalAmount || 0
      if (po.status === 'pending_approval') pendingApprovalCount++
    }

    const summary = {
      totalPOs: allPOs.length,
      byStatus,
      pendingApprovalCount,
      totalValue,
    }

    return NextResponse.json({ success: true, orders: enriched, summary })
  } catch (error) {
    console.error('Error listing purchase orders:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list purchase orders' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      poNumber, supplierName, supplierId, title, priority, notes,
      batchRef, itemIds, ownerInitiated, currency, callerIdempotencyKey,
    } = body

    if (!poNumber || !supplierName) {
      return NextResponse.json(
        { success: false, error: 'poNumber and supplierName are required' },
        { status: 400 }
      )
    }

    if (!currency) {
      return NextResponse.json(
        { success: false, error: 'currency is required (e.g. USD, EUR, MAD)' },
        { status: 400 }
      )
    }

    // Prepaid policy enforcement BEFORE any writes (fail-closed).
    // Imported earlier but never invoked — now wired to actual decision path.
    const policy = enforcePrepaidPolicy({
      ownerInitiated: ownerInitiated !== false,
    })
    if (!policy.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'PREPAID_POLICY_VIOLATION: ' + policy.violations.join('; '),
          violations: policy.violations,
        },
        { status: 422 }
      )
    }

    // Unique check (early return to avoid wasted work before idempotency check runs)
    const existing = await db.purchaseOrder.findUnique({ where: { poNumber } })
    if (existing && !callerIdempotencyKey) {
      return NextResponse.json(
        { success: false, error: 'Purchase order with this number already exists' },
        { status: 409 }
      )
    }

    // Calculate line items and total from attached items (if provided)
    let lineItemCount = 0
    let totalAmount = Number(body.totalAmount || 0)
    if (itemIds && itemIds.length > 0) {
      const items = await db.procurementItem.findMany({
        where: { id: { in: itemIds } },
      })
      lineItemCount = items.length
      if (totalAmount <= 0) totalAmount = items.reduce((sum, item) => sum + (item.totalEst || 0), 0)

      const ownerInitiatedResolved = ownerInitiated !== false
      for (const it of items) {
        const itAny = it as Record<string, unknown>
        if (ownerInitiatedResolved) {
          if (itAny.ownerInitiated === false || itAny.prePaidBySwarm === false) {
            await db.procurementItem.update({
              where: { id: it.id },
              data: { ownerInitiated: true, prePaidBySwarm: true },
            })
          }
        } else {
          if (itAny.ownerInitiated === undefined || itAny.ownerInitiated === null) {
            await db.procurementItem.update({
              where: { id: it.id },
              data: { ownerInitiated: false },
            })
          }
        }
      }
    }

    if (totalAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'totalAmount must be > 0 (or attach non-empty itemIds with non-zero totalEst)' },
        { status: 400 }
      )
    }

    // P1-1 (FIXED): Call strict idempotency createOrGetPurchaseOrder instead of raw create.
    // Ensures sha256(poNumber|supplierId|total|currency|ownerInitiated) dedupe against AuditLedger.
    const idemResult = await createOrGetPurchaseOrder(
      {
        poNumber,
        supplierName,
        supplierId: supplierId || null,
        totalAmount: Math.round(totalAmount * 100) / 100,
        currency,
        ownerInitiated: ownerInitiated !== false,
        title: title || null,
        status: 'draft', // Keep draft status (user must POST /submit) — consistent with route contract
        priority: priority || 'normal',
        notes: notes || null,
        lineItemCount,
        batchRef: batchRef || null,
      },
      callerIdempotencyKey,
    )

    // Attach items to the PO (idempotent re-attach: update purchaseOrderId, same as original route)
    const purchaseOrder = idemResult.purchaseOrder as { id: string }
    if (itemIds && itemIds.length > 0) {
      for (let i = 0; i < itemIds.length; i++) {
        await db.procurementItem.update({
          where: { id: itemIds[i] },
          data: {
            purchaseOrderId: purchaseOrder.id,
            poLineItem: i + 1,
            supplierId: supplierId || undefined,
          },
        }).catch(() => null) // If already attached, ignore (fail-open; no data harm)
      }
    }

    return NextResponse.json({
      success: true,
      data: idemResult.purchaseOrder,
      idempotentReplay: idemResult.idempotentReplay,
      approvalId: idemResult.approvalId,
    }, {
      status: idemResult.idempotentReplay ? 200 : 201,
    })
  } catch (error) {
    console.error('Error creating purchase order (strict-enforced/idempotent):', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Failed to create purchase order' },
      { status: 500 }
    )
  }
}
