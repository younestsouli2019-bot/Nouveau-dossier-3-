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