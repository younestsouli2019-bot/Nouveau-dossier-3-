import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supplier = await db.supplier.findUnique({
      where: { id },
      include: {
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            poNumber: true,
            title: true,
            status: true,
            totalAmount: true,
            lineItemCount: true,
            currency: true,
            createdAt: true,
          },
        },
        procurementItems: {
          select: {
            id: true,
            name: true,
            status: true,
            totalEst: true,
            currency: true,
            createdAt: true,
          },
        },
      },
    })

    if (!supplier) {
      return NextResponse.json(
        { success: false, error: 'Supplier not found' },
        { status: 404 }
      )
    }

    const totalDelivered = supplier.totalDelivered || 0
    const onTimeRate = totalDelivered > 0 ? (supplier.deliveredOnTime / totalDelivered) * 100 : 0
    const defectRate = totalDelivered > 0 ? (supplier.itemsWithDefect / totalDelivered) * 100 : 0

    const enriched = {
      ...supplier,
      onTimeRate: Math.round(onTimeRate * 100) / 100,
      defectRate: Math.round(defectRate * 100) / 100,
    }

    return NextResponse.json({ success: true, data: enriched })
  } catch (error) {
    console.error('Error fetching supplier:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch supplier' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.supplier.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Supplier not found' },
        { status: 404 }
      )
    }

    // Check unique code if being updated
    if (body.code && body.code !== existing.code) {
      const codeExists = await db.supplier.findUnique({ where: { code: body.code } })
      if (codeExists) {
        return NextResponse.json(
          { success: false, error: 'Supplier with this code already exists' },
          { status: 409 }
        )
      }
    }

    const {
      code,
      name,
      website,
      country,
      contactEmail,
      contactPhone,
      paymentTerms,
      notes,
      isActive,
    } = body

    const supplier = await db.supplier.update({
      where: { id },
      data: {
        ...(code !== undefined && { code }),
        ...(name !== undefined && { name }),
        ...(website !== undefined && { website }),
        ...(country !== undefined && { country }),
        ...(contactEmail !== undefined && { contactEmail }),
        ...(contactPhone !== undefined && { contactPhone }),
        ...(paymentTerms !== undefined && { paymentTerms }),
        ...(notes !== undefined && { notes }),
        ...(isActive !== undefined && { isActive }),
      },
    })

    return NextResponse.json({ success: true, data: supplier })
  } catch (error) {
    console.error('Error updating supplier:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update supplier' },
      { status: 500 }
    )
  }
}
