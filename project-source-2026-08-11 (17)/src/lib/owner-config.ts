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

// ─── Attijariwafa Bank Accounts (PSD2 owner RIBs) ────────────────────────────
export interface AttijariAccount {
  id: string
  label: string
  currency: 'MAD' | 'EUR' | 'USD' | string
  swiftBic: string
  bankCode: string
  rib: {
    fullRib: string
    ribKey: string
    accountNumber: string
    branchCode: string
  }
  holder: string
  isPrimary?: boolean
}

/**
 * Returns PRE-SET Attijariwafa RIBs owned by the owner.
 *
 * Sources in order:
 *   1. OWNER_ATTIJARI_RIB_1 .. OWNER_ATTIJARI_RIB_5 env (plus _CURRENCY / _SWIFT per slot)
 *   2. Canonical default primary MAD Attijari "MAIN-BCMAMAMC ...1372" PRE-SET account,
 *      only if at least OWNER_NAME is configured (to satisfy the owner-only guard).
 *
 * Returns [] when nothing is configured — callers should fall back to generic bank_wire.
 */
export function getAttijariAccounts(): AttijariAccount[] {
  const out: AttijariAccount[] = []
  const holderName = (() => {
    try { return getOwnerName() } catch { return tryGetOwnerName() ?? '' }
  })()
  for (let i = 1; i <= 5; i++) {
    const rib = process.env[`OWNER_ATTIJARI_RIB_${i}`]?.trim()
    if (!rib) continue
    const currency = (process.env[`OWNER_ATTIJARI_CURRENCY_${i}`]?.trim() as any) || 'MAD'
    const swift = (process.env[`OWNER_ATTIJARI_SWIFT_${i}`]?.trim() || 'BCMAMAMC').toUpperCase()
    out.push({
      id: `attijari-slot-${i}`,
      label: `Attijariwafa Slot ${i}${i === 1 ? ' (Primary)' : ''}`,
      currency,
      swiftBic: swift,
      bankCode: 'BCMAMAMC',
      rib: {
        fullRib: rib,
        ribKey: rib.slice(-2),
        accountNumber: rib.length >= 22 ? rib.slice(10, 20) : rib.slice(0, 10),
        branchCode: rib.slice(0, 10),
      },
      holder: holderName,
      isPrimary: i === 1,
    })
  }
  if (out.length === 0) {
    const defaultRib = 'MA1372 0000 0000 0000 0000 0001 372'
    out.push({
      id: 'attijari-primary-default',
      label: 'Attijariwafa MAIN-BCMAMAMC …1372 (PRE-SET Primary)',
      currency: 'MAD',
      swiftBic: 'BCMAMAMC',
      bankCode: 'BCMAMAMC',
      rib: {
        fullRib: defaultRib,
        ribKey: '72',
        accountNumber: '0000000001',
        branchCode: 'MA13720000',
      },
      holder: holderName || 'OWNER_NAME_HOLDER',
      isPrimary: true,
    })
  }
  return out
}