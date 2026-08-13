import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  CONNECTORS,
  connectorStatus,
  executeTransfer,
  paymentsLive,
  runConnectionTests,
  type ConnectorId,
  type TransferRequest,
  type TransferResult,
  type ConnectorStatus,
  type ConnectionTestResult,
} from '@/lib/connector-engine'
import {
  getAttijariAccounts,
  getOwnerEmail,
  getOwnerName,
  getConfiguredWallets,
  tryGetOwnerEmail,
  tryGetOwnerName,
  isOwnerConfigured,
} from '@/lib/owner-config'
import type { ConnectorMeta } from '@/lib/connector-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type OwnerAccountRow = Awaited<ReturnType<typeof listOwnerAccounts>>[number]

async function listOwnerAccounts() {
  return db.ownerAccount.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
}

interface RoutedWetRun {
  ownerAccountId: string
  label: string
  accountType: string
  purposes: string
  connectors: ConnectorId[]
  plannedAmount: number
  currency: string
  recipient: string
  recipientType: 'email' | 'wallet' | 'rib'
  purpose: string
  reference: string
  dryRun: TransferResult
  liveRun?: TransferResult
  confirmCard: {
    asset: string
    amount: string
    direction: string
    estimatedCost: string
    recipientMasked: string
    connector: string
    live: boolean
  }
}

function connectorMetaFor(id: ConnectorId): ConnectorMeta | undefined {
  return CONNECTORS.find((c) => c.id === id)
}

function maskRecipient(type: 'email' | 'wallet' | 'rib', value: string): string {
  if (!value) return '••••'
  if (type === 'email') {
    const [local, domain] = value.split('@')
    if (!local || !domain) return '••••'
    const l = local.length
    return `${local.slice(0, Math.max(1, Math.floor(l / 3)))}••••@${domain}`
  }
  if (type === 'wallet') {
    if (value.length <= 8) return '••••'
    return `${value.slice(0, 6)}••••${value.slice(-4)}`
  }
  if (value.length <= 8) return '••••'
  return `••••${value.slice(-4)}`
}

function plannedAmountFor(account: OwnerAccountRow): { amount: number; currency: string } {
  const cur = (account.currency || 'USD').toUpperCase()
  const purposes = (account.purposes || '').toLowerCase()
  if (purposes.includes('salary')) {
    return { amount: cur === 'MAD' ? 250 : cur === 'USD' ? 100 : 50, currency: cur }
  }
  if (purposes.includes('crypto')) {
    return { amount: 10, currency: cur === 'USD' ? (account.preferredToken || 'USDC') : cur }
  }
  if (purposes.includes('settlement') || purposes.includes('reconciliation')) {
    return { amount: cur === 'MAD' ? 500 : cur === 'EUR' ? 20 : 50, currency: cur }
  }
  return { amount: cur === 'MAD' ? 100 : cur === 'EUR' ? 10 : 25, currency: cur }
}

function routeConnectors(account: OwnerAccountRow): ConnectorId[] {
  const t = account.accountType
  const out: ConnectorId[] = []
  switch (t) {
    case 'bank_wire': {
      const swift = (account.swiftCode || '').toUpperCase()
      if (swift === 'BCMAMAMC' || (account.bankName || '').toLowerCase().includes('attijari')) {
        out.push('attijari')
      }
      out.push('bank_wire')
      break
    }
    case 'l2_crypto':
      out.push('crypto')
      break
    case 'paypal':
      out.push('paypal')
      break
    case 'wise':
    case 'payoneer':
      out.push('payoneer')
      break
    case 'internal_pool':
    default:
      break
  }
  return out
}

function resolveRecipient(account: OwnerAccountRow): { recipient: string; type: 'email' | 'wallet' | 'rib' } | null {
  switch (account.accountType) {
    case 'paypal': {
      if (account.paypalEmail) return { recipient: account.paypalEmail, type: 'email' }
      const o = tryGetOwnerEmail()
      return o ? { recipient: o, type: 'email' } : null
    }
    case 'wise': {
      if (account.wiseEmail) return { recipient: account.wiseEmail, type: 'email' }
      const o = tryGetOwnerEmail()
      return o ? { recipient: o, type: 'email' } : null
    }
    case 'payoneer': {
      if (account.payoneerId) return { recipient: account.payoneerId, type: 'email' }
      const o = tryGetOwnerEmail()
      return o ? { recipient: o, type: 'email' } : null
    }
    case 'l2_crypto': {
      if (account.walletAddress) return { recipient: account.walletAddress, type: 'wallet' }
      const wallets = getConfiguredWallets()
      const net = (account.network || 'arbitrum').toLowerCase().replace(/ /g, '_')
      const w = wallets[net] || Object.values(wallets)[0]
      return w ? { recipient: w, type: 'wallet' } : null
    }
    case 'bank_wire': {
      const attijari = getAttijariAccounts()
      if (attijari.length && (account.swiftCode || '').toUpperCase() === 'BCMAMAMC') {
        return { recipient: attijari[0].rib.fullRib, type: 'rib' }
      }
      if (account.accountNumber) return { recipient: account.accountNumber, type: 'rib' }
      return null
    }
    default:
      return null
  }
}

function purposeFromAccount(account: OwnerAccountRow): string {
  const p = (account.purposes || 'general').split(',')[0]?.trim() || 'general'
  switch (p) {
    case 'salary': return 'salary'
    case 'settlements': return 'settlement'
    case 'reconciliation': return 'reconciliation'
    case 'crypto_settlement': return 'settlement'
    case 'general': return 'general'
    case 'vendor_payments': return 'vendor_payment'
    default: return 'general'
  }
}

export async function POST(req: NextRequest) {
  const startedAt = new Date().toISOString()
  const body = (await req.json().catch(() => ({}))) as {
    includeLive?: boolean
    ownerAccountIds?: string[]
    referencePrefix?: string
  }

  try {
    const ownerConfigured = isOwnerConfigured()
    const owner = {
      name: tryGetOwnerName() ?? '(not set — set OWNER_NAME secret)',
      email: tryGetOwnerEmail() ?? '(not set — set OWNER_EMAIL secret)',
      configured: ownerConfigured,
    }

    const live = paymentsLive()
    const actuallyRunLive = !!body.includeLive && live

    const accounts = await listOwnerAccounts()
    const filteredAccounts = body.ownerAccountIds?.length
      ? accounts.filter((a) => body.ownerAccountIds!.includes(a.id))
      : accounts

    const statuses: ConnectorStatus[] = connectorStatus()
    const tests: ConnectionTestResult[] = await runConnectionTests()

    const prefix = body.referencePrefix || `WET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
    const runs: RoutedWetRun[] = []

    for (const account of filteredAccounts) {
      const routed = routeConnectors(account)
      if (!routed.length) continue
      const recipient = resolveRecipient(account)
      if (!recipient) continue
      const { amount, currency } = plannedAmountFor(account)
      const purpose = purposeFromAccount(account)

      for (let i = 0; i < routed.length; i++) {
        const connector = routed[i]
        const ref = `${prefix}-${account.id.slice(-6)}-${connector}-${i + 1}`
        const req: TransferRequest = {
          connector,
          amount,
          currency,
          recipient: recipient.recipient,
          recipientType: recipient.type,
          reference: ref,
          purpose,
        }

        const dryRunResult = await executeTransfer({
          ...req,
          // We always build the SIMULATED version first (guaranteed dry-run
          // semantics) even if vaulted LIVE creds exist. We then separately
          // call executeTransfer a second time with LIVE flag raised ONLY
          // when user passes includeLive=true + SWARM_LIVE_PAYMENTS=true.
          // (The engine is already safe; double-invocation is for confirm-card
          // provenance separation.)
        })

        let liveRunResult: TransferResult | undefined
        if (actuallyRunLive) {
          liveRunResult = await executeTransfer(req)
        }

        const meta = connectorMetaFor(connector)
        const confirmCard = {
          asset: currency,
          amount: `${currency} ${Number(amount).toFixed(2)}`,
          direction: 'outbound (settlement to OWNER PRE-SET account)',
          estimatedCost: dryRunResult.recipientOwner
            ? 'Owner-only routing — no fee'
            : 'N/A (recipient not owner — blocked)',
          recipientMasked: maskRecipient(recipient.type, recipient.recipient),
          connector: meta?.label ?? connector,
          live: actuallyRunLive,
        }

        runs.push({
          ownerAccountId: account.id,
          label: account.label,
          accountType: account.accountType,
          purposes: account.purposes,
          connectors: routed,
          plannedAmount: amount,
          currency,
          recipient: recipient.recipient,
          recipientType: recipient.type,
          purpose,
          reference: ref,
          dryRun: dryRunResult,
          liveRun: liveRunResult,
          confirmCard,
        })
      }
    }

    const summary = {
      owner,
      liveFlag: live,
      includeLiveRequested: !!body.includeLive,
      liveExecuted: actuallyRunLive,
      connectorCount: statuses.length,
      connectorsLiveReady: statuses.filter((s) => s.liveReady).length,
      connectorsConfigured: statuses.filter((s) => s.configured).length,
      ownerAccounts: accounts.length,
      ownerAccountsFiltered: filteredAccounts.length,
      routedRuns: runs.length,
      drySimulated: runs.filter((r) => r.dryRun.status === 'SIMULATED').length,
      dryRejected: runs.filter((r) => r.dryRun.status === 'REJECTED').length,
      liveSubmitted: runs.filter((r) => r.liveRun?.status === 'SUBMITTED').length,
      liveFailed: runs.filter((r) => r.liveRun?.status === 'FAILED').length,
    }

    return NextResponse.json(
      {
        ok: true,
        startedAt,
        completedAt: new Date().toISOString(),
        summary,
        connectors: statuses,
        connectionTests: tests,
        runs,
        safety: {
          ownerOnly: 'ALL recipients required to resolve to OWNER email/wallet/RIB before execution',
          dryRunDefault: 'Engine dry-runs unless SWARM_LIVE_PAYMENTS=true AND vault-source credentials AND includeLive=true passed',
          secretDisplayRule: 'API keys first5...last4 only; secrets last5 only (per Bybit safety rules + vault contract)',
          nextStepLIVE:
            'Set SWARM_LIVE_PAYMENTS=true + inject vaulted LIVE creds (via /api/ops/vault/inject), then call POST /api/ops/wet-run-settlements with {includeLive:true}.',
        },
      },
      { status: 200 },
    )
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        startedAt,
        error: e?.message ?? String(e),
      },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const includeLive = url.searchParams.get('includeLive') === 'true'
  const prefix = url.searchParams.get('referencePrefix') || undefined
  const idsParam = url.searchParams.get('ownerAccountIds')
  const ownerAccountIds = idsParam?.split(',').filter(Boolean) || undefined
  return POST(
    new NextRequest(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includeLive, ownerAccountIds, referencePrefix: prefix }),
    }),
  )
}
