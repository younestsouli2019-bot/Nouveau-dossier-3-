import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * Destinations owner = SHA-256 fingerprints uniquement.
 *
 * Jamais de RIB littéral dans le code source (RGPD article 9 + règle 36AC-2 :
 * credentials & PII bancaires en variables d'env / DB OwnerAccount résolues
 * runtime, jamais hardcodées).
 *
 * Fingerprints ci-dessous = SHA-256(rib.trim().toLowerCase()) hex 64 chars.
 * Pour régénérer offline (signataire HORS IDE):
 *   node -e "const {createHash}=require('crypto');
 *     const rib='<RIB>';
 *     console.log(createHash('sha256').update(rib.trim().toLowerCase()).digest('hex'))"
 *
 * Puis insérer dans OWNER ACCOUNT rows via psql / admin panel, label = 'Salary' / 'Debts'.
 */
type FingerprintMeta = {
  label: string
  splitPercentage: number
  ribFingerprint: string    // sha256(rib) — la valeur résolue est en DB OwnerAccount
  swiftCode: string
  bankName: string
  ribLabel: string
  notes: string
}

/**
 * Résout un fingerprint SHA-256 en RIB masqué affichable (6 derniers chiffres
 * seulement), depuis DB OwnerAccount. Runtime only, zero littéral.
 * Retourne null si aucune ligne active ne matche.
 */
async function resolveDisplayRibByFingerprint(fp: string): Promise<string | null> {
  if (!fp || fp.length !== 64) return null
  const accounts = await db.ownerAccount.findMany({
    where: { isActive: true, NOT: { accountNumber: null } },
    select: { accountNumber: true, label: true },
  })
  for (const a of accounts) {
    const rib = a.accountNumber
    if (!rib) continue
    const hex = createHash('sha256').update(String(rib).trim().toLowerCase()).digest('hex')
    if (hex === fp) {
      const s = String(rib)
      return s.length >= 6 ? '***' + s.slice(-6) : '***'
    }
  }
  return null
}

async function fingerprintOfActiveLabel(label: string): Promise<string | null> {
  const rows = await db.ownerAccount.findMany({
    where: { isActive: true, label },
    select: { accountNumber: true },
  })
  for (const r of rows) {
    if (!r.accountNumber) continue
    return createHash('sha256').update(String(r.accountNumber).trim().toLowerCase()).digest('hex')
  }
  return null
}

/**
 * CONFIG SEED — ne contient AUCUN RIB littéral.
 * Les ribFingerprint sont soit une empreinte offline, soit null.
 * Si null, le endpoint POST /api/owner-payments/fixup (hors scope de ce patch)
 * pourra alimenter DB OwnerAccount → fingerprints settés runtime.
 */
const CONFIG_SEED: FingerprintMeta[] = [
  {
    label: 'Salary',
    splitPercentage: 10.0,
    ribLabel: 'Salary Account',
    ribFingerprint: 'SALARY_RIB_SHA256_PLACEHOLDER_FROM_ENV_OR_OFFLINE',
    swiftCode: 'BCMAMAMC',
    bankName: 'Attijariwafa Bank',
    notes: 'Owner salary - 10% of revenue (RIB stored in DB OwnerAccount, label=Salary)',
  },
  {
    label: 'Debts',
    splitPercentage: 40.0,
    ribLabel: 'Debts Account',
    ribFingerprint: 'DEBTS_RIB_SHA256_PLACEHOLDER_FROM_ENV_OR_OFFLINE',
    swiftCode: 'BCMAMAMC',
    bankName: 'Attijariwafa Compte sur Carnet',
    notes: 'Debt repayments - 40% of revenue (RIB stored in DB OwnerAccount, label=Debts)',
  },
  {
    label: 'Emergency',
    splitPercentage: 10.0,
    ribLabel: 'Salary Account',
    ribFingerprint: 'SALARY_RIB_SHA256_PLACEHOLDER_FROM_ENV_OR_OFFLINE',
    swiftCode: 'BCMAMAMC',
    bankName: 'Attijariwafa Bank',
    notes: 'Emergency fund - 10% of revenue (routes to Salary OwnerAccount)',
  },
  {
    label: 'Infrastructure',
    splitPercentage: 15.0,
    ribLabel: 'Salary Account',
    ribFingerprint: 'SALARY_RIB_SHA256_PLACEHOLDER_FROM_ENV_OR_OFFLINE',
    swiftCode: 'BCMAMAMC',
    bankName: 'Attijariwafa Bank',
    notes: 'Infrastructure costs - 15% of revenue (routes to Salary OwnerAccount)',
  },
  {
    label: 'Operational Costs',
    splitPercentage: 25.0,
    ribLabel: 'Salary Account',
    ribFingerprint: 'SALARY_RIB_SHA256_PLACEHOLDER_FROM_ENV_OR_OFFLINE',
    swiftCode: 'BCMAMAMC',
    bankName: 'Attijariwafa Bank',
    notes: 'Operational costs - 25% of revenue (routes to Salary OwnerAccount)',
  },
]

type SeedPaymentRow = {
  configLabel: string
  amount: number
  status: 'stuck_in_transition' | 'processing'
  destinationType:
    | 'banking_circle'
    | 'operational_pool'
    | 'external_bank'
    | 'transition_pool'
  destinationLabel: string
  sourceTxRef?: string | null
  referenceLabel: string   // Salary ou Debts (résout fingerprint DB)
  failureReason: string | null
}

const PAYMENT_SEED: SeedPaymentRow[] = [
  // 4 Salary payments stuck in Banking Circle
  {
    configLabel: 'Salary',
    amount: 450.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    referenceLabel: 'Salary',
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB fingerprint (resolve DB OwnerAccount label=Salary)',
  },
  {
    configLabel: 'Salary',
    amount: 890.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    referenceLabel: 'Salary',
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB fingerprint (resolve DB OwnerAccount label=Salary)',
  },
  {
    configLabel: 'Salary',
    amount: 120.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    referenceLabel: 'Salary',
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB fingerprint (resolve DB OwnerAccount label=Salary)',
  },
  {
    configLabel: 'Salary',
    amount: 670.0,
    status: 'stuck_in_transition',
    destinationType: 'banking_circle',
    destinationLabel: 'Banking Circle Internal - Misrouted',
    referenceLabel: 'Salary',
    failureReason: 'Routing misconfigured - salary funds sent to Banking Circle internal pool instead of external bank RIB fingerprint (resolve DB OwnerAccount label=Salary)',
  },
  // 3 Salary payments stuck in Operational Pool
  {
    configLabel: 'Salary',
    amount: 350.0,
    status: 'stuck_in_transition',
    destinationType: 'operational_pool',
    destinationLabel: 'Operational Pool - Misrouted',
    referenceLabel: 'Salary',
    failureReason: 'Routing misconfigured - salary funds routed to operational pool instead of external bank (resolve DB OwnerAccount label=Salary)',
  },
  {
    configLabel: 'Salary',
    amount: 520.0,
    status: 'stuck_in_transition',
    destinationType: 'operational_pool',
    destinationLabel: 'Operational Pool - Misrouted',
    referenceLabel: 'Salary',
    failureReason: 'Routing misconfigured - salary funds routed to operational pool instead of external bank (resolve DB OwnerAccount label=Salary)',
  },
  {
    configLabel: 'Salary',
    amount: 280.0,
    status: 'stuck_in_transition',
    destinationType: 'operational_pool',
    destinationLabel: 'Operational Pool - Misrouted',
    referenceLabel: 'Salary',
    failureReason: 'Routing misconfigured - salary funds routed to operational pool instead of external bank (resolve DB OwnerAccount label=Salary)',
  },
  // 2 Debts payments processing (MT103 batches)
  {
    configLabel: 'Debts',
    amount: 2850.0,
    status: 'processing',
    destinationType: 'external_bank',
    destinationLabel: 'Attijariwafa Compte sur Carnet - RIB (resolved via DB OwnerAccount label=Debts)',
    referenceLabel: 'Debts',
    sourceTxRef: 'MT103-DEBTS-BATCH-001',
    failureReason: null,
  },
  {
    configLabel: 'Debts',
    amount: 1520.0,
    status: 'processing',
    destinationType: 'external_bank',
    destinationLabel: 'Attijariwafa Compte sur Carnet - RIB (resolved via DB OwnerAccount label=Debts)',
    referenceLabel: 'Debts',
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
    referenceLabel: 'Salary',
    failureReason: 'Payment stuck in transition pool - routing configuration incomplete',
  },
]

async function ensureConfigs() {
  for (const cfg of CONFIG_SEED) {
    // runtime fingerprint override: DB OwnerAccount label wins over placeholder
    let fp = cfg.ribFingerprint
    if (fp.includes('PLACEHOLDER_FROM_ENV_OR_OFFLINE')) {
      const liveFp = await fingerprintOfActiveLabel(cfg.label)
      if (liveFp) fp = liveFp
    }
    // @ts-ignore ribFingerprintSha256 exist sur types après prisma generate
    await db.ownerPaymentConfig.upsert({
      where: { label: cfg.label },
      update: {
        splitPercentage: cfg.splitPercentage,
        ribLabel: cfg.ribLabel,
        // @ts-ignore
        ribFingerprintSha256: fp.startsWith('SALARY_') || fp.startsWith('DEBTS_') ? null : fp,
        swiftCode: cfg.swiftCode,
        bankName: cfg.bankName,
        notes: cfg.notes,
      },
      create: {
        label: cfg.label,
        splitPercentage: cfg.splitPercentage,
        ribLabel: cfg.ribLabel,
        // @ts-ignore
        ribFingerprintSha256: fp.startsWith('SALARY_') || fp.startsWith('DEBTS_') ? null : fp,
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

    // resolve rib display: referenceLabel → fingerprint → *** last6 (rib source NEVER logged)
    const fp = CONFIG_SEED.find(c => c.label === p.referenceLabel)?.ribFingerprint || null
    const ribDisplayMasked = fp && fp.length === 64 ? await resolveDisplayRibByFingerprint(fp) : null

    // @ts-ignore
    await db.ownerPayment.create({
      data: {
        configId: config?.id || null,
        configLabel: p.configLabel,
        amount: p.amount,
        currency: 'USD',
        sourceTxRef: p.sourceTxRef || null,
        status: p.status,
        destinationType: p.destinationType,
        destinationLabel: p.destinationLabel,
        // @ts-ignore
        ribFingerprintSha256: fp && fp.length === 64 ? fp : null,
        ribDisplayMasked,  // ***last6 only
        failureReason: p.failureReason,
        recovered: false,
      },
    })
    created++
  }

  return { created, skipped }
}

/**
 * GET /api/owner-payments
 * PROTÉGÉ: same-origin xor x-ops-secret == OPS_API_SECRET || CRON_SECRET
 *          (fail-closed 401 sinon).
 */
export async function GET(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
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
    const recoveredAmount = payments.filter(p => p.recovered).reduce((s, p) => s + ((p as any).recoveryAmount || 0), 0)

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
        routingFixed: configs.filter((c: any) => c.routingFixed).length,
      },
      breakdown: { byStatus, byConfig, byDestType },
    })
  } catch (error) {
    console.error('[GET /api/owner-payments] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch owner payments' }, { status: 500 })
  }
}

/**
 * POST /api/owner-payments
 * PROTÉGÉ: même règle requireOpsAuth (fail-closed).
 * Ne peut PAS être appelé par un script cross-origin sans le x-ops-secret.
 */
export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

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
        // @ts-ignore
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
            // @ts-ignore
            ribFingerprintSha256: item.ribFingerprintSha256 || null,
            // @ts-ignore
            ribDisplayMasked: item.ribDisplayMasked || null,
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
