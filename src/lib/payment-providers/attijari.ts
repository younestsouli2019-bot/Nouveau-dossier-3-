// ——— Attijariwafa Bank SDK ———
// Multi-route bank integration: OAuth2, balance inquiry, weighted round-robin,
// failover, ISO 20022 fallback. 2x RIB (BCMAMAMC) — M TSOULI YOUNES.
// ————————————————————————————————————————————————————————

import { randomUUID } from 'crypto'
import type { PayoutRecipient, ProviderBatchResult, ProviderPayoutResult } from './types'

// ── Types ──────────────────────────────────────────────────────────

export interface AttijariAccount {
  id: string; label: string; currency: string
  rib: { codeBanque: string; codeVille: string; numeroSerie: string; cleRib: string; fullRib: string }
  iban: string; accountHolder: string; swiftBic: string; primary: boolean; routeId: string; isActive: boolean
}

export interface AttijariRoute {
  routeId: string; accountId: string; rib: string; weight: number
  maxAmountPerTransfer: number; maxDailyAmount: number; purposes: string[]; isActive: boolean
  _consecutiveFailures?: number; _cooldownUntil?: number; _dailyTotal?: number
}

export interface AttijariApiConfig {
  baseUrl: string; clientId: string; clientSecret: string
  oauthTokenUrl: string; scope: string
  timeouts: { connectionMs: number; readMs: number; retryDelayMs: number; maxRetries: number }
}

export interface AttijariBalance {
  accountId: string; rib: string; availableBalance: number; bookedBalance: number
  currency: string; checkedAt: string; source: 'attijari_api' | 'internal_ledger_only'
}

export interface AttijariTransferResult {
  success: boolean; transferId?: string; routeId: string; rib: string
  status: 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'FAILED'
  bankReference?: string; error?: string; errorCode?: string; timestamp: string
}

// ── Token Cache & Route Runtime ───────────────────────────────────

let cachedToken: { accessToken: string; expiresAt: number } | null = null
const routeRuntime = new Map<string, { consecutiveFailures: number; cooldownUntil: number; dailyTotal: number; dailyDate: string }>()

// ── Config Loading ────────────────────────────────────────────────

function loadConfigJson() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./attijari-config.json') as {
    bank: { name: string; swiftBic: string; countryCode: string; branch: { name: string; address: string; city: string } }
    accounts: AttijariAccount[]
    api: {
      baseUrl: string
      auth: { clientId: string; clientSecret: string; oauthTokenUrl: string; scope: string }
      endpoints: Record<string, string>
      timeouts: { connectionMs: number; readMs: number; retryDelayMs: number; maxRetries: number }
    }
    multiRoute: {
      enabled: boolean; strategy: string; routes: AttijariRoute[]
      failover: { enabled: boolean; onRouteFailure: string; cooldownMs: number; maxConsecutiveFailures: number }
    }
    javascriptOrigins: string[]
  }
}

export function getAttijariConfig(): AttijariApiConfig | null {
 const cfg = loadConfigJson()
  const baseUrl = process.env.ATTIJARI_API_BASE_URL || (cfg.api.baseUrl.startsWith('ATTIJARI_') ? '' : cfg.api.baseUrl)
  const clientId = process.env.ATTIJARI_CLIENT_ID || (cfg.api.auth.clientId.startsWith('ATTIJARI_') ? '' : cfg.api.auth.clientId)
  const clientSecret = process.env.ATTIJARI_CLIENT_SECRET || (cfg.api.auth.clientSecret.startsWith('ATTIJARI_') ? '' : cfg.api.auth.clientSecret)
  if (!baseUrl || !clientId || !clientSecret) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), clientId, clientSecret, oauthTokenUrl: cfg.api.auth.oauthTokenUrl, scope: cfg.api.auth.scope, timeouts: cfg.api.timeouts }
}

export function getAttijariAccounts(): AttijariAccount[] {
  return loadConfigJson().accounts.filter(a => a.isActive)
}

export function getAttijariRoutes(): AttijariRoute[] {
  const cfg = loadConfigJson()
  return cfg.multiRoute.routes.map(r => {
    const rt = routeRuntime.get(r.routeId) ?? { consecutiveFailures: 0, cooldownUntil: 0, dailyTotal: 0, dailyDate: new Date().toISOString().slice(0, 10) }
    const today = new Date().toISOString().slice(0, 10)
    if (rt.dailyDate !== today) { rt.dailyTotal = 0; rt.dailyDate = today }
    return { ...r, _consecutiveFailures: rt.consecutiveFailures, _cooldownUntil: rt.cooldownUntil, _dailyTotal: rt.dailyTotal }
  })
}

export function getAttijariOrigins(): string {
  return loadConfigJson().javascriptOrigins.join('\n')
}

// ── OAuth2 ─────────────────────────────────────────────────────────

async function getAccessToken(config: AttijariApiConfig): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.accessToken
  try {
    const r = await fetch(`${config.baseUrl}${config.oauthTokenUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: config.scope, client_id: config.clientId, client_secret: config.clientSecret }).toString(),
      signal: AbortSignal.timeout(config.timeouts.connectionMs),
    })
    if (!r.ok) { console.error(`[Attijari] OAuth failed: ${r.status}`); return null }
    const d = await r.json() as { access_token?: string; expires_in?: number }
    if (!d.access_token || !d.expires_in) return null
    cachedToken = { accessToken: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 }
    return d.access_token
  } catch (e) { console.error('[Attijari] OAuth error:', e); return null }
}

// ── Generic API Call ───────────────────────────────────────────────

async function apiCall<T>(config: AttijariApiConfig, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<{ data: T | null; status: number; error?: string }> {
  const token = await getAccessToken(config)
  if (!token) return { data: null, status: 0, error: 'OAuth failed' }
  let lastError = ''
  for (let attempt = 0; attempt <= config.timeouts.maxRetries; attempt++) {
    try {
      const r = await fetch(`${config.baseUrl}${path}`, {
        method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Request-ID': randomUUID() },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(config.timeouts.readMs),
      })
      if (r.status === 401) { cachedToken = null; if (attempt === 0) continue }
      if (!r.ok) { lastError = `HTTP ${r.status}`; if (attempt < config.timeouts.maxRetries) await new Promise(res => setTimeout(res, config.timeouts.retryDelayMs * (attempt + 1))); continue }
      return { data: await r.json() as T, status: r.status }
    } catch (e) { lastError = e instanceof Error ? e.message : String(e); if (attempt < config.timeouts.maxRetries) await new Promise(res => setTimeout(res, config.timeouts.retryDelayMs * (attempt + 1))) }
  }
  return { data: null, status: 0, error: lastError }
}

// ── Balance Inquiry ────────────────────────────────────────────────

export async function queryAccountBalance(config: AttijariApiConfig, accountId: string): Promise<AttijariBalance | null> {
  const account = getAttijariAccounts().find(a => a.id === accountId || a.routeId === accountId)
  if (!account) return null
  const endpoint = loadConfigJson().api.endpoints.accountBalance.replace('{accountId}', account.rib.fullRib)
  const result = await apiCall<{ availableBalance?: number; bookedBalance?: number; currency?: string }>(config, 'GET', endpoint)
  if (!result.data) return null
  const d = result.data
  return { accountId: account.id, rib: account.rib.fullRib, availableBalance: d.availableBalance ?? d.bookedBalance ?? 0, bookedBalance: d.bookedBalance ?? 0, currency: d.currency ?? account.currency, checkedAt: new Date().toISOString(), source: 'attijari_api' }
}

export async function queryAllBalances(config: AttijariApiConfig): Promise<AttijariBalance[]> {
  const results = await Promise.allSettled(getAttijariAccounts().map(acc => queryAccountBalance(config, acc.id)))
  return results.filter((r): r is PromiseFulfilledResult<AttijariBalance> => r.status === 'fulfilled' && r.value !== null).map(r => r.value)
}

// ── Route Selection (Weighted Round Robin) ─────────────────────────

function selectRoute(amount: number, purpose: string): AttijariRoute | null {
  const cfg = loadConfigJson()
  if (!cfg.multiRoute.enabled) return cfg.multiRoute.routes.find(r => r.primary && r.isActive) ?? null
  const now = Date.now(); const today = new Date().toISOString().slice(0, 10)
  const eligible = cfg.multiRoute.routes.filter(r => {
    if (!r.isActive || !r.purposes.includes(purpose) || amount > r.maxAmountPerTransfer) return false
    const rt = routeRuntime.get(r.routeId)
    if (rt && rt.cooldownUntil > now) return false
    if (rt && rt.dailyDate === today && rt.dailyTotal + amount > r.maxDailyAmount) return false
    if (rt && rt.consecutiveFailures >= cfg.multiRoute.failover.maxConsecutiveFailures) return false
    return true
  })
  if (!eligible.length) return null
  const totalW = eligible.reduce((s, r) => s + r.weight, 0)
  let rand = Math.random() * totalW
  for (const route of eligible) { rand -= route.weight; if (rand <= 0) return route }
  return eligible[0]
}

function recordRouteResult(routeId: string, success: boolean, amount: number) {
  const rt = routeRuntime.get(routeId) ?? { consecutiveFailures: 0, cooldownUntil: 0, dailyTotal: 0, dailyDate: new Date().toISOString().slice(0, 10) }
  const today = new Date().toISOString().slice(0, 10)
  if (rt.dailyDate !== today) { rt.dailyTotal = 0; rt.dailyDate = today }
  if (success) { rt.consecutiveFailures = 0; rt.dailyTotal += amount }
  else { rt.consecutiveFailures++; const cfg = loadConfigJson(); if (rt.consecutiveFailures >= cfg.multiRoute.failover.maxConsecutiveFailures) { rt.cooldownUntil = Date.now() + cfg.multiRoute.failover.cooldownMs } }
  routeRuntime.set(routeId, rt)
}

// ── Transfer ───────────────────────────────────────────────────────

export async function initiateTransfer(config: AttijariApiConfig, recipient: { name: string; rib: string; amount: number; currency: string; reference: string; purpose: string }): Promise<AttijariTransferResult> {
  const route = selectRoute(recipient.amount, recipient.purpose)
  if (!route) return { success: false, routeId: 'none', rib: 'none', status: 'FAILED', error: 'No eligible route', errorCode: 'NO_ROUTE_AVAILABLE', timestamp: new Date().toISOString() }
  const result = await apiCall<{ transferId?: string; bankReference?: string; status?: string; message?: string }>(config, 'POST', loadConfigJson().api.endpoints.transferInitiate, {
    debitAccount: route.rib, debitName: getAttijariAccounts().find(a => a.routeId === route.routeId)?.accountHolder ?? 'M TSOULI YOUNES',
    creditAccount: recipient.rib, creditName: recipient.name, amount: recipient.amount, currency: recipient.currency,
    reference: recipient.reference, purpose: recipient.purpose, executionDate: new Date().toISOString().slice(0, 10), chargeBearer: 'SHAR',
  })
  const ts = new Date().toISOString()
  if (!result.data?.transferId) { recordRouteResult(route.routeId, false, recipient.amount); return { success: false, routeId: route.routeId, rib: route.rib, status: 'FAILED', error: result.error ?? 'Transfer failed', errorCode: 'TRANSFER_ERROR', timestamp: ts } }
  recordRouteResult(route.routeId, true, recipient.amount)
  return { success: true, transferId: result.data.transferId, bankReference: result.data.bankReference, routeId: route.routeId, rib: route.rib, status: mapStatus(result.data.status ?? 'SUBMITTED'), timestamp: ts }
}

export async function submitAttijariPayout(config: AttijariApiConfig, recipients: PayoutRecipient[], batchReference: string): Promise<ProviderBatchResult> {
  const ts = new Date().toISOString(); let ok = 0; let fail = 0
  const items: ProviderPayoutResult[] = []
  for (const r of recipients) {
    const result = await initiateTransfer(config, { name: r.name, rib: r.accountId ?? '', amount: r.amount, currency: r.currency, reference: r.referenceId, purpose: 'revenue_withdrawal' })
    items.push({ success: result.success, providerBatchId: batchReference, providerItemId: result.transferId, status: result.status, providerResponse: { routeId: result.routeId, rib: result.rib }, error: result.error, errorCode: result.errorCode, timestamp: ts })
    if (result.success) ok++; else fail++
  }
  let batchStatus: ProviderBatchResult['batchStatus'] = 'PROCESSING'
  if (fail === 0) batchStatus = 'PROCESSING'; else if (ok === 0) batchStatus = 'FAILED'; else batchStatus = 'PARTIALLY_PROCESSED'
  return { success: fail === 0, providerBatchId: batchReference, batchStatus, items, totalAmount: recipients.reduce((s, r) => s + r.amount, 0), totalItems: recipients.length, successfulItems: ok, failedItems: fail, providerResponse: { mode: 'ATTIJARI_MULTI_ROUTE', bank: 'Attijariwafa', swiftBic: 'BCMAMAMC' }, timestamp: ts }
}

// ── Health Check ───────────────────────────────────────────────────

export async function testAttijariConnection(config: AttijariApiConfig): Promise<{ connected: boolean; error?: string; details: Record<string, unknown> }> {
  const start = Date.now(); const token = await getAccessToken(config)
  if (!token) return { connected: false, error: 'OAuth authentication failed', details: { bank: 'Attijariwafa', swiftBic: 'BCMAMAMC', latencyMs: Date.now() - start } }
  return { connected: true, details: { mode: 'Attijari API (multi-route)', bank: 'Attijariwafa', swiftBic: 'BCMAMAMC', routes: getAttijariRoutes().map(r => ({ routeId: r.routeId, rib: r.rib.slice(-8), weight: r.weight })), javascriptOrigins: loadConfigJson().javascriptOrigins, latencyMs: Date.now() - start } }
}

export async function healthCheck(config: AttijariApiConfig) { const start = Date.now(); const r = await testAttijariConnection(config); return { available: r.connected, latencyMs: Date.now() - start, details: r.details ?? {}, error: r.error } }

// ── ISO 20022 Fallback ─────────────────────────────────────────────

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

export function generateAttijariPain001(recipients: PayoutRecipient[], batchRef: string, debitRib: string = '007810000448500030594182'): string {
  const now = new Date(); const date = now.toISOString().slice(0, 10)
  const txns = recipients.map((r, i) => `
      <CdtTrfTxInf><PmtId><InstrId>${batchRef}-${String(i+1).padStart(4,'0')}</InstrId><EndToEndId>E2E-${batchRef}-${String(i+1).padStart(4,'0')}</EndToEndId></PmtId><Amt><InstdAmt Ccy="${r.currency}">${r.amount.toFixed(2)}</InstdAmt></Amt><CdtrAgt><FinInstnId><BIC>BCMAMAMC</BIC></FinInstnId></CdtrAgt><Cdtr><Nm>${esc(r.name)}</Nm></Cdtr><CdtrAcct><Id><Othr><Id>${esc(r.accountId ?? '')}</Id></Othr></Id></CdtrAcct><RmtInf><Ustrd>Payout ${esc(batchRef)} — BCMAMAMC</Ustrd></RmtInf></CdtTrfTxInf>`).join('')
  const total = recipients.reduce((s, r) => s + r.amount, 0).toFixed(2)
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn><GrpHdr><MsgId>${batchRef}</MsgId><CreDtTm>${now.toISOString()}</CreDtTm><NbOfTxs>${recipients.length}</NbOfTxs><CtrlSum>${total}</CtrlSum><InitgPty><Nm>M TSOULI YOUNES</Nm></InitgPty></GrpHdr><PmtInf><PmtInfId>PINF-${batchRef}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${recipients.length}</NbOfTxs><CtrlSum>${total}</CtrlSum><PmtTpInf><SvcLvl><Cd>URGP</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${date}</ReqdExctnDt><Dbtr><Nm>M TSOULI YOUNES</Nm></Dbtr><DbtrAcct><Id><Othr><Id>${debitRib}</Id></Othr></Id></DbtrAcct><DbtrAgt><FinInstnId><BIC>BCMAMAMC</BIC><Nm>Attijariwafa bank</Nm><PstlAdr><StrtNm>83, AV. FAL OULD OUMEIR</StrtNm><TwnNm>Rabat</TwnNm><Ctry>MA</Ctry></PstlAdr></FinInstnId></DbtrAgt><ChrgBr>SHAR</ChrgBr>${txns}</PmtInf></CstmrCdtTrfInitn></Document>`
}

function mapStatus(s: string): AttijariTransferResult['status'] {
  const u = s.toUpperCase()
  if (['COMPLETED','SETTLED'].includes(u)) return 'COMPLETED'
  if (['PROCESSING','SUBMITTED','AUTHORIZED'].includes(u)) return 'PROCESSING'
  if (['REJECTED','CANCELLED'].includes(u)) return 'REJECTED'
  if (['FAILED','ERROR'].includes(u)) return 'FAILED'
  return 'SUBMITTED'
}

export function resetRouteState(id?: string) { if (id) routeRuntime.delete(id); else routeRuntime.clear(); return true }
export function getRouteStateSnapshot() { return Object.fromEntries(routeRuntime) }
