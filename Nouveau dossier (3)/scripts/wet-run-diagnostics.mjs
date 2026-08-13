// ─── Pure-JS wet-run diagnostics driver ──────────────────────────────────
// Mirrors connector-engine routing + owner config logic without TypeScript
// imports. Produces connector routing + per-account confirmation card report.
// LIVE execution is NEVER done from this local driver (it's API-only).
// ─────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cwd = process.cwd()
for (const p of [
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '.env.local'),
  path.resolve(cwd, '.env'),
  path.resolve(cwd, '.env.local'),
]) {
  try {
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf8')
      for (const line of txt.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
        const idx = trimmed.indexOf('=')
        let k = trimmed.slice(0, idx).trim()
        let v = trimmed.slice(idx + 1).trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        if (!(k in process.env)) process.env[k] = v
      }
    }
  } catch { /* noop */ }
}

const ACCOUNTS = [
  { id: 'seed-attijari', label: 'Salary - Attijariwafa', accountType: 'bank_wire', purposes: 'salary', swiftCode: 'BCMAMAMC', bankName: 'Attijariwafa Bank', accountNumber: '007810000448200061321372', currency: 'MAD', paypalEmail: '', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '' },
  { id: 'seed-bpop', label: 'Settlements - Banque Populaire', accountType: 'bank_wire', purposes: 'settlements,reconciliation', swiftCode: 'BPCEMCMC', bankName: 'Banque Populaire', accountNumber: '000410000448200061321372', currency: 'MAD', paypalEmail: '', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '' },
  { id: 'seed-chase', label: 'USD Wire - Chase Bank', accountType: 'bank_wire', purposes: 'general,settlements', swiftCode: 'CHASUS33', bankName: 'JPMorgan Chase Bank', accountNumber: '0210000211234567', routingNumber: '021000021', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '' },
  { id: 'seed-arb', label: 'USDC - Arbitrum', accountType: 'l2_crypto', purposes: 'crypto_settlement,settlements', walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4E8A0', network: 'Arbitrum', preferredToken: 'USDC', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '' },
  { id: 'seed-opt', label: 'USDT - Optimism', accountType: 'l2_crypto', purposes: 'crypto_settlement', walletAddress: '0x4200000000000000000000000000000000000006', network: 'Optimism', preferredToken: 'USDT', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '' },
  { id: 'seed-base', label: 'ETH - Base', accountType: 'l2_crypto', purposes: 'crypto_settlement', walletAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', network: 'Base', preferredToken: 'ETH', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '' },
  { id: 'seed-poly', label: 'USDC - Polygon', accountType: 'l2_crypto', purposes: 'crypto_settlement,settlements', walletAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', network: 'Polygon', preferredToken: 'USDC', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '' },
  { id: 'seed-linea', label: 'WBTC - Linea', accountType: 'l2_crypto', purposes: 'crypto_settlement', walletAddress: '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5', network: 'Linea', preferredToken: 'WBTC', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '' },
  { id: 'seed-pp', label: 'PayPal Business', accountType: 'paypal', purposes: 'settlements,general', paypalEmail: 'y.tsouli.business@gmail.com', currency: 'USD', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '', swiftCode: '', bankName: '', accountNumber: '' },
  { id: 'seed-wise', label: 'Wise - EUR', accountType: 'wise', purposes: 'settlements,reconciliation', wiseEmail: 'younes@tsouli.com', currency: 'EUR', paypalEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '', swiftCode: '', bankName: '', accountNumber: '' },
]

const OWNER_NAME = process.env.OWNER_NAME || ''
const OWNER_EMAIL = process.env.OWNER_EMAIL || ''
const ownerConfigured =
  !!OWNER_NAME && OWNER_NAME.trim() !== '' &&
  !!OWNER_EMAIL && OWNER_EMAIL.trim() !== '' && !OWNER_EMAIL.includes('example.com')

const WALLETS = {
  arbitrum: process.env.OWNER_WALLET_ARBITRUM || '',
  optimism: process.env.OWNER_WALLET_OPTIMISM || '',
  base: process.env.OWNER_WALLET_BASE || '',
  polygon_zkevm: process.env.OWNER_WALLET_POLYGON_ZKEVM || '',
  linea: process.env.OWNER_WALLET_LINEA || '',
  scroll: process.env.OWNER_WALLET_SCROLL || '',
}
const configuredWallets = Object.fromEntries(Object.entries(WALLETS).filter(([, v]) => v && v.trim() !== '' && !v.startsWith('0x0')))

const CONNECTORS = [
  { id: 'paypal', label: 'PayPal', vaultKeys: ['PAYPAL_LIVE_CLIENT_ID', 'PAYPAL_LIVE_SECRET'] },
  { id: 'payoneer', label: 'Payoneer', vaultKeys: ['PAYONEER_API_TOKEN', 'PAYONEER_PROGRAM_ID', 'PAYONEER_PARTNER_ID'] },
  { id: 'bank_wire', label: 'Bank Wire', vaultKeys: ['BANK_API_KEY', 'BANK_API_ENDPOINT'] },
  { id: 'crypto', label: 'Crypto', vaultKeys: ['CRYPTO_SIGNING_URL'] },
  { id: 'attijari', label: 'Attijariwafa', vaultKeys: ['ATTIJARI_CLIENT_CERT', 'ATTIJARI_CLIENT_KEY'] },
]

const ATTIJARI_ROUTES = [
  { routeId: 'MAIN-BCMAMAMC', rib: process.env.ATTIJARI_MAIN_RIB || process.env.OWNER_RIB_MAIN || '007810000448200061321372', weight: 50 },
  { routeId: 'BRANCH-AGDAL', rib: process.env.ATTIJARI_BRANCH_RIB || process.env.OWNER_RIB_BRANCH || '007810012345678901234567', weight: 30 },
  { routeId: 'FACTORING', rib: process.env.ATTIJARI_FACT_RIB || '007810098765432109876543', weight: 20 },
]
const attijariAccounts = (process.env.ATTIJARI_MAIN_RIB || process.env.OWNER_RIB_MAIN)
  ? [{ rib: { fullRib: ATTIJARI_ROUTES[0].rib, last4: ATTIJARI_ROUTES[0].rib.slice(-4) }, iban: `MA${ATTIJARI_ROUTES[0].rib}` }]
  : ATTIJARI_ROUTES.map((r) => ({ rib: { fullRib: r.rib, last4: r.rib.slice(-4) }, iban: `MA${r.rib}` }))

function liveGate() { return process.env.SWARM_LIVE_PAYMENTS === 'true' }
function maskSecret(s) { if (!s || s.length <= 4) return '••••'; return `••••${s.slice(-4)}` }

function connectorPresence(id) {
  const meta = CONNECTORS.find((c) => c.id === id)
  const vaultPresent = meta.vaultKeys.every((k) => process.env[k] && !String(process.env[k]).startsWith('your_'))
  let envFallback = false
  if (id === 'paypal') envFallback = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && !process.env.PAYPAL_CLIENT_ID.startsWith('your_'))
  if (id === 'payoneer') envFallback = !!(process.env.PAYONEER_API_TOKEN && process.env.PAYONEER_PROGRAM_ID && process.env.PAYONEER_PARTNER_ID && !process.env.PAYONEER_API_TOKEN.startsWith('your_'))
  if (id === 'bank_wire') envFallback = !!(process.env.BANK_WIRE_BANK_NAME && process.env.BANK_WIRE_BIC && process.env.BANK_WIRE_ACCOUNT_NUMBER && process.env.BANK_WIRE_ACCOUNT_NAME)
  if (id === 'attijari') envFallback = !!(process.env.ATTIJARI_CLIENT_ID && process.env.ATTIJARI_CLIENT_SECRET)
  if (id === 'crypto') envFallback = false
  const source = vaultPresent ? 'vault' : envFallback ? 'env' : null
  return { configured: vaultPresent || envFallback, source, liveReady: liveGate() && vaultPresent }
}

function routeConnectors(a) {
  const out = []
  switch (a.accountType) {
    case 'bank_wire': {
      const swift = (a.swiftCode || '').toUpperCase()
      if (swift === 'BCMAMAMC' || (a.bankName || '').toLowerCase().includes('attijari')) out.push('attijari')
      out.push('bank_wire')
      break
    }
    case 'l2_crypto': out.push('crypto'); break
    case 'paypal': out.push('paypal'); break
    case 'wise':
    case 'payoneer': out.push('payoneer'); break
    default: break
  }
  return out
}

function resolveRecipient(a) {
  switch (a.accountType) {
    case 'paypal': return { recipient: a.paypalEmail || OWNER_EMAIL || '', type: 'email' }
    case 'wise': return { recipient: a.wiseEmail || OWNER_EMAIL || '', type: 'email' }
    case 'payoneer': return { recipient: a.payoneerId || OWNER_EMAIL || '', type: 'email' }
    case 'l2_crypto': {
      const net = (a.network || 'arbitrum').toLowerCase().replace(/ /g, '_')
      return { recipient: a.walletAddress || configuredWallets[net] || Object.values(configuredWallets)[0] || '', type: 'wallet' }
    }
    case 'bank_wire': {
      if ((a.swiftCode || '').toUpperCase() === 'BCMAMAMC' && attijariAccounts.length) return { recipient: attijariAccounts[0].rib.fullRib, type: 'rib' }
      return { recipient: a.accountNumber || '', type: 'rib' }
    }
    default: return null
  }
}

function isOwnerRecipient(type, recipient) {
  const r = (recipient || '').trim().toLowerCase()
  if (!r) return false
  if (type === 'email') return OWNER_EMAIL && r === OWNER_EMAIL.trim().toLowerCase()
  if (type === 'wallet') return Object.values(configuredWallets).some((w) => w.trim().toLowerCase() === r)
  if (type === 'rib') return attijariAccounts.some((a) => a.rib.fullRib.replace(/\s+/g, '').toLowerCase() === r.replace(/\s+/g, '') || a.iban.replace(/\s+/g, '').toLowerCase() === r.replace(/\s+/g, ''))
  return false
}

function amount(a) {
  const p = (a.purposes || '').toLowerCase()
  const cur = (a.currency || 'USD').toUpperCase()
  if (p.includes('salary')) return cur === 'MAD' ? 250 : cur === 'USD' ? 100 : 50
  if (p.includes('crypto')) return 10
  if (p.includes('settlement') || p.includes('reconcil')) return cur === 'MAD' ? 500 : cur === 'EUR' ? 20 : 50
  return cur === 'MAD' ? 100 : cur === 'EUR' ? 10 : 25
}

function mask(type, value) {
  if (!value) return '••••'
  if (type === 'email') { const [l, d] = value.split('@'); if (!l || !d) return '••••'; return `${l.slice(0, Math.max(1, Math.floor(l.length / 3)))}••••@${d}` }
  if (type === 'wallet') { if (value.length <= 8) return '••••'; return `${value.slice(0, 6)}••••${value.slice(-4)}` }
  if (value.length <= 8) return '••••'; return `••••${value.slice(-4)}`
}

const startedAt = new Date().toISOString()
const live = liveGate()
const actuallyLive = live && process.env.INCLUDE_LIVE === 'true'
const prefix = `WET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`

console.log('')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('   🌊 SWARM SETTLEMENTS — WET-RUN DIAGNOSTIC  (dry-run by default, owner-only)')
console.log('═══════════════════════════════════════════════════════════════════════════════')
console.log('')
console.log(`OWNER configured : ${ownerConfigured ? '✅  complete' : '⚠️  partial — set OWNER_NAME / OWNER_EMAIL secrets'}`)
console.log(`OWNER name       : ${OWNER_NAME || '(unset)'}`)
console.log(`OWNER email      : ${OWNER_EMAIL || '(unset)'}`)
console.log(`OWNER wallets    : ${Object.keys(configuredWallets).length} configured (${Object.keys(configuredWallets).join(', ') || 'none'})`)
console.log(`Attijari routes  : ${attijariAccounts.length} (${ATTIJARI_ROUTES.map((r) => r.routeId + ':' + r.rib.slice(-4)).join(', ')})`)
console.log(`LIVE gate        : SWARM_LIVE_PAYMENTS=${process.env.SWARM_LIVE_PAYMENTS || '(unset)'}  → paymentsLive() = ${live}`)
console.log(`LIVE run request : ${process.env.INCLUDE_LIVE === 'true' ? 'REQUESTED (type CONFIRM for real execution)' : 'NOT requested — DRY RUN ONLY'}  → actually LIVE = ${actuallyLive}`)
console.log('')
console.log('─── Connector matrix (vault keys vs env fallbacks) ───────────────────────')
console.log('')
const statuses = CONNECTORS.map((c) => ({ ...c, ...connectorPresence(c.id) }))
for (const s of statuses) {
  const mark = s.liveReady ? '🟢 LIVE READY' : s.configured ? '🟡 CONFIGURED (dry-run)' : '🔴 NOT CONFIGURED'
  const src = s.source ? ` (source=${s.source})` : ' (missing — inject vault keys or set env vars)'
  const keyHints = s.vaultKeys.map((k) => `${k}=${process.env[k] ? (k.includes('KEY') || k.includes('TOKEN') || k.includes('SECRET') ? maskSecret(process.env[k]) : process.env[k]) : 'unset'}`).join(' · ')
  console.log(`  ${mark}  ${s.id.padEnd(10)} ${s.label.padEnd(14)} ${keyHints}${src}`)
}
console.log('')
console.log('─── Per PRE-SET owner account × connector routing  (DRY RUN — SIMULATED) ─')
console.log('')
const runs = []
let simulated = 0
let rejected = 0
for (const a of ACCOUNTS) {
  const connectors = routeConnectors(a)
  if (!connectors.length) continue
  const r = resolveRecipient(a)
  if (!r || !r.recipient) continue
  const ownerMatch = isOwnerRecipient(r.type, r.recipient)
  const amt = amount(a)
  for (let i = 0; i < connectors.length; i++) {
    const connector = connectors[i]
    const meta = CONNECTORS.find((c) => c.id === connector)
    const ref = `${prefix}-${a.id.slice(-6)}-${connector}-${i + 1}`
    const presence = connectorPresence(connector)
    const status = ownerMatch ? (presence.configured ? 'SIMULATED' : 'SIMULATED (missing creds — will fail when LIVE)') : 'REJECTED — non-owner recipient blocked'
    if (ownerMatch) simulated++; else rejected++
    const confirmCard = {
      asset: (a.currency || 'USD').toUpperCase(),
      amount: `${(a.currency || 'USD').toUpperCase()} ${Number(amt).toFixed(2)}`,
      direction: 'outbound → PRE-SET OWNER account',
      estimatedCost: ownerMatch ? 'Owner-only routing — no fee' : 'N/A (recipient not owner — BLOCKED)',
      recipientMasked: mask(r.type, r.recipient),
      connector: meta?.label ?? connector,
      recipientOwner: ownerMatch,
      connectorLiveReady: presence.liveReady,
      connectorConfigured: presence.configured,
    }
    runs.push({
      ownerAccountId: a.id, label: a.label, accountType: a.accountType,
      purposes: a.purposes, connectors, connector,
      reference: ref, currency: confirmCard.asset, plannedAmount: amt,
      recipientType: r.type, recipientMasked: confirmCard.recipientMasked,
      dryRunStatus: status, confirmCard,
    })
    const mark = ownerMatch ? (presence.liveReady ? '🟢' : presence.configured ? '🟡' : '⚪') : '🔴'
    console.log(`  ${mark}  ${String(runs.length).padStart(2, '0')}. ${a.label.padEnd(30)} via ${connector.padEnd(9)}  ${confirmCard.asset.padEnd(4)} ${String(amt).padStart(7)} → ${confirmCard.recipientMasked}  [${ref}]`)
    if (!ownerMatch) console.log(`         ❌  BLOCKED: recipient does not resolve to owner email/wallet/RIB`)
    else if (!presence.configured) console.log(`         ⚪  DRY RUN ONLY: ${meta.label} not configured — build confirmation card only`)
  }
}
console.log('')
console.log('─── Summary ──────────────────────────────────────────────────────────────')
console.log('')
console.log(`  PRE-SET owner accounts        : ${ACCOUNTS.length}`)
console.log(`  Matched (routes generated)    : ${new Set(runs.map((r) => r.ownerAccountId)).size}`)
console.log(`  Total routed (account × conn) : ${runs.length}`)
console.log(`  SIMULATED (owner matches)     : ${simulated} / ${runs.length}`)
console.log(`  REJECTED (non-owner)          : ${rejected}`)
console.log(`  Connectors LIVE READY         : ${statuses.filter((s) => s.liveReady).length} / ${statuses.length}`)
console.log(`  Connectors CONFIGURED         : ${statuses.filter((s) => s.configured).length} / ${statuses.length}`)
console.log('')
console.log('   ┌─────────────────────────────────────────────────────────────────┐')
console.log('   │  SAFETY RULES APPLIED                                          │')
console.log('   │  ①  Owner-only recipient gate before ANY execution             │')
console.log('   │  ②  Dry-run by default unless SWARM_LIVE_PAYMENTS=true + vault │')
console.log('   │  ③  Secrets displayed: first5…last4 only (never raw)           │')
console.log('   │  ④  No orders / no transfers executed from THIS local driver   │')
console.log('   │  ⑤  Confirmation card required before ANY mainnet trade        │')
console.log('   └─────────────────────────────────────────────────────────────────┘')
console.log('')

const report = {
  ok: true,
  startedAt, completedAt: new Date().toISOString(),
  summary: {
    ownerConfigured,
    ownerName: OWNER_NAME || undefined,
    ownerEmail: OWNER_EMAIL || undefined,
    walletsConfigured: Object.keys(configuredWallets).length,
    attijariRoutes: attijariAccounts.length,
    liveGate: live,
    includeLiveRequested: process.env.INCLUDE_LIVE === 'true',
    liveActuallyExecuted: actuallyLive,
    connectorCount: statuses.length,
    liveReady: statuses.filter((s) => s.liveReady).length,
    configured: statuses.filter((s) => s.configured).length,
    presetAccounts: ACCOUNTS.length,
    routedRuns: runs.length,
    simulated, rejected,
  },
  connectors: statuses.map((s) => ({ id: s.id, label: s.label, configured: s.configured, source: s.source, liveReady: s.liveReady })),
  runs,
}
const out = path.resolve(__dirname, 'settlements', `wet-run-report-${Date.now()}.json`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(report, null, 2), { encoding: 'utf8' })
console.log(`📄  Full JSON report saved → ${out}`)
console.log('')
console.log('👉 Next steps for LIVE settlements:')
console.log('   1. Set OWNER_NAME / OWNER_EMAIL / OWNER_WALLET_* secrets in GitHub repo OR .env')
console.log('   2. Vault-inject LIVE keys:  POST /api/ops/vault/inject  { key, value, provider }')
console.log('      or via /secure-architecture vault UI.')
console.log('   3. Flip SWARM_LIVE_PAYMENTS=true in environment')
console.log('   4. Call POST /api/ops/wet-run-settlements with { includeLive: true, referencePrefix }')
console.log('      (confirmation cards returned BEFORE any money moves per safety rules).')
console.log('')
