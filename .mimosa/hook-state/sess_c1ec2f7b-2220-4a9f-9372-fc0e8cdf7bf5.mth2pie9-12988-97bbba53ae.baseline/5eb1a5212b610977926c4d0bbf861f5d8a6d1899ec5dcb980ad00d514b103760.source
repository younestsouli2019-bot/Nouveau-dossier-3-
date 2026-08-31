import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const VALID_TYPES = ['bank_wire', 'l2_crypto', 'paypal', 'wise', 'payoneer', 'internal_pool']

const REQUIRED_FIELDS: Record<string, string[]> = {
  bank_wire: ['accountHolder', 'accountNumber', 'bankName', 'countryCode'],
  l2_crypto: ['network', 'walletAddress', 'preferredToken'],
  paypal: ['paypalEmail', 'paypalType'],
  wise: ['wiseEmail', 'wiseCurrency'],
  payoneer: ['payoneerId'],
  internal_pool: [],
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const accountType = searchParams.get('accountType')
    const isActive = searchParams.get('isActive')
    const purpose = searchParams.get('purpose')

    const where: Record<string, unknown> = {}

    if (accountType) {
      where.accountType = accountType
    }
    if (isActive !== null && isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true'
    }
    if (purpose) {
      where.purposes = { contains: purpose }
    }

    const accounts = await db.ownerAccount.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: {
          select: { settlements: true },
        },
        ownerPaymentConfig: {
          select: { id: true, label: true },
        },
      },
    })

    const totalReceived = accounts.reduce((sum, a) => sum + (a.totalReceived || 0), 0)
    const totalSent = accounts.reduce((sum, a) => sum + (a.totalSent || 0), 0)

    const byType: Record<string, number> = {}
    for (const a of accounts) {
      byType[a.accountType] = (byType[a.accountType] || 0) + 1
    }

    // Map _count.settlements to _settlementCount for frontend
    const mappedAccounts = accounts.map((a) => ({
      ...a,
      _settlementCount: a._count?.settlements ?? 0,
      _count: undefined,
    }))

    const summary = {
      total: accounts.length,
      byType,
      activeCount: accounts.filter((a) => a.isActive).length,
      totalReceived,
      totalSent,
    }

    return NextResponse.json({ success: true, data: mappedAccounts, summary })
  } catch (error) {
    console.error('Error listing owner accounts:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list owner accounts' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountType, label } = body

    if (!accountType || !label) {
      return NextResponse.json(
        { success: false, error: 'accountType and label are required' },
        { status: 400 }
      )
    }

    if (!VALID_TYPES.includes(accountType)) {
      return NextResponse.json(
        { success: false, error: `Invalid accountType. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate required fields based on accountType
    const required = REQUIRED_FIELDS[accountType] || []
    const missingFields = required.filter((f) => !body[f])
    if (missingFields.length > 0) {
      return NextResponse.json(
        { success: false, error: `Missing required fields for ${accountType}: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // Handle isPrimary logic
    if (body.isPrimary) {
      await db.ownerAccount.updateMany({
        where: { accountType, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    // Auto-generate derived fields
    let accountNumberLast = body.accountNumberLast || null
    let walletAddressShort = body.walletAddressShort || null

    if (accountType === 'bank_wire' && body.accountNumber && !accountNumberLast) {
      accountNumberLast = body.accountNumber.slice(-4)
    }

    if (accountType === 'l2_crypto' && body.walletAddress && !walletAddressShort) {
      const addr = body.walletAddress as string
      walletAddressShort = `${addr.slice(0, 6)}...${addr.slice(-4)}`
    }

    // Determine max sortOrder
    const maxSort = await db.ownerAccount.aggregate({
      _max: { sortOrder: true },
    })
    const nextSort = (maxSort._max.sortOrder || 0) + 1

    const account = await db.ownerAccount.create({
      data: {
        label,
        accountType,
        isActive: body.isActive ?? true,
        isPrimary: body.isPrimary ?? false,
        sortOrder: body.sortOrder ?? nextSort,
        purposes: body.purposes || 'general',

        // Bank Wire fields
        accountHolder: body.accountHolder || null,
        accountNumber: body.accountNumber || null,
        accountNumberLast,
        bankName: body.bankName || null,
        bankCode: body.bankCode || null,
        branchCode: body.branchCode || null,
        swiftCode: body.swiftCode || null,
        routingNumber: body.routingNumber || null,
        countryCode: body.countryCode || null,
        currency: body.currency || 'USD',

        // L2 Crypto fields
        network: body.network || null,
        walletAddress: body.walletAddress || null,
        walletAddressShort,
        preferredToken: body.preferredToken || null,
        chainId: body.chainId || null,
        explorerUrl: body.explorerUrl || null,

        // PayPal fields
        paypalEmail: body.paypalEmail || null,
        paypalType: body.paypalType || null,
        paypalCountry: body.paypalCountry || null,

        // Wise / Payoneer fields
        wiseEmail: body.wiseEmail || null,
        wiseCurrency: body.wiseCurrency || null,
        payoneerId: body.payoneerId || null,

        // Metadata
        notes: body.notes || null,
        verifiedAt: body.verifiedAt || null,
        ownerPaymentConfigId: body.ownerPaymentConfigId || null,
      },
    })

    return NextResponse.json({ success: true, data: account }, { status: 201 })
  } catch (error) {
    console.error('Error creating owner account:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create owner account' },
      { status: 500 }
    )
  }
}
