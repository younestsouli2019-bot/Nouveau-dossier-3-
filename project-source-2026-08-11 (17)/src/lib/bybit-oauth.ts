// ─── Bybit AI Sub-Account OAuth (Agent Connect) ──────────────────────────
// Cloud-agent path: user visits OAuth URL, authorizes, then manually pastes
// the access token back. We exchange it for AI sub-account API credentials,
// mask the secrets per docs, store in-memory vault + Prisma cryptoAccount,
// then verify with a signed balance probe.
//
// Safety contract:
//   - MAINNET by default; switching to TESTNET requires user to type CONFIRM
//     (per Bybit skill safety rules).
//   - Credentials displayed: key = first5...last4, secret = ...last5 only.
//   - Secret values never reach logs, JSON output, or API responses.
//   - Dry-run vault TTL 8h; LIVE exec gated by paymentsLive() / LIVE flag.
//   - State nonce + PKCE verifier persist in a session-scoped store.
// ─────────────────────────────────────────────────────────────────────────

import { randomBytes, createHash } from 'node:crypto'
import { injectSecret, getSecret, maskSecret } from './secure-vault'

export type BybitEnv = 'MAINNET' | 'TESTNET'

export const BYBIT_BASE: Record<BybitEnv, string> = {
  MAINNET: 'https://api2.bybit.com',
  TESTNET: 'https://api2-testnet.bybit.com',
}

export const BYBIT_WWW: Record<BybitEnv, string> = {
  MAINNET: 'https://www.bybit.com',
  TESTNET: 'https://testnet.bybit.com',
}

export const BYBIT_CLIENT_ID = 'ai-agent'
export const BYBIT_SCOPE = 'ai-account'
export const BYBIT_CODE_CHALLENGE_METHOD = 'S256'

export interface PkceSession {
  verifier: string
  challenge: string
  state: string
  env: BybitEnv
  createdAt: string
}

export interface BybitAccessTokenResp {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

export interface BybitAiAccountCred {
  subAccountId: string
  subAccountName?: string
  apiKey: string
  apiSecret: string
  passphrase?: string
  readOnly?: boolean
  permissions?: string[]
}

export interface BybitAiAccountsResp {
  retCode: number
  retMsg: string
  result: {
    aiAccounts?: BybitAiAccountCred[]
    list?: BybitAiAccountCred[]
  }
}

export interface MaskedBybitCred {
  subAccountId: string
  subAccountName?: string
  maskedApiKey: string
  maskedApiSecret: string
  env: BybitEnv
  vaultKeyApiKey: string
  vaultKeyApiSecret: string
}

// ─── Session store (in-memory, TTL 15 min = auth code expiry) ────────────

const SESSION_TTL_MS = 15 * 60 * 1000
const sessions = new Map<string, PkceSession>()

function pruneSessions(): void {
  const now = Date.now()
  for (const [k, s] of sessions) {
    if (now - new Date(s.createdAt).getTime() > SESSION_TTL_MS) sessions.delete(k)
  }
}

export function saveSession(s: PkceSession): PkceSession {
  pruneSessions()
  sessions.set(s.state, s)
  return s
}

export function getSession(state: string): PkceSession | null {
  pruneSessions()
  return sessions.get(state) ?? null
}

export function popSession(state: string): PkceSession | null {
  pruneSessions()
  const s = sessions.get(state) ?? null
  if (s) sessions.delete(state)
  return s
}

// ─── PKCE helpers ────────────────────────────────────────────────────────

function urlSafeB64(buf: Buffer): string {
  return buf.toString('base64url').replace(/=+$/, '')
}

export function generateVerifier(): string {
  return urlSafeB64(randomBytes(48))
}

export function generateChallenge(verifier: string): string {
  return urlSafeB64(createHash('sha256').update(verifier).digest())
}

export function generateState(): string {
  return urlSafeB64(randomBytes(24))
}

export function buildAuthzUrl(env: BybitEnv, state: string, challenge: string): string {
  const u = new URL(`${BYBIT_WWW[env]}/en/account/oauth`)
  u.searchParams.set('client_id', BYBIT_CLIENT_ID)
  u.searchParams.set('scope', BYBIT_SCOPE)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', BYBIT_CODE_CHALLENGE_METHOD)
  u.searchParams.set('state', state)
  return u.toString()
}

// ─── Token exchange & credential retrieval ───────────────────────────────

export async function exchangeAccessToken(
  env: BybitEnv,
  payload:
    | { grant_type: 'authorization_code'; code: string; code_verifier: string }
    | { grant_type: 'refresh_token'; refresh_token: string },
): Promise<BybitAccessTokenResp> {
  const base = BYBIT_BASE[env]
  const body: Record<string, string> = {
    client_id: BYBIT_CLIENT_ID,
    ...payload,
  }
  const res = await fetch(`${base}/oauth/v1/public/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(
      `[Bybit][${env}] access_token HTTP ${res.status}: ${txt.slice(0, 300)}`,
    )
  }
  return (await res.json()) as BybitAccessTokenResp
}

export async function fetchAiAccounts(
  env: BybitEnv,
  accessToken: string,
): Promise<BybitAiAccountCred[]> {
  const res = await fetch(`${BYBIT_BASE[env]}/oauth/v1/resource/restrict/ai_accounts`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(
      `[Bybit][${env}] ai_accounts HTTP ${res.status}: ${txt.slice(0, 300)}`,
    )
  }
  const json = (await res.json()) as BybitAiAccountsResp
  if (json.retCode !== 0) {
    throw new Error(`[Bybit][${env}] ai_accounts retCode=${json.retCode} ${json.retMsg}`)
  }
  return (json.result.aiAccounts ?? json.result.list ?? []) as BybitAiAccountCred[]
}

// ─── Credential masking + vault storage ───────────────────────────────────

export function maskApiKey(key: string): string {
  if (!key) return '••••'
  if (key.length <= 9) return '••••'
  return `${key.slice(0, 5)}••••${key.slice(-4)}`
}

export function maskApiSecret(secret: string): string {
  if (!secret) return '••••'
  if (secret.length <= 5) return '••••'
  return `••••${secret.slice(-5)}`
}

export interface PersistCredsInput {
  env: BybitEnv
  subAccountId: string
  subAccountName?: string
  apiKey: string
  apiSecret: string
  passphrase?: string
  ttlHours?: number
  ownerName?: string
  ownerEmail?: string
}

export interface PersistedCred {
  vaultKeyApiKey: string
  vaultKeyApiSecret: string
  vaultKeyPassphrase?: string
  maskedApiKey: string
  maskedApiSecret: string
  env: BybitEnv
  subAccountId: string
  subAccountName?: string
  accountLabel: string
}

export function persistCredsToVault(input: PersistCredsInput): PersistedCred {
  const prefix = `BYBIT_${input.env}_${input.subAccountId.toUpperCase()}`
  const vKey = `${prefix}_API_KEY`
  const vSec = `${prefix}_API_SECRET`
  const vPass = input.passphrase ? `${prefix}_PASSPHRASE` : undefined
  injectSecret({
    key: vKey,
    provider: 'bybit',
    value: input.apiKey,
    label: `Bybit ${input.env} AI key — ${input.subAccountName ?? input.subAccountId}`,
    ttlHours: input.ttlHours ?? 8,
  })
  injectSecret({
    key: vSec,
    provider: 'bybit',
    value: input.apiSecret,
    label: `Bybit ${input.env} AI secret — ${input.subAccountName ?? input.subAccountId}`,
    ttlHours: input.ttlHours ?? 8,
  })
  if (vPass && input.passphrase) {
    injectSecret({
      key: vPass,
      provider: 'bybit',
      value: input.passphrase,
      label: `Bybit ${input.env} AI passphrase — ${input.subAccountName ?? input.subAccountId}`,
      ttlHours: input.ttlHours ?? 8,
    })
  }
  const accountLabel = `Bybit ${input.env} — ${input.subAccountName ?? input.subAccountId}`
  return {
    vaultKeyApiKey: vKey,
    vaultKeyApiSecret: vSec,
    vaultKeyPassphrase: vPass,
    maskedApiKey: maskApiKey(input.apiKey),
    maskedApiSecret: maskApiSecret(input.apiSecret),
    env: input.env,
    subAccountId: input.subAccountId,
    subAccountName: input.subAccountName,
    accountLabel,
  }
}

export function resolveBybitCredKeys(prefixKey: string): {
  apiKey: string | null
  apiSecret: string | null
  passphrase: string | null
} {
  const apiKey = getSecret(prefixKey.replace(/_API_(KEY|SECRET|PASSPHRASE)$/, '_API_KEY'))
  const apiSecret = getSecret(prefixKey.replace(/_API_(KEY|SECRET|PASSPHRASE)$/, '_API_SECRET'))
  const passphrase = getSecret(prefixKey.replace(/_API_(KEY|SECRET|PASSPHRASE)$/, '_API_PASSPHRASE'))
  return { apiKey, apiSecret, passphrase }
}
