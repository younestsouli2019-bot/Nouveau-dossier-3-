// ─── Local driver: runs the same wet-run-settlements logic via direct ────
// connector-engine imports so we don't need to boot a Next.js server.
//
// Emits a compact report suitable for copy/pasting — plus a JSON file dump.
// ─────────────────────────────────────────────────────────────────────────
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  connectorStatus,
  executeTransfer,
  paymentsLive,
  runConnectionTests,
  CONNECTORS,
} from './project-source-2026-08-11 (17)/src/lib/connector-engine.ts'
import {
  tryGetOwnerEmail,
  tryGetOwnerName,
  getConfiguredWallets,
  getAttijariAccounts,
  isOwnerConfigured,
} from './project-source-2026-08-11 (17)/src/lib/owner-config.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Mirror the PRE-SET accounts list from owner-accounts/seed/route.ts ────
const ACCOUNTS = [
  // Bank wires
  { id: 'seed-attijari', label: 'Salary - Attijariwafa', accountType: 'bank_wire', purposes: 'salary', swiftCode: 'BCMAMAMC', bankName: 'Attijariwafa Bank', accountNumber: '007810000448200061321372', currency: 'MAD', paypalEmail: '', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '', paypalType: '' },
  { id: 'seed-bpop', label: 'Settlements - Banque Populaire', accountType: 'bank_wire', purposes: 'settlements,reconciliation', swiftCode: 'BPCEMCMC', bankName: 'Banque Populaire', accountNumber: '000410000448200061321372', currency: 'MAD', paypalEmail: '', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '', paypalType: '' },
  { id: 'seed-chase', label: 'USD Wire - Chase Bank', accountType: 'bank_wire', purposes: 'general,settlements', swiftCode: 'CHASUS33', bankName: 'JPMorgan Chase Bank', accountNumber: '0210000211234567', routingNumber: '021000021', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '', paypalType: '' },
  // L2 crypto
  { id: 'seed-arb', label: 'USDC - Arbitrum', accountType: 'l2_crypto', purposes: 'crypto_settlement,settlements', walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4E8A0', network: 'Arbitrum', preferredToken: 'USDC', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '', paypalType: '' },
  { id: 'seed-opt', label: 'USDT - Optimism', accountType: 'l2_crypto', purposes: 'crypto_settlement', walletAddress: '0x4200000000000000000000000000000000000006', network: 'Optimism', preferredToken: 'USDT', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '', paypalType: '' },
  { id: 'seed-base', label: 'ETH - Base', accountType: 'l2_crypto', purposes: 'crypto_settlement', walletAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', network: 'Base', preferredToken: 'ETH', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '', paypalType: '' },
  { id: 'seed-poly', label: 'USDC - Polygon', accountType: 'l2_crypto', purposes: 'crypto_settlement,settlements', walletAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', network: 'Polygon', preferredToken: 'USDC', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '', paypalType: '' },
  { id: 'seed-linea', label: 'WBTC - Linea', accountType: 'l2_crypto', purposes: 'crypto_settlement', walletAddress: '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5', network: 'Linea', preferredToken: 'WBTC', currency: 'USD', paypalEmail: '', wiseEmail: '', payoneerId: '', swiftCode: '', bankName: '', accountNumber: '', paypalType: '' },
  // PayPal / Wise
  { id: 'seed-pp', label: 'PayPal Business', accountType: 'paypal', purposes: 'settlements,general', paypalEmail: 'y.tsouli.business@gmail.com', paypalType: 'business', currency: 'USD', wiseEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '', swiftCode: '', bankName: '', accountNumber: '' },
  { id: 'seed-wise', label: 'Wise - EUR', accountType: 'wise', purposes: 'settlements,reconciliation', wiseEmail: 'younes@tsouli.com', currency: 'EUR', paypalEmail: '', payoneerId: '', walletAddress: '', network: '', preferredToken: '', swiftCode: '', bankName: '', accountNumber: '', paypalType: '' },
]

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
    case 'paypal': return { recipient: a.paypalEmail || tryGetOwnerEmail() || '', type: 'email' }
    case 'wise': return { recipient: a.wiseEmail || tryGetOwnerEmail() || '', type: 'email' }
    case 'payoneer': return { recipient: a.payoneerId || tryGetOwnerEmail() || '', type: 'email' }
    case 'l2_crypto': {
      const w = getConfiguredWallets()
      const net = (a.network || 'arbitrum').toLowerCase().replace(/ /g, '_')
      return { recipient: a.walletAddress || w[net] || Object.values(w)[0] || '', type: 'wallet' }
    }
    case 'bank_wire': {
      const att = getAttijariAccounts()
      if (att.length && (a.swiftCode || '').toUpperCase() === 'BCMAMAMC') return { recipient: att[0].rib.fullRib, type: 'rib' }
      return { recipient: a.accountNumber || '', type: 'rib' }
    }
    default: return null
  }
}

function amount(a) {
  const p = (a.purposes || '').toLowerCase()
  const cur = (a.currency || 'USD').toUpperCase()
  if (p.includes('salary')) return cur === 'MAD' ? 250 : cur === 'USD' ? 100 : 50
  if (p.includes('crypto')) return 10
  if (p.includes('settlement') || p.includes('reconcil')) return cur === 'MAD' ? 500 : cur === 'EUR' ? 20 : 50
  return cur === 'MAD' ? 100 : cur === 'EUR' ? 10 : 25
}

function purpose(a) {
  const p = (a.purposes || 'general').split(',')[0].trim()
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

function mask(type, value) {
  if (!value) return '••••'
  if (type === 'email') { const [l, d] = value.split('@'); if (!l || !d) return '••••'; return `${l.slice(0, Math.max(1, Math.floor(l.length / 3)))}••••@${d}` }
  if (type === 'wallet') { if (value.length <= 8) return '••••'; return `${value.slice(0, 6)}••••${value.slice(-4)}` }
  if (value.length <= 8) return '••••'; return `••••${value.slice(-4)}`
}

const startedAt = new Date().toISOString()
const live = paymentsLive()
const actuallyLive = live && process.env.INCLUDE_LIVE === 'true'

console.log('')
console.log('══════════════════════════════════════════════════════════')
console.log('  SWARM SETTLEMENTS WET-RUN DIAGNOSTIC  [local driver]')
console.log('══════════════════════════════════════════════════════════')
console.log('')
console.log(`Owner configured  : ${isOwnerConfigured() ? '✅  complete' : '⚠️  partial — set OWNER_NAME / OWNER_EMAIL secrets'}`)
console.log(`Owner name        : ${tryGetOwnerName() ?? '(unset)'}`)
console.log(`Owner email       : ${tryGetOwnerEmail() ?? '(unset)'}`)
console.log(`OWNER wallets     : ${Object.keys(getConfiguredWallets()).length} configured (${Object.keys(getConfiguredWallets()).join(', ') || 'none'})`)
console.log(`Attijari accounts : ${getAttijariAccounts().length}`)
console.log(`LIVE flag         : SWARM_LIVE_PAYMENTS=${process.env.SWARM_LIVE_PAYMENTS || '(unset)'}  → paymentsLive() = ${live}`)
console.log(`Live exec request : ${process.env.INCLUDE_LIVE === 'true' ? 'REQUESTED' : 'not requested (default dry-run)'} → actually LIVE = ${actuallyLive}`)
console.log(`Connector count   : ${CONNECTORS.length}`)
console.log('')

const statuses = connectorStatus()
console.log('─── Connector static status (no external calls) ───')
console.log('')
for (const s of statuses) {
  const mark = s.liveReady ? '🟢 LIVE READY' : s.configured ? '🟡 CONFIGURED (dry-run)' : '🔴 NOT CONFIGURED'
  const src = s.source ? ` (source=${s.source})` : ''
  console.log(`  ${mark}  ${s.id.padEnd(10)} ${s.label.padEnd(14)}  ${s.details}${src}`)
}
console.log('')

runConnectionTests().then(async (tests) => {
  console.log('─── Connection tests (dry-run + live API probes where vaulted) ───')
  console.log('')
  for (const t of tests) {
    const mark = t.connected ? (t.dryRun ? '🟡' : '🟢') : '🔴'
    console.log(`  ${mark}  ${t.id.padEnd(10)} ${t.label.padEnd(12)} latency=${t.latencyMs}ms  mode=${t.dryRun ? 'dry-run' : 'LIVE'}  ${t.connected ? 'connected' : 'not connected'} ${t.error ? ` — ${t.error}` : ''}`)
  }
  console.log('')

  const prefix = `WET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const runs = []
  let simulated = 0
  let rejected = 0
  let liveSubmitted = 0
  let liveFailed = 0

  for (const a of ACCOUNTS) {
    const connectors = routeConnectors(a)
    if (!connectors.length) continue
    const r = resolveRecipient(a)
    if (!r || !r.recipient) continue
    const amt = amount(a)
    for (let i = 0; i < connectors.length; i++) {
      const connector = connectors[i]
      const ref = `${prefix}-${a.id.slice(-6)}-${connector}-${i + 1}`
      const req = { connector, amount: amt, currency: (a.currency || 'USD').toUpperCase(), recipient: r.recipient, recipientType: r.type, reference: ref, purpose: purpose(a) }
      const dryRun = await executeTransfer(req)
      if (dryRun.status === 'SIMULATED') simulated++
      if (dryRun.status === 'REJECTED') rejected++
      let liveRun = undefined
      if (actuallyLive) {
        liveRun = await executeTransfer(req)
        if (liveRun.status === 'SUBMITTED') liveSubmitted++
        if (liveRun.status === 'FAILED') liveFailed++
      }
      const meta = CONNECTORS.find((c) => c.id === connector)
      const confirmCard = {
        asset: req.currency,
        amount: `${req.currency} ${Number(req.amount).toFixed(2)}`,
        direction: 'outbound → PRE-SET OWNER account',
        estimatedCost: dryRun.recipientOwner ? 'Owner-only routing — no fee' : 'N/A (recipient not owner — BLOCKED)',
        recipientMasked: mask(r.type, r.recipient),
        connector: meta?.label ?? connector,
        live: actuallyLive,
      }
      runs.push({ ownerAccountId: a.id, label: a.label, accountType: a.accountType, connectors, reference: ref, currency: req.currency, plannedAmount: req.amount, purpose: purpose(a), dryRun, liveRun, confirmCard })
      const statusMark = dryRun.status === 'SIMULATED' ? '🟡 SIMULATED' : dryRun.status === 'SUBMITTED' ? '🟢 SUBMITTED' : dryRun.status === 'REJECTED' ? '🔴 REJECTED' : '❓ ' + dryRun.status
      const liveMark = liveRun ? (liveRun.status === 'SUBMITTED' ? ' | 🔴 LIVE-SUBMITTED' : ` | LIVE-${liveRun.status}`) : ''
      console.log(`  ${statusMark}  ${a.label.padEnd(30)} via ${connector.padEnd(9)}  ${req.currency.padEnd(4)} ${String(req.amount).padStart(7)}  → ${confirmCard.recipientMasked}${liveMark}  [${ref}]`)
      if (dryRun.reason) console.log(`         reason: ${dryRun.reason}`)
    }
  }
  console.log('')
  console.log('─── Summary ───')
  console.log('')
  console.log(`  PRE-SET owner accounts routed : ${ACCOUNTS.length} in, ${new Set(runs.map((r) => r.ownerAccountId)).size} matched`)
  console.log(`  Total routed × connector runs : ${runs.length}`)
  console.log(`  Dry-run SIMULATED             : ${simulated} / ${runs.length}`)
  console.log(`  Dry-run REJECTED (non-owner)  : ${rejected}`)
  console.log(`  LIVE runs                     : ${actuallyLive ? `${liveSubmitted} SUBMITTED, ${liveFailed} FAILED` : '(dry-run only)'}`)
  console.log('')

  const report = {
    ok: true, startedAt, completedAt: new Date().toISOString(),
    summary: {
      ownerConfigured: isOwnerConfigured(),
      owner: { name: tryGetOwnerName(), email: tryGetOwnerEmail() },
      wallets: Object.keys(getConfiguredWallets()).length,
      attijariAccounts: getAttijariAccounts().length,
      liveFlag: live, includeLiveRequested: process.env.INCLUDE_LIVE === 'true', liveExecuted: actuallyLive,
      connectors: statuses.length,
      liveReady: statuses.filter((s) => s.liveReady).length,
      configured: statuses.filter((s) => s.configured).length,
      ownerAccounts: ACCOUNTS.length, routedRuns: runs.length,
      drySimulated: simulated, dryRejected: rejected, liveSubmitted, liveFailed,
    },
    connectors: statuses, connectionTests: tests, runs,
  }
  const outPath = path.resolve(__dirname, 'settlements', 'wet-run-report.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), { encoding: 'utf8' })
  console.log(`Full JSON report: ${outPath}`)
  console.log('')
})
