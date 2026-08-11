// ——— Autonomous PSD2 Engine ———
// Async agentic engine ported from the autonomous-psd2 starter (engine.py):
//   self-connect   -> mTLS connector (TLS 1.2+, client cert + eIDAS CA)
//   self-token     -> automated OAuth2 token refresh against mTLS token URL
//   self-test      -> canary probe (200/201/401/403 = transport healthy)
//   metrics        -> getPsd2Health() snapshots for observability
// The engine never moves funds. It only verifies that real rails exist,
// are reachable and have live credentials. Crypto files must exist on disk
// (or via PSD2_<BANK_ID>_*_PATH env vars); otherwise connectors report as
// unconfigured without making any network call.

import { Agent } from 'node:https'
import { request as httpsRequest } from 'node:https'
import { existsSync, readFileSync } from 'node:fs'
import type { IncomingHttpHeaders } from 'node:http'
import { db } from '@/lib/db'
import { rememberIncident, recordRemedy } from '@/lib/swarm/memory'
import { loadBankRegistry } from './registry'
import type { Psd2ConnectorEntry } from './registry'

const CANARY_TIMEOUT_MS = 8000
const TOKEN_TIMEOUT_MS = 10000
const TOKEN_REFRESH_MARGIN_S = 60
const HEALTHY_STATUSES = new Set([200, 201, 401, 403])

export interface Psd2ProbeResult {
  bankId: string
  name: string
  region: string
  authScheme: string
  enabled: boolean
  configured: boolean
  healthy: boolean
  hasToken: boolean
  tokenExpiresAt?: string
  status?: number
  latencyMs: number
  error?: string
}

interface JsonResponse {
  status: number
  headers: IncomingHttpHeaders
  body: unknown
}

function httpsJsonRequest(
  url: string,
  options: { agent?: Agent; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error(`Invalid URL: ${url}`))
      return
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error(`Only https is allowed: ${url}`))
      return
    }
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? 'GET',
        agent: options.agent,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body: unknown = raw
          try {
            body = JSON.parse(raw)
          } catch {
            // keep raw text when the endpoint does not answer JSON
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
        })
      },
    )
    req.setTimeout(options.timeoutMs ?? CANARY_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timeout'))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

function resolveUrl(base: string, path?: string): string {
  if (!path) return base
  if (base.endsWith('/') && path.startsWith('/')) return base + path.slice(1)
  if (!base.endsWith('/') && !path.startsWith('/')) return `${base}/${path}`
  return base + path
}

function buildAgent(entry: Psd2ConnectorEntry): { agent: Agent; certsLoaded: boolean } | null {
  const { clientCertPath, privateKeyPath, caPath } = entry.crypto
  if (!clientCertPath || !privateKeyPath || !existsSync(clientCertPath) || !existsSync(privateKeyPath)) {
    return null
  }
  try {
    const agent = new Agent({
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      cert: readFileSync(clientCertPath),
      key: readFileSync(privateKeyPath),
      ca: caPath && existsSync(caPath) ? readFileSync(caPath) : undefined,
    })
    return { agent, certsLoaded: true }
  } catch {
    return null
  }
}

interface TokenState {
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
}

async function persistToken(bankId: string, state: TokenState): Promise<void> {
  if (!state.accessToken || !state.expiresAt) return
  try {
    await db.psd2Token.upsert({
      where: { bankId },
      create: {
        bankId,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken ?? null,
        expiresAt: new Date(state.expiresAt),
      },
      update: {
        accessToken: state.accessToken,
        refreshToken: state.refreshToken ?? undefined,
        expiresAt: new Date(state.expiresAt),
      },
    })
  } catch {
    // table may not exist until `prisma db push`; in-memory state still works
  }
}

async function loadToken(bankId: string): Promise<TokenState | undefined> {
  try {
    const row = await db.psd2Token.findUnique({ where: { bankId } })
    if (!row) return undefined
    return { accessToken: row.accessToken, refreshToken: row.refreshToken ?? undefined, expiresAt: row.expiresAt.toISOString() }
  } catch {
    return undefined
  }
}

async function auditPsd2(bankId: string, action: string, note: string): Promise<void> {
  try {
    await db.auditLedger.create({
      data: { entityType: 'psd2_bank', entityId: bankId, action, discrepancyNote: note, performedBy: 'psd2-engine' },
    })
  } catch {
    // observability only; never block the agent on audit writes
  }
}

const CANARY_CODE = 'PSD2-CANARY-FAIL'
const TOKEN_CODE = 'PSD2-TOKEN-REFRESH-FAIL'

function canaryMessage(bankId: string): string {
  return `canary probe failed for ${bankId}`
}

function tokenMessage(bankId: string): string {
  return `oauth2 token refresh failed for ${bankId}`
}

// Memory is observability: never block a probe on memory writes.
async function rememberPsd2(bankId: string, code: string, severity: 'warning' | 'critical', message: string, detail: string): Promise<void> {
  try {
    await rememberIncident({ code, severity, component: `psd2-engine:${bankId}`, message, context: { detail } })
  } catch {
    // memory table may not exist yet
  }
}

async function recordPsd2Remedy(bankId: string, code: string, message: string, remedy: string, outcome: 'success' | 'failure' | 'noop', detail: string): Promise<void> {
  try {
    await recordRemedy({ code, severity: 'warning', component: `psd2-engine:${bankId}`, message }, { remedy, outcome, context: { detail } })
  } catch {
    // memory table may not exist yet
  }
}

class BankConnector {
  readonly entry: Psd2ConnectorEntry
  private agent: Agent | null = null
  private certsLoaded = false
  private token: TokenState = {}

  constructor(entry: Psd2ConnectorEntry) {
    this.entry = entry
    const built = buildAgent(entry)
    if (built) {
      this.agent = built.agent
      this.certsLoaded = true
    }
  }

  get configured(): boolean {
    return this.certsLoaded
  }

  async loadStoredToken(): Promise<void> {
    this.token = (await loadToken(this.entry.bankId)) ?? {}
  }

  async refreshToken(): Promise<boolean> {
    const tokenUrl = this.entry.endpoints.tokenUrl
    if (!this.agent || !tokenUrl) return false
    const startedAt = Date.now()
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: this.entry.endpoints.scope ?? '',
      }).toString()
      const res = await httpsJsonRequest(tokenUrl, {
        agent: this.agent,
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        timeoutMs: TOKEN_TIMEOUT_MS,
      })
      const json = (res.body ?? {}) as { access_token?: string; refresh_token?: string; expires_in?: number }
      if (res.status >= 200 && res.status < 300 && json.access_token) {
        const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString()
        this.token = {
          accessToken: json.access_token,
          refreshToken: json.refresh_token ?? this.token.refreshToken,
          expiresAt,
        }
        await persistToken(this.entry.bankId, this.token)
        await auditPsd2(this.entry.bankId, 'token_refreshed', `expires ${expiresAt} (${Date.now() - startedAt}ms)`)
        await recordPsd2Remedy(this.entry.bankId, TOKEN_CODE, tokenMessage(this.entry.bankId), 'retry_refresh', 'success', `status ${res.status}`)
        return true
      }
      await auditPsd2(this.entry.bankId, 'token_refresh_failed', `status ${res.status}`)
      await rememberPsd2(this.entry.bankId, TOKEN_CODE, 'critical', tokenMessage(this.entry.bankId), `status ${res.status}`)
      await recordPsd2Remedy(this.entry.bankId, TOKEN_CODE, tokenMessage(this.entry.bankId), 'retry_refresh', 'failure', `status ${res.status}`)
      return false
    } catch (error) {
      await auditPsd2(this.entry.bankId, 'token_refresh_failed', String(error))
      await rememberPsd2(this.entry.bankId, TOKEN_CODE, 'critical', tokenMessage(this.entry.bankId), String(error))
      await recordPsd2Remedy(this.entry.bankId, TOKEN_CODE, tokenMessage(this.entry.bankId), 'retry_refresh', 'failure', String(error))
      return false
    }
  }

  async getToken(): Promise<string | undefined> {
    if (this.token.accessToken && this.token.expiresAt) {
      const expiry = new Date(this.token.expiresAt).getTime()
      if (expiry - TOKEN_REFRESH_MARGIN_S * 1000 > Date.now()) return this.token.accessToken
    }
    await this.refreshToken()
    return this.token.accessToken
  }

  tokenState(): TokenState {
    return { ...this.token }
  }

  async runCanary(): Promise<Psd2ProbeResult> {
    const startedAt = Date.now()
    const base: Psd2ProbeResult = {
      bankId: this.entry.bankId,
      name: this.entry.name,
      region: this.entry.region,
      authScheme: this.entry.authScheme,
      enabled: this.entry.enabled,
      configured: this.agent !== null,
      healthy: false,
      hasToken: false,
      latencyMs: 0,
    }
    if (!this.agent) {
      return { ...base, error: 'unconfigured — client cert/key not found' }
    }
    const token = await this.getToken()
    base.hasToken = Boolean(token)
    base.tokenExpiresAt = this.token.expiresAt
    const url = resolveUrl(this.entry.baseUrl, this.entry.endpoints.aisPath)
    const headers: Record<string, string> = { 'X-Request-ID': `psd2-canary-${this.entry.bankId}-${startedAt}` }
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      const res = await httpsJsonRequest(url, { agent: this.agent, headers, timeoutMs: CANARY_TIMEOUT_MS })
      base.latencyMs = Date.now() - startedAt
      base.status = res.status
      base.healthy = HEALTHY_STATUSES.has(res.status)
      base.error = base.healthy ? undefined : `unexpected status ${res.status}`
      await auditPsd2(this.entry.bankId, base.healthy ? 'canary_ok' : 'canary_fail', `status ${res.status} (${base.latencyMs}ms)`)
      if (base.healthy) {
        await recordPsd2Remedy(this.entry.bankId, CANARY_CODE, canaryMessage(this.entry.bankId), 'canary_retry', 'success', `status ${res.status}`)
      } else {
        await rememberPsd2(this.entry.bankId, CANARY_CODE, 'warning', canaryMessage(this.entry.bankId), `status ${res.status} (${base.latencyMs}ms)`)
        await recordPsd2Remedy(this.entry.bankId, CANARY_CODE, canaryMessage(this.entry.bankId), 'canary_retry', 'failure', `status ${res.status}`)
      }
    } catch (error) {
      base.latencyMs = Date.now() - startedAt
      base.error = String(error)
      await auditPsd2(this.entry.bankId, 'canary_fail', String(error))
      await rememberPsd2(this.entry.bankId, CANARY_CODE, 'warning', canaryMessage(this.entry.bankId), String(error))
      await recordPsd2Remedy(this.entry.bankId, CANARY_CODE, canaryMessage(this.entry.bankId), 'canary_retry', 'failure', String(error))
    }
    return base
  }
}

export async function runPsd2Connectivity(bankIds?: string[]): Promise<Psd2ProbeResult[]> {
  const registry = loadBankRegistry()
  const entries = bankIds ? registry.filter((e) => bankIds.includes(e.bankId)) : registry
  const results: Psd2ProbeResult[] = []
  for (const entry of entries) {
    if (!entry.enabled) {
      results.push({
        bankId: entry.bankId,
        name: entry.name,
        region: entry.region,
        authScheme: entry.authScheme,
        enabled: false,
        configured: false,
        healthy: false,
        hasToken: false,
        latencyMs: 0,
        error: 'disabled via PSD2_<BANK_ID>_ENABLED=false',
      })
      continue
    }
    const connector = new BankConnector(entry)
    await connector.loadStoredToken()
    results.push(await connector.runCanary())
  }
  return results
}

export async function refreshPsd2Token(bankId: string): Promise<{ refreshed: boolean; tokenExpiresAt?: string; error?: string }> {
  const entry = loadBankRegistry().find((e) => e.bankId === bankId)
  if (!entry) return { refreshed: false, error: `unknown bank ${bankId}` }
  if (!entry.enabled) return { refreshed: false, error: `bank ${bankId} is disabled` }
  const connector = new BankConnector(entry)
  await connector.loadStoredToken()
  const refreshed = await connector.refreshToken()
  return { refreshed, tokenExpiresAt: connector.tokenState().expiresAt, error: refreshed ? undefined : 'token refresh failed' }
}

export async function getPsd2Health() {
  const results = await runPsd2Connectivity()
  let tokenCount = 0
  for (const result of results) {
    if (result.hasToken) tokenCount += 1
  }
  return {
    ok: results.every((r) => !r.enabled || r.healthy),
    connectors: results,
    summary: {
      total: results.length,
      enabled: results.filter((r) => r.enabled).length,
      configured: results.filter((r) => r.configured).length,
      healthy: results.filter((r) => r.healthy).length,
      withToken: tokenCount,
    },
  }
}
