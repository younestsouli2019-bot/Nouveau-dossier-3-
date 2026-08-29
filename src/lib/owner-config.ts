// ─── Owner Configuration — Secrets-Only ────────────────────────────────────
// All owner identity and account information MUST come from environment
// variables (GitHub Secrets in production). No hardcoded fallbacks.
//
// Required secrets:
//   OWNER_NAME    — Full legal name (e.g. "YOUNES TSOULI")
//   OWNER_EMAIL   — Payout recipient email
//   OWNER_WALLET_ARBITRUM, OWNER_WALLET_OPTIMISM, OWNER_WALLET_BASE,
//   OWNER_WALLET_POLYGON_ZKEVM, OWNER_WALLET_LINEA, OWNER_WALLET_SCROLL
//
// Two tiers of getters:
//   getOwnerName() / getOwnerEmail()  — THROW if missing (for write/recovery paths)
//   tryGetOwnerName() / tryGetOwnerEmail()  — return null if missing (for read/diagnostic paths)
// ────────────────────────────────────────────────────────────────────────────

/** Owner's full name — strictly from OWNER_NAME secret. */
export function getOwnerName(): string {
  const name = process.env.OWNER_NAME
  if (!name || name.trim() === '') {
    throw new Error('OWNER_NAME secret is not configured. Set it in GitHub Secrets.')
  }
  return name.trim()
}

/** Owner's email — strictly from OWNER_EMAIL secret. */
export function getOwnerEmail(): string {
  const email = process.env.OWNER_EMAIL
  if (!email || email.trim() === '' || email.includes('example.com')) {
    throw new Error('OWNER_EMAIL secret is not configured. Set it in GitHub Secrets.')
  }
  return email.trim()
}

/** Owner's name with " OWNER" suffix for payout recipient display. */
export function getOwnerDisplayName(): string {
  return `${getOwnerName()} OWNER`
}

/** Owner's name uppercased for case-insensitive matching. */
export function getOwnerNameUpper(): string {
  return getOwnerName().toUpperCase()
}

// ─── Safe (non-throwing) variants for read-only / diagnostic paths ──────────

/** Owner's name — returns null if not configured (safe for diagnostics). */
export function tryGetOwnerName(): string | null {
  const name = process.env.OWNER_NAME
  if (!name || name.trim() === '') return null
  return name.trim()
}

/** Owner's email — returns null if not configured (safe for diagnostics). */
export function tryGetOwnerEmail(): string | null {
  const email = process.env.OWNER_EMAIL
  if (!email || email.trim() === '' || email.includes('example.com')) return null
  return email.trim()
}

/** Owner's name uppercased — returns null if not configured. */
export function tryGetOwnerNameUpper(): string | null {
  const name = tryGetOwnerName()
  return name ? name.toUpperCase() : null
}

/** Whether owner config is complete and valid. */
export function isOwnerConfigured(): boolean {
  try {
    getOwnerName()
    getOwnerEmail()
    return true
  } catch {
    return false
  }
}

/** Validate owner config — call at app startup / API boundary. */
export function requireOwnerConfig(): { name: string; email: string; nameUpper: string; displayName: string } {
  const name = getOwnerName()
  const email = getOwnerEmail()
  return {
    name,
    email,
    nameUpper: name.toUpperCase(),
    displayName: `${name} OWNER`,
  }
}

/** Get a single crypto wallet address for a network — strictly from secrets. */
export function getOwnerWallet(network: string): string | undefined {
  const map: Record<string, string | undefined> = {
    arbitrum: process.env.OWNER_WALLET_ARBITRUM,
    optimism: process.env.OWNER_WALLET_OPTIMISM,
    base: process.env.OWNER_WALLET_BASE,
    polygon_zkevm: process.env.OWNER_WALLET_POLYGON_ZKEVM,
    linea: process.env.OWNER_WALLET_LINEA,
    scroll: process.env.OWNER_WALLET_SCROLL,
  }
  return map[network]
}

/** Get all configured owner wallets keyed by network. */
export function getAllOwnerWallets(): Record<string, string | undefined> {
  return {
    arbitrum: process.env.OWNER_WALLET_ARBITRUM,
    optimism: process.env.OWNER_WALLET_OPTIMISM,
    base: process.env.OWNER_WALLET_BASE,
    polygon_zkevm: process.env.OWNER_WALLET_POLYGON_ZKEVM,
    linea: process.env.OWNER_WALLET_LINEA,
    scroll: process.env.OWNER_WALLET_SCROLL,
  }
}

/** Get configured wallet addresses only (filter out undefined). */
export function getConfiguredWallets(): Record<string, string> {
  const all = getAllOwnerWallets()
  const configured: Record<string, string> = {}
  for (const [network, address] of Object.entries(all)) {
    if (address && address.trim() !== '' && !address.startsWith('0x0')) {
      configured[network] = address
    }
  }
  return configured
}

/** List of supported L2 networks for crypto settlements. */
export const SUPPORTED_NETWORKS = [
  'arbitrum',
  'optimism',
  'base',
  'polygon_zkevm',
  'linea',
  'scroll',
] as const

export type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number]

// ─── Pre-Set Owner Payout Destination (Registered Once, Reused Forever) ──────
// Regulatory architecture (2026-08-20): Buyer → Platform Settlement Account
//   → [verify + split + fee deduct] → Auto-payout to Pre-Set Owner Account.
// The platform ALWAYS touches funds first (licensing/AML/KYC/PSD2/SCA).
// The "direct to owner" experience is because the disbursement leg is
// automated — not because the platform is skipped.
//
// Required secrets for preset payout destination:
//   OWNER_PAYOUT_RAIL         — one of: ach | iban | sepa | card_token | crypto
//   OWNER_PAYOUT_CURRENCY     — ISO 4217 (EUR, USD, GBP, etc.)
//   OWNER_PAYOUT_IDENTIFIER   — masked last-4 shown on receipts; full value
//                                 stored only here (secrets), never in DB.
//   OWNER_PAYOUT_COUNTRY      — ISO 3166-1 alpha-2 (needed for KYC jurisdiction)
//   OWNER_PAYOUT_HOLDER_NAME  — legal name on the receiving account
// Optional:
//   OWNER_PAYOUT_BANK_BIC     — SEPA/IBAN BIC/SWIFT
//   OWNER_PAYOUT_ROUTING_NO   — US ACH routing number
//   OWNER_PAYOUT_CRYPTO_NET   — see SUPPORTED_NETWORKS
//   OWNER_KYC_STATUS          — NOT_STARTED | PENDING | PASSED | FAILED | EXPIRED
//   OWNER_KYC_REFERENCE       — KYC/KYB provider reference (Onfido/Veriff/Jumio ID)
//   OWNER_KYB_LEGAL_NAME      — KYB verified legal entity (B2B settlement scope)
//   OWNER_KYB_VAT_ID          — EU VAT or EIN for KYB
//   OWNER_PAYOUT_SCHEDULE     — instant | daily_cutoff_2359UTC | weekly_monday | net_30
//   OWNER_PAYOUT_FEE_BPS      — platform fee basis points during disbursement split

export type PayoutRail = 'ach' | 'iban' | 'sepa' | 'card_token' | 'crypto'
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'PASSED' | 'FAILED' | 'EXPIRED'
export type PayoutSchedule =
  | 'instant'
  | 'daily_cutoff_2359UTC'
  | 'weekly_monday'
  | 'net_30'

export interface PresetPayoutDestination {
  readonly rail: PayoutRail
  readonly currency: string
  readonly identifier: string
  readonly country: string
  readonly holderName: string
  readonly bic?: string
  readonly routingNumber?: string
  readonly cryptoNetwork?: SupportedNetwork
}

export interface OwnerComplianceStatus {
  readonly kycStatus: KycStatus
  readonly kycReference?: string
  readonly kybLegalName?: string
  readonly kybVatId?: string
}

export interface DisbursementPolicy {
  readonly schedule: PayoutSchedule
  readonly platformFeeBps: number
  readonly fraudWindowHoldHours: number
  readonly chargebackReservePct: number
  // Treasury bucket percentages applied to NET settlement value.
  // MUST sum to 100. Env: OWNER_BUCKET_SOVEREIGN_PCT / OWNER_BUCKET_PROCUREMENT_PCT
  //       / OWNER_BUCKET_RUNTIME_PCT / OWNER_BUCKET_SALARY_PCT
  readonly bucketPct: {
    sovereignReserves: number
    procurementBuffer: number
    runtimeOperations: number
    salary: number
  }
}

function mustEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') throw new Error(`${name} secret is not configured. Set it in GitHub Secrets.`)
  return v.trim()
}
function tryEnv(name: string): string | null {
  const v = process.env[name]
  if (!v || v.trim() === '') return null
  return v.trim()
}

export function getPresetPayoutDestination(): PresetPayoutDestination {
  const rail = mustEnv('OWNER_PAYOUT_RAIL') as PayoutRail
  if (!['ach', 'iban', 'sepa', 'card_token', 'crypto'].includes(rail)) {
    throw new Error(`OWNER_PAYOUT_RAIL=${rail} invalid; expected ach|iban|sepa|card_token|crypto`)
  }
  const currency = mustEnv('OWNER_PAYOUT_CURRENCY')
  const identifier = mustEnv('OWNER_PAYOUT_IDENTIFIER')
  const country = mustEnv('OWNER_PAYOUT_COUNTRY')
  const holderName = mustEnv('OWNER_PAYOUT_HOLDER_NAME')
  const bic = tryEnv('OWNER_PAYOUT_BANK_BIC') || undefined
  const routingNumber = tryEnv('OWNER_PAYOUT_ROUTING_NO') || undefined
  const cryptoRaw = tryEnv('OWNER_PAYOUT_CRYPTO_NET')
  const cryptoNetwork =
    cryptoRaw && (SUPPORTED_NETWORKS as readonly string[]).includes(cryptoRaw)
      ? (cryptoRaw as SupportedNetwork)
      : undefined
  return Object.freeze({ rail, currency, identifier, country, holderName, bic, routingNumber, cryptoNetwork })
}

export function tryGetPresetPayoutDestination(): PresetPayoutDestination | null {
  try { return getPresetPayoutDestination() } catch { return null }
}

export function getOwnerComplianceStatus(): OwnerComplianceStatus {
  const raw = (tryEnv('OWNER_KYC_STATUS') || 'NOT_STARTED').toUpperCase() as KycStatus
  const allowed: KycStatus[] = ['NOT_STARTED', 'PENDING', 'PASSED', 'FAILED', 'EXPIRED']
  const kycStatus = allowed.includes(raw) ? raw : 'NOT_STARTED'
  return Object.freeze({
    kycStatus,
    kycReference: tryEnv('OWNER_KYC_REFERENCE') || undefined,
    kybLegalName: tryEnv('OWNER_KYB_LEGAL_NAME') || undefined,
    kybVatId: tryEnv('OWNER_KYB_VAT_ID') || undefined,
  })
}

export function isOwnerKycPassed(): boolean {
  return getOwnerComplianceStatus().kycStatus === 'PASSED'
}

export function getDisbursementPolicy(): DisbursementPolicy {
  const rawSched = (tryEnv('OWNER_PAYOUT_SCHEDULE') || 'instant').toLowerCase() as PayoutSchedule
  const allowedSched: PayoutSchedule[] = ['instant', 'daily_cutoff_2359UTC', 'weekly_monday', 'net_30']
  const schedule = allowedSched.includes(rawSched) ? rawSched : 'instant'
  const platformFeeBps = Math.max(0, Math.min(10000, parseInt(tryEnv('OWNER_PAYOUT_FEE_BPS') || '0', 10) || 0))
  const fraudWindowHoldHours = Math.max(0, parseInt(tryEnv('OWNER_FRAUD_WINDOW_HOLD_HOURS') || '72', 10) || 0)
  const chargebackReservePct = Math.max(0, Math.min(100, parseInt(tryEnv('OWNER_CHARGEBACK_RESERVE_PCT') || '5', 10) || 0))
  const buck = (name: string, def: number) =>
    Math.max(0, Math.min(100, parseInt(tryEnv(name) || String(def), 10) || def))
  const bucketPct = {
    sovereignReserves: buck('OWNER_BUCKET_SOVEREIGN_PCT', 30),
    procurementBuffer: buck('OWNER_BUCKET_PROCUREMENT_PCT', 10),
    runtimeOperations: buck('OWNER_BUCKET_RUNTIME_PCT', 20),
    salary: buck('OWNER_BUCKET_SALARY_PCT', 40),
  }
  // Never deploy a policy that routes more than 100% of value: fail-closed.
  const bucketTotal = Object.values(bucketPct).reduce((a, b) => a + b, 0)
  if (bucketTotal !== 100) {
    throw new Error(
      `OWNER_BUCKET_* percentages must sum to 100 (got ${bucketTotal}). ` +
        'Refusing to start disbursements with an unbounded treasury split.',
    )
  }
  return Object.freeze({
    schedule,
    platformFeeBps,
    fraudWindowHoldHours,
    chargebackReservePct,
    bucketPct: Object.freeze(bucketPct),
  })
}

export function maskPayoutIdentifier(d: PresetPayoutDestination): string {
  const s = d.identifier
  if (s.length <= 4) return '****'
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`
}

export function isPayoutConfigComplete(): boolean {
  try {
    getPresetPayoutDestination()
    return true
  } catch {
    return false
  }
}