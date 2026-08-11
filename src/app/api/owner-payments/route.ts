import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SALARY_RIB = '[REDACTED]'
const SALARY_BANK = 'Attijariwafa Bank'
const SALARY_SWIFT = 'BCMAMAMC'
const DEBTS_RIB = '[REDACTED]'
const DEBTS_BANK = 'Attijariwafa Compte sur Carnet'
const DEBTS_SWIFT = 'BCMAMAMC'

const CONFIG_SEED = [
  {
    label: 'Salary',
    splitPercentage: 10.0,
    ribLabel: 'Salary Account',
    ribNumber: SALARY_RIB,
    swiftCode: SALARY_SWIFT,
    bankName: SALARY_BANK,
    notes: 'Owner salary - 10% of revenue',
  },
  {
    label: 'Debts',
    splitPercentage: 40.0,
    ribLabel: 'Debts Account',
    ribNumber: DEBTS_RIB,
    swiftCode: DEBTS_SWIFT,
    bankName: DEBTS_BANK,
    notes: 'Debt repayments - 40% of revenue',
  },
  {
    label: 'Emergency',
    splitPercentage: 10.0,
    ribLabel: 'Salary Account',
    ribNumber: SALARY_RIB,
    swiftCode: SALARY_SWIFT,
    bankName: SALARY_BANK,
    notes: 'Emergency fund - 10% of revenue (same RIB as Salary)',
  },
  {
    label: 'Infrastructure',
    splitPercentage: 15.0,
    ribLabel: 'Salary Account',
    ribNumber: SALARY_RIB,
    swiftCode: SALARY_SWIFT,
    bankName: SALARY_BANK,
    notes: 'Infrastructure costs - 15% of revenue (same RIB as Salary)',
  },
  {
    label: 'Operational Costs',
    splitPercentage: 25.0,
    ribLabel: 'Salary Account',
    ribNumber: SALARY_RIB,
    swiftCode: SALARY_SWIFT,
    bankName: SALARY_BANK,
    notes: 'Operational costs - 25% of revenue (same RIB as Salary)',
  },
]

const PAYMENT_SEED = [
  // 4 Salary payments stuck in Banking Circle
  {
    configLabel: 'Salary',
    amount: 450.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    ribNumber: SALARY_RIB,
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB ' + SALARY_RIB,
  },
  {
    configLabel: 'Salary',
    amount: 890.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    ribNumber: SALARY_RIB,
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB ' + SALARY_RIB,
  },
  {
    configLabel: 'Salary',
    amount: 120.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    ribNumber: SALARY_RIB,
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB ' + SALARY_RIB,
  },
  {
    configLabel: 'Salary',
    amount: 670.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    ribNumber: SALARY_RIB,
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB ' + SALARY_RIB,
  },
  // 3 Salary payments stuck in Operational Pool
  {
    configLabel: 'Salary',
    amount: 350.0,
    status: 'stuck_in_transition',
    destinationType: 'operational_pool',
    destinationLabel: 'Operational Pool - Misrouted',
    ribNumber: SALARY_RIB,
    failureReason: 'Routing misconfigured - salary funds routed to operational pool instead of external bank',
  },
  {
    configLabel: 'Salary',
    amount: 520.0,
    status: 'stuck_in_transition',
    destinationType: 'operational_pool',
    destinationLabel: 'Operational Pool - Misrouted',
    ribNumber: SALARY_RIB,
    failureReason: 'Routing misconfigured - salary funds routed to operational pool instead of external bank',
  },
  {
    configLabel: 'Salary',
    amount: 280.0,
    status: 'stuck_in_transition',
    destinationType: 'operational_pool',
    destinationLabel: 'Operational Pool - Misrouted',
    ribNumber: SALARY_RIB,
    failureReason: 'Routing misconfigured - salary funds routed to operational pool instead of external bank',
  },
  // 2 Debts payments processing (MT103 batches)
  {
    configLabel: 'Debts',
    amount: 2850.0,
    status: 'processing',
    destinationType: 'external_bank',
    destinationLabel: `Attijariwafa Compte sur Carnet - RIB ...${DEBTS_RIB.slice(-6)}`,
    ribNumber: DEBTS_RIB,
    sourceTxRef: 'MT103-DEBTS-BATCH-001',
    failureReason: null,
  },
  {
    configLabel: 'Debts',
    amount: 1520.0,
    status: 'processing',
    destinationType: 'external_bank',
    destinationLabel: `Attijariwafa Compte sur Carnet - RIB ...${DEBTS_RIB.slice(-6)}`,
    ribNumber: DEBTS_RIB,
    sourceTxRef: 'MT103-DEBTS-BATCH-002',
    failureReason: null,
  },
  // 1 Operational Costs stuck in Transition Pool
  {
    configLabel: 'Operational Costs',
    amount: 1100.0,
    status: 'stuck_in_transition',
    destinationType: 'transition_pool',
    destinationLabel: 'Transition Pool - Awaiting routing',
    ribNumber: SALARY_RIB,
    failureReason: 'Payment stuck in transition pool - routing configuration incomplete',
  },
]

async function ensureConfigs() {
  for (const cfg of CONFIG_SEED) {
    await db.ownerPaymentConfig.upsert({
      where: { label: cfg.label },
      update: {
        splitPercentage: cfg.splitPercentage,
        ribLabel: cfg.ribLabel,
        ribNumber: cfg.ribNumber,
        swiftCode: cfg.swiftCode,
        bankName: cfg.bankName,
        notes: cfg.notes,
      },
      create: {
        label: cfg.label,
        splitPercentage: cfg.splitPercentage,
        ribLabel: cfg.ribLabel,
        ribNumber: cfg.ribNumber,
        swiftCode: cfg.swiftCode,
        bankName: cfg.bankName,
        isActive: true,
        notes: cfg.notes,
      },
    })
  }
}

async function seedPayments() {
  let created = 0
  let skipped = 0

  for (const p of PAYMENT_SEED) {
    const config = await db.ownerPaymentConfig.findUnique({
      where: { label: p.configLabel },
    })

    // Skip if payment with same config label + amount + destination type already exists
    const existing = await db.ownerPayment.findFirst({
      where: {
        configLabel: p.configLabel,
        amount: p.amount,
        destinationType: p.destinationType,
      },
    })
    if (existing) {
      skipped++
      continue
    }

    await db.ownerPayment.create({
      data: {
        configId: config?.id || null,
        configLabel: p.configLabel,
        amount: p.amount,
        currency: 'USD',
        sourceTxRef: (p as Record<string, unknown>).sourceTxRef as string | null || null,
        status: p.status,
        destinationType: p.destinationType,
        destinationLabel: p.destinationLabel,
        ribNumber: p.ribNumber,
        failureReason: p.failureReason,
        recovered: false,
      },
    })
    created++
  }

  return { created, skipped }
}

// GET /api/owner-payments
export async function GET() {
  try {
    // Idempotent: ensure configs exist
    await ensureConfigs()

    const configs = await db.ownerPaymentConfig.findMany({
      orderBy: { splitPercentage: 'desc' },
    })

    const payments = await db.ownerPayment.findMany({
      orderBy: { createdAt: 'desc' },
    })

    const totalAmount = payments.reduce((s, p) => s + p.amount, 0)
    const stuckAmount = payments.filter(p => p.status === 'stuck_in_transition').reduce((s, p) => s + p.amount, 0)
    const stuckCount = payments.filter(p => p.status === 'stuck_in_transition').length
    const processingAmount = payments.filter(p => p.status === 'processing').reduce((s, p) => s + p.amount, 0)
    const recoveredAmount = payments.filter(p => p.recovered).reduce((s, p) => s + (p.recoveryAmount || 0), 0)

    const byStatus: Record<string, { count: number; amount: number }> = {}
    const byConfig: Record<string, { count: number; amount: number }> = {}
    const byDestType: Record<string, { count: number; amount: number }> = {}

    for (const p of payments) {
      if (!byStatus[p.status]) byStatus[p.status] = { count: 0, amount: 0 }
      byStatus[p.status].count++
      byStatus[p.status].amount += p.amount

      if (!byConfig[p.configLabel]) byConfig[p.configLabel] = { count: 0, amount: 0 }
      byConfig[p.configLabel].count++
      byConfig[p.configLabel].amount += p.amount

      if (!byDestType[p.destinationType]) byDestType[p.destinationType] = { count: 0, amount: 0 }
      byDestType[p.destinationType].count++
      byDestType[p.destinationType].amount += p.amount
    }

    return NextResponse.json({
      success: true,
      configs,
      payments,
      summary: {
        totalPayments: payments.length,
        totalAmount,
        stuckCount,
        stuckAmount,
        processingAmount,
        recoveredAmount,
        configsTotal: configs.length,
        configsActive: configs.filter(c => c.isActive).length,
        routingFixed: configs.filter(c => c.routingFixed).length,
      },
      breakdown: { byStatus, byConfig, byDestType },
    })
  } catch (error) {
    console.error('[GET /api/owner-payments] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch owner payments' }, { status: 500 })
  }
}

// POST /api/owner-payments
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items = Array.isArray(body) ? body : [body]
    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'No items provided' }, { status: 400 })
    }

    await ensureConfigs()

    const created: unknown[] = []
    for (const item of items) {
      if (!item.configLabel || item.amount === undefined) continue

      const config = await db.ownerPaymentConfig.findUnique({
        where: { label: item.configLabel },
      })

      created.push(
        await db.ownerPayment.create({
          data: {
            configId: config?.id || null,
            configLabel: item.configLabel,
            amount: Number(item.amount),
            currency: item.currency || 'USD',
            sourceTxRef: item.sourceTxRef || null,
            status: item.status || 'pending',
            destinationType: item.destinationType || 'external_bank',
            destinationLabel: item.destinationLabel || null,
            ribNumber: item.ribNumber || config?.ribNumber || null,
            failureReason: item.failureReason || null,
            recovered: item.recovered || false,
          },
        })
      )
    }

    return NextResponse.json({ success: true, created, count: created.length })
  } catch (error) {
    console.error('[POST /api/owner-payments] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to create owner payment(s)' }, { status: 500 })
  }
}
