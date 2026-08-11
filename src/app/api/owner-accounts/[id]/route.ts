import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const account = await db.ownerAccount.findUnique({
      where: { id },
      include: {
        ownerPaymentConfig: {
          select: { id: true, label: true, splitPercentage: true, isActive: true },
        },
        settlements: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })

    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Owner account not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    console.error('Error fetching owner account:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch owner account' },
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

    const existing = await db.ownerAccount.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Owner account not found' },
        { status: 404 }
      )
    }

    // Handle isPrimary logic
    if (body.isPrimary === true && !existing.isPrimary) {
      await db.ownerAccount.updateMany({
        where: { accountType: existing.accountType, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    // Auto-generate derived fields if relevant fields changed
    let accountNumberLast = body.accountNumberLast
    let walletAddressShort = body.walletAddressShort

    if (body.accountNumber && existing.accountType === 'bank_wire') {
      accountNumberLast = body.accountNumber.slice(-4)
    }

    if (body.walletAddress && existing.accountType === 'l2_crypto') {
      const addr = body.walletAddress as string
      walletAddressShort = `${addr.slice(0, 6)}...${addr.slice(-4)}`
    }

    // Build update data with only provided fields
    const updateData: Record<string, unknown> = {}

    const updatableFields = [
      'label', 'isActive', 'isPrimary', 'sortOrder', 'purposes',
      'accountHolder', 'accountNumber', 'bankName', 'bankCode', 'branchCode',
      'swiftCode', 'routingNumber', 'countryCode', 'currency',
      'network', 'walletAddress', 'preferredToken', 'chainId', 'explorerUrl',
      'paypalEmail', 'paypalType', 'paypalCountry',
      'wiseEmail', 'wiseCurrency', 'payoneerId',
      'notes', 'verifiedAt', 'lastUsedAt', 'totalReceived', 'totalSent', 'txCount',
      'ownerPaymentConfigId',
    ] as const

    for (const field of updatableFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    // Always update derived fields if we have them
    if (accountNumberLast !== undefined) {
      updateData.accountNumberLast = accountNumberLast
    }
    if (walletAddressShort !== undefined) {
      updateData.walletAddressShort = walletAddressShort
    }

    const account = await db.ownerAccount.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    console.error('Error updating owner account:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update owner account' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.ownerAccount.findUnique({
      where: { id },
      include: {
        settlements: {
          where: {
            status: { in: ['pending', 'processing'] },
          },
        },
      },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Owner account not found' },
        { status: 404 }
      )
    }

    // Prevent soft-delete if active settlements exist
    if (existing.settlements.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot deactivate account: ${existing.settlements.length} active settlement(s) exist (pending or processing)`,
        },
        { status: 409 }
      )
    }

    const account = await db.ownerAccount.update({
      where: { id },
      data: { isActive: false, isPrimary: false },
    })

    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    console.error('Error deactivating owner account:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to deactivate owner account' },
      { status: 500 }
    )
  }
}
