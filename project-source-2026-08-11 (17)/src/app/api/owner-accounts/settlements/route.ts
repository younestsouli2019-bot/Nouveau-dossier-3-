import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const ownerAccountId = searchParams.get('ownerAccountId')
    const status = searchParams.get('status')
    const purpose = searchParams.get('purpose')
    const direction = searchParams.get('direction')

    const where: Record<string, unknown> = {}

    if (ownerAccountId) {
      where.ownerAccountId = ownerAccountId
    }
    if (status) {
      where.status = status
    }
    if (purpose) {
      where.purpose = purpose
    }
    if (direction) {
      where.direction = direction
    }

    const settlements = await db.ownerSettlement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    // Get all referenced accounts in one query
    const accountIds = [...new Set(settlements.map(s => s.ownerAccountId))]
    const accounts = await db.ownerAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true, label: true, accountType: true, currency: true,
        walletAddressShort: true, accountNumberLast: true,
        bankName: true, paypalEmail: true, wiseEmail: true,
      },
    })
    const accountMap = new Map(accounts.map(a => [a.id, a]))

    // Attach account info to each settlement
    const data = settlements.map(s => ({
      ...s,
      ownerAccount: accountMap.get(s.ownerAccountId) || null,
    }))

    // Summary
    const byStatus: Record<string, number> = {}
    const byPurpose: Record<string, number> = {}
    const byAccountType: Record<string, number> = {}

    for (const s of data) {
      byStatus[s.status] = (byStatus[s.status] || 0) + s.amount
      byPurpose[s.purpose] = (byPurpose[s.purpose] || 0) + s.amount
      if (s.ownerAccount) {
        byAccountType[s.ownerAccount.accountType] = (byAccountType[s.ownerAccount.accountType] || 0) + s.amount
      }
    }

    const summary = {
      total: data.length,
      totalAmount: data.reduce((sum, s) => sum + s.amount, 0),
      byStatus,
      byPurpose,
      byAccountType,
    }

    return NextResponse.json({ success: true, data, summary })
  } catch (error) {
    console.error('Error listing settlements:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list settlements' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ownerAccountId, amount, currency, status, direction, purpose } = body

    if (!ownerAccountId || amount === undefined || amount === null) {
      return NextResponse.json(
        { success: false, error: 'ownerAccountId and amount are required' },
        { status: 400 }
      )
    }

    const account = await db.ownerAccount.findUnique({ where: { id: ownerAccountId } })
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Owner account not found' },
        { status: 404 }
      )
    }

    const settlement = await db.ownerSettlement.create({
      data: {
        ownerAccountId,
        referenceId: body.referenceId || null,
        amount,
        currency: currency || 'USD',
        status: status || 'pending',
        direction: direction || 'inbound',
        purpose: purpose || 'general',
        description: body.description || null,
        sourceLabel: body.sourceLabel || null,
        destinationLabel: body.destinationLabel || null,
        fee: body.fee || 0,
        netAmount: body.netAmount ?? amount,
        exchangeRate: body.exchangeRate || null,
        settledAt: body.settledAt || null,
      },
    })

    return NextResponse.json({ success: true, data: settlement }, { status: 201 })
  } catch (error) {
    console.error('Error creating settlement:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create settlement' },
      { status: 500 }
    )
  }
}
