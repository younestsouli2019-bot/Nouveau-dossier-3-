import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const suppliers = await db.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        purchaseOrders: {
          select: { id: true, status: true, totalAmount: true },
        },
        procurementItems: {
          select: { id: true, status: true },
        },
      },
    })

    const enriched = suppliers.map((s) => {
      const totalDelivered = s.totalDelivered || 0
      const onTimeRate = totalDelivered > 0 ? (s.deliveredOnTime / totalDelivered) * 100 : 0
      const defectRate = totalDelivered > 0 ? (s.itemsWithDefect / totalDelivered) * 100 : 0

      return {
        ...s,
        onTimeRate: Math.round(onTimeRate * 100) / 100,
        defectRate: Math.round(defectRate * 100) / 100,
        purchaseOrderCount: s.purchaseOrders.length,
        procurementItemCount: s.procurementItems.length,
      }
    })

    const summary = {
      total: enriched.length,
      active: enriched.filter((s) => s.isActive).length,
      inactive: enriched.filter((s) => !s.isActive).length,
    }

    return NextResponse.json({ success: true, suppliers: enriched, summary })
  } catch (error) {
    console.error('Error listing suppliers:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list suppliers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, name, website, country, contactEmail, contactPhone, paymentTerms, notes } = body

    if (!code || !name) {
      return NextResponse.json(
        { success: false, error: 'code and name are required' },
        { status: 400 }
      )
    }

    const existing = await db.supplier.findUnique({ where: { code } })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Supplier with this code already exists' },
        { status: 409 }
      )
    }

    const supplier = await db.supplier.create({
      data: {
        code,
        name,
        website: website || null,
        country: country || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        paymentTerms: paymentTerms || 'prepaid',
        notes: notes || null,
      },
    })

    return NextResponse.json({ success: true, data: supplier }, { status: 201 })
  } catch (error) {
    console.error('Error creating supplier:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create supplier' },
      { status: 500 }
    )
  }
}
