import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { enforcePrepaidPolicy } from '@/lib/strict-enforcement/strict-procurement'

// PATCH /api/procurement/[id] - Update a procurement item
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.procurementItem.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Procurement item not found' },
        { status: 404 }
      )
    }

    const body = await request.json()

    const VALID_STATUSES = ['pending', 'ordered', 'shipped', 'delivered', 'cancelled']
    const VALID_PRIORITIES = ['normal', 'high', 'urgent']

    const updateData: Record<string, unknown> = {}

    // Handle allowed fields
    const allowedFields = [
      'name', 'brand', 'reference', 'category', 'quantity', 'unitPriceEst',
      'currency', 'recipientName', 'recipientAddress', 'deliveryAddress',
      'prePaidBySwarm', 'ownerInitiated', 'orderRef', 'supplier', 'notes', 'priority',
      'fulfillmentSource', 'status',
    ]

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'status') {
          if (!VALID_STATUSES.includes(body[field])) {
            return NextResponse.json(
              { success: false, error: `Invalid status: ${body[field]}` },
              { status: 400 }
            )
          }
        }
        if (field === 'priority' && !VALID_PRIORITIES.includes(body[field])) {
          return NextResponse.json(
            { success: false, error: `Invalid priority: ${body[field]}` },
            { status: 400 }
          )
        }
        updateData[field] = body[field]
      }
    }

    // Enforce pre-paid policy (non-destructive: coerce + flag violation)
    const ownerInitiated = body.ownerInitiated === false ? false : (existing as Record<string, unknown>).ownerInitiated !== false
    const prepaidRes = enforcePrepaidPolicy({
      prePaidBySwarm: body.prePaidBySwarm !== undefined ? !!body.prePaidBySwarm : (existing as Record<string, unknown>).prePaidBySwarm as boolean,
      ownerInitiated,
    })
    if (!prepaidRes.valid) {
      updateData.prePaidBySwarm = true
      if (!updateData.ownerInitiated) updateData.ownerInitiated = true
    } else {
      updateData.prePaidBySwarm = prepaidRes.prePaidBySwarm
      updateData.ownerInitiated = prepaidRes.ownerInitiated
    }
    if (prepaidRes.violations.length) {
      console.warn('[TRUTH-PROC-002] Pre-paid policy coercion applied:', prepaidRes.violations)
    }

    // Auto-set timestamps based on status changes
    if (body.status === 'ordered' && !existing.orderedAt) {
      updateData.orderedAt = new Date()
    }
    if (body.status === 'shipped' && !existing.shippedAt) {
      updateData.shippedAt = new Date()
    }
    if (body.status === 'delivered' && !existing.deliveredAt) {
      updateData.deliveredAt = new Date()
    }

    // Recalculate totalEst if quantity or unitPriceEst changed
    const newQty = body.quantity !== undefined ? Number(body.quantity) : existing.quantity
    const newUnitPrice = body.unitPriceEst !== undefined ? Number(body.unitPriceEst) : existing.unitPriceEst
    updateData.totalEst = newQty * newUnitPrice

    const updated = await db.procurementItem.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    console.error(`[PATCH /api/procurement/${'id'}] Error:`, error)
    return NextResponse.json(
      { success: false, error: 'Failed to update procurement item' },
      { status: 500 }
    )
  }
}

// GET /api/procurement/[id] - Get a single procurement item
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const item = await db.procurementItem.findUnique({ where: { id } })

    if (!item) {
      return NextResponse.json(
        { success: false, error: 'Procurement item not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, item })
  } catch (error) {
    console.error(`[GET /api/procurement/${'id'}] Error:`, error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch procurement item' },
      { status: 500 }
    )
  }
}
