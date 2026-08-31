import { NextRequest, NextResponse } from 'next/server'
import { requireOpsAuth } from '@/lib/api-auth'
import {
  releaseOwnerFunds,
  getOwnerLedgerStatus,
  confirmRelease,
  ReleaseRequest,
} from '@/lib/treasury/release-engine'

/**
 * Treasury release endpoint.
 *
 * GET  /api/treasury/release            -> read-only HELD vs SPENDABLE owner ledger
 * POST /api/treasury/release/confirm    -> poll real bank status for an externalRef
 * POST /api/treasury/release            -> release HELD funds to the owner via the
 *                                           real Attijari PSD2 PISP rail (fail-closed).
 *
 * Auth: same-origin UI or x-ops-secret (OPS_API_SECRET / CRON_SECRET). Mutations
 * are never writable without auth. The release itself is fail-closed: it only
 * books 'completed' when the real Attijari PISP returns a real paymentId.
 */

export async function GET(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied
  try {
    const ledger = await getOwnerLedgerStatus()
    const totalHeld = ledger.reduce((s, a) => s + a.heldBalance, 0)
    const totalSpendable = ledger.reduce((s, a) => s + a.spendableBalance, 0)
    const totalSent = ledger.reduce((s, a) => s + a.totalSent, 0)
    return NextResponse.json({ success: true, totalHeld, totalSpendable, totalSent, accounts: ledger })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.op === 'confirm') {
    const externalRef = String(body.externalRef || '').trim()
    if (!externalRef) {
      return NextResponse.json({ success: false, error: 'externalRef required for confirm' }, { status: 400 })
    }
    const result = await confirmRelease(externalRef)
    return NextResponse.json({ success: result.ok, ...result })
  }

  if (body.op === 'reconcile-held') {
    // Seed heldBalance from totalReceived (attributes reconciled volume to HELD,
    // leaving it locked and NOT released — spendable stays 0 until a real release).
    const { prisma } = await import('@/lib/db')
    const accounts = await prisma.ownerAccount.findMany({ where: { isActive: true } })
    let seeded = 0
    for (const a of accounts) {
      const rec = Number(a.totalReceived ?? 0)
      const held = Number(a.heldBalance ?? 0)
      if (rec > held + 0.0001) {
        await prisma.ownerAccount.update({
          where: { id: a.id },
          data: { heldBalance: { increment: rec - held } },
        })
        seeded++
      }
    }
    const ledger = await getOwnerLedgerStatus()
    return NextResponse.json({ success: true, seededAccounts: seeded, ledger })
  }

  const payload = body as unknown as ReleaseRequest
  if (!payload.ownerAccountId || !payload.amount) {
    return NextResponse.json(
      { success: false, error: 'ownerAccountId and amount are required' },
      { status: 400 },
    )
  }
  const result = await releaseOwnerFunds({
    ownerAccountId: payload.ownerAccountId,
    amount: Number(payload.amount),
    currency: payload.currency,
    reference: payload.reference,
    bucketCode: payload.bucketCode,
  })
  return NextResponse.json({ success: result.ok, ...result })
}
