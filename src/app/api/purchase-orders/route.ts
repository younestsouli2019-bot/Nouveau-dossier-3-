import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'
import { enforcePrepaidPolicy } from '@/lib/strict-enforcement/strict-procurement'

/**
 * GET /api/purchase-orders
 * 🚧 PROTÉGÉ — fail-closed 401 si cross-origin sans x-ops-secret.
 * Même si read-only: fuite intelligence procurement (noms fournisseurs,
 * prix unitaires, statut des 161 worklist rows). Adversaire = recouvrement
 * Attijari identifiera les comptes fournisseurs cibles. Donc: AUTH obligatoire.
 */
export async function GET(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

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
      supplierNameDisplay: (po as any).supplier?.name || (po as any).supplierName,
      supplierCode: (po as any).supplier?.code || null,
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

/**
 * POST /api/purchase-orders — création d'un nouveau PO (statut initial DRAFT).
 * 🚧 PROTÉGÉ — fail-closed 401.
 *
 * IMPORTANT 4-LEDGER: un PO créé n'est JAMAIS apprové automatiquement,
 * même si <$500. La règle:
 *   draft → submit → pending_approval → HUMAN APPROVAL.
 * Aucun saut d'étape, aucun montant seuil d'auto-approve (règle supprimée
 * dans submit route P6).
 */
export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const body = await request.json()
    const {
      poNumber,
      supplierName,
      supplierId,
      title,
      priority,
      notes,
      batchRef,
      itemIds,
      ownerInitiated,
    } = body

    if (!poNumber || !supplierName) {
      return NextResponse.json(
        { success: false, error: 'poNumber and supplierName are required' },
        { status: 400 }
      )
    }

    // Check unique PO number
    const existing = await db.purchaseOrder.findUnique({ where: { poNumber } })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Purchase order with this number already exists' },
        { status: 409 }
      )
    }

    // Enforce pre-paid scope: only owner-initiated POs → prePaidBySwarm lock applies.
    // Third-party POs (ownerInitiated=false) allow normal terms.
    const ownerInitiatedResolved = ownerInitiated !== false
    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      const items = await db.procurementItem.findMany({ where: { id: { in: itemIds } } })
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

    // Calculate line items and total from attached items
    let lineItemCount = 0
    let totalAmount = 0
    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      const items = await db.procurementItem.findMany({
        where: { id: { in: itemIds } },
      })
      lineItemCount = items.length
      totalAmount = items.reduce((sum, item) => sum + (item.totalEst || 0), 0)
    }

    const actor = resolveOpsIdentity(request)

    const purchaseOrder = await db.purchaseOrder.create({
      data: {
        poNumber,
        supplierName,
        supplierId: supplierId || null,
        title: title || null,
        priority: priority || 'normal',
        notes: notes || null,
        batchRef: batchRef || null,
        lineItemCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        status: 'draft',
        ownerInitiated: ownerInitiatedResolved,
        // @ts-ignore createdBy added P6
        createdBy: actor,
      },
    })

    // Attach items to the PO
    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      for (let i = 0; i < itemIds.length; i++) {
        await db.procurementItem.update({
          where: { id: itemIds[i] },
          data: {
            purchaseOrderId: purchaseOrder.id,
            poLineItem: i + 1,
            supplierId: supplierId || undefined,
          },
        })
      }
    }

    return NextResponse.json({ success: true, data: purchaseOrder, createdBy: actor }, { status: 201 })
  } catch (error) {
    console.error('Error creating purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create purchase order' },
      { status: 500 }
    )
  }
}

/**
 * Identité vérifiée depuis header ops (NE JAMAIS retourner 'user'/'system' littéral).
 * Si cross-origin sans x-ops-secret: déjà rejeté par requireOpsAuth avant arrive ici.
 * Sinon same-origin UI → operator token session (owner-admin).
 */
function resolveOpsIdentity(request: NextRequest): string {
  const header = request.headers.get('x-ops-identity')
  if (header && header.trim().length >= 3) return header.trim().slice(0, 64)
  const opsSecret = request.headers.get('x-ops-secret')
  if (opsSecret) return 'ops-secret-authenticated'
  return 'same-origin-operator'
}
