import { NextResponse } from 'next/server'
import { getAttijariConfig, getAttijariAccounts, getAttijariRoutes, getAttijariOrigins, queryAllBalances, testAttijariConnection, getRouteStateSnapshot, resetRouteState, generateAttijariPain001 } from '@/lib/payment-providers/attijari'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'config'
  try {
    switch (action) {
      case 'config': {
        const apiConfig = getAttijariConfig(); const accounts = getAttijariAccounts(); const routes = getAttijariRoutes(); const origins = getAttijariOrigins()
        return NextResponse.json({
          bank: { name: 'Attijariwafa Bank', swiftBic: 'BCMAMAMC', countryCode: 'MA', branch: 'RABAT AGDAL FAL OULD OUMEIR', address: '83, AV. FAL OULD OUMEIR, Rabat' },
          accounts: accounts.map(a => ({ id: a.id, label: a.label, rib: a.rib.fullRib, iban: a.iban, accountHolder: a.accountHolder, primary: a.primary, currency: a.currency })),
          routes: routes.map(r => ({ routeId: r.routeId, rib: r.rib, weight: r.weight, maxAmountPerTransfer: r.maxAmountPerTransfer, maxDailyAmount: r.maxDailyAmount, purposes: r.purposes, isActive: r.isActive })),
          javascriptOrigins: origins.split('\n'),
          apiConfigured: !!apiConfig,
          requiredEnvVars: ['ATTIJARI_API_BASE_URL', 'ATTIJARI_CLIENT_ID', 'ATTIJARI_CLIENT_SECRET'],
          timestamp: new Date().toISOString(),
        })
      }
      case 'balances': {
        const apiConfig = getAttijariConfig()
        if (!apiConfig) return NextResponse.json({ error: 'API not configured', required: ['ATTIJARI_API_BASE_URL', 'ATTIJARI_CLIENT_ID', 'ATTIJARI_CLIENT_SECRET'] }, { status: 503 })
        return NextResponse.json({ source: 'attijari_api', balances: await queryAllBalances(apiConfig), timestamp: new Date().toISOString() })
      }
      case 'test': {
        const apiConfig = getAttijariConfig()
        if (!apiConfig) return NextResponse.json({ connected: false, error: 'API not configured', accountsAvailable: getAttijariAccounts().length })
        return NextResponse.json(await testAttijariConnection(apiConfig))
      }
      case 'origins': return new NextResponse(getAttijariOrigins(), { headers: { 'Content-Type': 'text/plain' } })
      default: return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { recipients?: Array<{ name: string; accountId?: string; amount: number; currency: string; referenceId?: string }>; debitRib?: string }
    if (!body.recipients?.length) return NextResponse.json({ error: 'Missing recipients' }, { status: 400 })
    const batchRef = `ATTIJARI-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`
    const recipients = body.recipients.map((r, i) => ({ name: r.name, accountId: r.accountId, amount: r.amount, currency: r.currency || 'MAD', referenceId: r.referenceId || `MANUAL-${Date.now()}-${i}`, email: undefined as string | undefined }))
    const xml = generateAttijariPain001(recipients, batchRef, body.debitRib)
    return NextResponse.json({ success: true, batchReference: batchRef, standard: 'pain.001.001.09', bank: 'Attijariwafa', swiftBic: 'BCMAMAMC', xmlContent: xml, timestamp: new Date().toISOString() })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 }) }
}
