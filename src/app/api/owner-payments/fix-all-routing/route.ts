import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTES = [
  { label: 'Debts', splitPercentage: 40, ownerAccountLabel: 'Debts', bankName: 'Attijariwafa Compte sur Carnet' },
  { label: 'Operational Costs', splitPercentage: 25, ownerAccountLabel: 'Salary', bankName: 'Attijariwafa Bank' },
  { label: 'Infrastructure', splitPercentage: 15, ownerAccountLabel: 'Salary', bankName: 'Attijariwafa Bank' },
  { label: 'Salary', splitPercentage: 10, ownerAccountLabel: 'Salary', bankName: 'Attijariwafa Bank' },
  { label: 'Emergency', splitPercentage: 10, ownerAccountLabel: 'Salary', bankName: 'Attijariwafa Bank' },
] as const

/**
 * POST /api/owner-payments/fix-all-routing
 * Configuration-only route correction. This endpoint never creates, updates,
 * or marks OwnerPayment records recovered, processing, or completed, and never
 * submits a payment to any provider.
 */
export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const accounts = await db.ownerAccount.findMany({
      where: { isActive: true, label: { in: ['Salary', 'Debts'] } },
      select: { label: true, accountNumber: true },
    })

    const accountsByLabel = new Map<string, { accountNumber: string; fingerprint: string; masked: string }>()
    for (const label of ['Salary', 'Debts'] as const) {
      const matching = accounts.filter(account => account.label === label && account.accountNumber)
      if (matching.length !== 1) {
        return NextResponse.json(
          {
            success: false,
            error: 'Route update blocked: each destination must resolve to exactly one active owner account.',
            unresolvedDestination: label,
            paymentsChanged: 0,
            payoutsInitiated: 0,
          },
          { status: 422 },
        )
      }
      const accountNumber = String(matching[0].accountNumber).trim()
      const fingerprint = createHash('sha256').update(accountNumber.toLowerCase()).digest('hex')
      accountsByLabel.set(label, {
        accountNumber,
        fingerprint,
        masked: accountNumber.length >= 6 ? `***${accountNumber.slice(-6)}` : '***',
      })
    }

    const configs = await db.ownerPaymentConfig.findMany({
      where: { label: { in: ROUTES.map(route => route.label) } },
      select: { id: true, label: true, splitPercentage: true },
    })
    const configByLabel = new Map(configs.map(config => [config.label, config]))
    const missing = ROUTES.filter(route => {
      const config = configByLabel.get(route.label)
      return !config || Number(config.splitPercentage) !== route.splitPercentage
    })
    if (missing.length > 0 || ROUTES.reduce((sum, route) => sum + route.splitPercentage, 0) !== 100) {
      return NextResponse.json(
        {
          success: false,
          error: 'Route update blocked: configured allocation labels or percentages do not match the reviewed 100% split.',
          mismatchedRoutes: missing.map(route => route.label),
          paymentsChanged: 0,
          payoutsInitiated: 0,
        },
        { status: 422 },
      )
    }

    const updatedAt = new Date()
    await db.$transaction(async tx => {
      for (const route of ROUTES) {
        const config = configByLabel.get(route.label)!
        const destination = accountsByLabel.get(route.ownerAccountLabel)!
        // @ts-ignore Prisma client is regenerated with the fingerprint column.
        await tx.ownerPaymentConfig.update({
          where: { id: config.id },
          data: {
            ribLabel: `${route.ownerAccountLabel} Account`,
            // @ts-ignore Prisma client is regenerated with the fingerprint column.
            ribFingerprintSha256: destination.fingerprint,
            bankName: route.bankName,
            routingFixed: true,
            routingFixedAt: updatedAt,
            notes: `Configuration verified ${updatedAt.toISOString()}: ${route.splitPercentage}% routes to the active ${route.ownerAccountLabel} owner account (${destination.masked}). Configuration only; no payout was initiated.`,
          },
        })
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Route configuration updated only. No payment records changed and no payouts were initiated.',
      configsUpdated: ROUTES.map(route => ({
        label: route.label,
        splitPercentage: route.splitPercentage,
        destination: route.ownerAccountLabel,
        maskedAccount: accountsByLabel.get(route.ownerAccountLabel)!.masked,
        routingFixed: true,
      })),
      paymentsChanged: 0,
      payoutsInitiated: 0,
      updatedAt: updatedAt.toISOString(),
    })
  } catch (error) {
    console.error('[POST /api/owner-payments/fix-all-routing] Configuration-only update failed:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update route configuration. No payout was initiated.' },
      { status: 500 },
    )
  }
}
