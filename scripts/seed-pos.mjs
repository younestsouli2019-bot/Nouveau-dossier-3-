/**
 * Seed Purchase Orders + Funding Data into Neon PostgreSQL
 * Run: node scripts/seed-pos.mjs
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = join(__dirname, '..')

try {
  const envFile = readFileSync(join(root, '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* no .env */ }

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Upsert Suppliers
    const suppliers = [
      { code: 'VEN-TEMU', name: 'Temu', website: 'https://temu.com', country: 'CN', contactEmail: 'supplier@temu.com', paymentTerms: 'prepaid' },
      { code: 'VEN-AMAZON', name: 'Amazon', website: 'https://amazon.com', country: 'US', contactEmail: 'supplier@amazon.com', paymentTerms: 'prepaid' },
      { code: 'VEN-ALIEXPRESS', name: 'AliExpress', website: 'https://aliexpress.com', country: 'CN', contactEmail: 'supplier@aliexpress.com', paymentTerms: 'prepaid' },
      { code: 'VEN-BESTBUY', name: 'Best Buy', website: 'https://bestbuy.com', country: 'US', contactEmail: 'supplier@bestbuy.com', paymentTerms: 'net15' },
      { code: 'VEN-NEWEGG', name: 'Newegg', website: 'https://newegg.com', country: 'US', contactEmail: 'supplier@newegg.com', paymentTerms: 'prepaid' },
    ]

    const supplierIds = {}
    for (const s of suppliers) {
      const result = await client.query(
        `INSERT INTO "Supplier" (id, code, name, website, country, "contactEmail", "paymentTerms", "isActive", "totalOrders", "totalSpend", "deliveredOnTime", "totalDelivered", "itemsWithDefect", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 0, 0, 0, 0, 0, NOW(), NOW())
         ON CONFLICT (code) DO UPDATE SET name = $3
         RETURNING id`,
        [crypto.randomUUID(), s.code, s.name, s.website, s.country, s.contactEmail, s.paymentTerms]
      )
      supplierIds[s.code] = result.rows[0].id
    }
    console.log(`Upserted ${suppliers.length} suppliers`)

    // 2. Create Purchase Orders
    const pos = [
      { poNumber: 'PO-2026-001', title: 'Office Equipment — Monitor + Keyboard', supplierCode: 'VEN-AMAZON', priority: 'high', status: 'approved', totalAmount: 459.99, lineItemCount: 2, notes: 'Primary workstation setup' },
      { poNumber: 'PO-2026-002', title: 'Networking Gear — Router + Cables', supplierCode: 'VEN-NEWEGG', priority: 'normal', status: 'ordered', totalAmount: 189.50, lineItemCount: 3, notes: 'Office network upgrade' },
      { poNumber: 'PO-2026-003', title: 'Bulk LED Strip Lights', supplierCode: 'VEN-ALIEXPRESS', priority: 'low', status: 'submitted', totalAmount: 67.20, lineItemCount: 1, notes: 'Decoration batch' },
      { poNumber: 'PO-2026-004', title: 'Ergonomic Chair + Desk Mat', supplierCode: 'VEN-TEMU', priority: 'high', status: 'pending_approval', totalAmount: 234.00, lineItemCount: 2, notes: 'Workspace ergonomics' },
      { poNumber: 'PO-2026-005', title: 'USB-C Hub + Adapter Pack', supplierCode: 'VEN-AMAZON', priority: 'normal', status: 'approved', totalAmount: 79.99, lineItemCount: 1, notes: 'Laptop accessories' },
      { poNumber: 'PO-2026-006', title: 'Server Rack + UPS', supplierCode: 'VEN-BESTBUY', priority: 'high', status: 'draft', totalAmount: 1299.00, lineItemCount: 2, notes: 'Infrastructure — server room setup' },
      { poNumber: 'PO-2026-007', title: 'Smart Home Sensors Pack', supplierCode: 'VEN-TEMU', priority: 'normal', status: 'completed', totalAmount: 42.50, lineItemCount: 5, notes: 'IoT sensors for monitoring' },
      { poNumber: 'PO-2026-008', title: 'External SSD 2TB x3', supplierCode: 'VEN-NEWEGG', priority: 'normal', status: 'ordered', totalAmount: 299.97, lineItemCount: 3, notes: 'Backup storage' },
    ]

    for (const po of pos) {
      await client.query(
        `INSERT INTO "PurchaseOrder" (id, "poNumber", title, "supplierId", "supplierName", status, priority, currency, "lineItemCount", "totalAmount", notes, "ackStatus", "slaHours", "slaBreached", "escalationCount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD', $8, $9, $10, 'AWAITING_ACK', 48, false, 0, NOW(), NOW())
         ON CONFLICT ("poNumber") DO UPDATE SET "totalAmount" = $9, status = $6`,
        [crypto.randomUUID(), po.poNumber, po.title, supplierIds[po.supplierCode], po.poNumber.split('-')[3] ? po.poNumber : 'Unknown', po.status, po.priority, po.lineItemCount, po.totalAmount, po.notes]
      )
    }
    console.log(`Created ${pos.length} purchase orders`)

    // 3. Create Funding / OwnerAccounts
    const accounts = [
      { label: 'Banking Circle — Primary', accountType: 'bank_wire', isPrimary: true, currency: 'USD', accountHolder: 'Younes Tsouli', accountNumberLast: '646', bankName: 'Banking Circle S.A.', swiftCode: 'BCIRLULL', countryCode: 'LU', purposes: 'settlements,vendor_payments' },
      { label: 'PayPal Business', accountType: 'paypal', currency: 'USD', paypalEmail: 'younestsouli2019@gmail.com', paypalType: 'business', paypalCountry: 'MA', purposes: 'general,settlements' },
      { label: 'USDC on Arbitrum', accountType: 'l2_crypto', currency: 'USD', network: 'Arbitrum', walletAddress: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7', walletAddressShort: '0xA462...Efe7', preferredToken: 'USDC', chainId: 42161, purposes: 'crypto_settlement,general' },
      { label: 'Payoneer — Supplier Payments', accountType: 'payoneer', currency: 'USD', payoneerId: 'younestsouli2019@gmail.com', purposes: 'vendor_payments' },
      { label: 'Moroccan Bank — RIB 372', accountType: 'bank_wire', currency: 'MAD', accountHolder: 'Younes Tsouli', accountNumberLast: '372', bankName: 'Attijariwafa Bank', countryCode: 'MA', purposes: 'salary,general' },
    ]

    for (const a of accounts) {
      await client.query(
        `INSERT INTO "OwnerAccount" (id, label, "accountType", "isActive", "isPrimary", "sortOrder", purposes, "accountHolder", "accountNumberLast", "bankName", "swiftCode", "countryCode", currency, network, "walletAddress", "walletAddressShort", "preferredToken", "chainId", "paypalEmail", "paypalType", "paypalCountry", "payoneerId", notes, "totalReceived", "totalSent", "txCount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 0, 0, 0, NOW(), NOW())`,
        [crypto.randomUUID(), a.label, a.accountType, a.isPrimary || false, 0, a.purposes, a.accountHolder || null, a.accountNumberLast || null, a.bankName || null, a.swiftCode || null, a.countryCode || null, a.currency, a.network || null, a.walletAddress || null, a.walletAddressShort || null, a.preferredToken || null, a.chainId || null, a.paypalEmail || null, a.paypalType || null, a.paypalCountry || null, a.payoneerId || null, null]
      )
    }
    console.log(`Created ${accounts.length} owner accounts`)

    // 4. Create OwnerPaymentConfigs (salary split, etc.)
    const configs = [
      { label: 'Salary', splitPercentage: 40, bankName: 'Attijariwafa Bank', ribNumber: '007810000448500030594182', swiftCode: 'BCIRLULL', notes: 'Monthly salary allocation — 40%' },
      { label: 'Settlements', splitPercentage: 30, bankName: 'Banking Circle', ribNumber: 'LU774080000041265646', swiftCode: 'BCIRLULL', notes: 'Revenue settlements — 30%' },
      { label: 'Infrastructure', splitPercentage: 20, notes: 'Server, APIs, hosting costs — 20%' },
      { label: 'Emergency', splitPercentage: 10, notes: 'Emergency fund reserve — 10%' },
    ]

    for (const c of configs) {
      await client.query(
        `INSERT INTO "OwnerPaymentConfig" (id, label, "splitPercentage", "ribLabel", "ribNumber", "swiftCode", "bankName", "isActive", "routingFixed", notes, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, $8, NOW(), NOW())
         ON CONFLICT (label) DO UPDATE SET "splitPercentage" = $3`,
        [crypto.randomUUID(), c.label, c.splitPercentage, c.label, c.ribNumber || null, c.swiftCode || null, c.bankName || null, c.notes]
      )
    }
    console.log(`Created ${configs.length} payment configs`)

    // 5. Seed Revenue Events
    const revenues = [
      { source: 'Base44 App Sales', amount: 1250.00, status: 'completed', description: 'Monthly app revenue', proofType: 'api_receipt' },
      { source: 'Consulting Services', amount: 3500.00, status: 'completed', description: 'Supply chain consulting Q1', proofType: 'manual_attestation' },
      { source: 'SaaS Subscriptions', amount: 890.50, status: 'completed', description: 'Platform subscriptions', proofType: 'api_receipt' },
      { source: 'Crypto Yield — USDC', amount: 127.30, status: 'completed', description: 'Arbitrum USDC yield farming', proofType: 'onchain_tx_hash' },
      { source: 'Affiliate Commissions', amount: 456.75, status: 'pending', description: 'Affiliate program payouts', proofType: 'api_receipt' },
    ]

    for (const r of revenues) {
      const proofHash = r.proofType === 'onchain_tx_hash'
        ? '0x' + Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
        : null
      await client.query(
        `INSERT INTO "RevenueEvent" (id, source, amount, currency, status, description, "referenceId", "proofHash", "proofType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'USD', $4, $5, $6, $7, $8, NOW(), NOW())`,
        [crypto.randomUUID(), r.source, r.amount, r.status, r.description, `REF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, proofHash, r.proofType]
      )
    }
    console.log(`Seeded ${revenues.length} revenue events`)

    // 6. Create the 4 Treasury FundBuckets (idempotent upsert)
    const buckets = [
      { code: 'sovereign_reserves', label: 'Sovereign Reserves', pct: 30, note: 'Long-term capital reserves / contingency fund' },
      { code: 'procurement_buffer', label: 'Owner Procurement Buffer', pct: 10, note: 'Funds reserved to pay owner-directed purchase orders' },
      { code: 'runtime_operations', label: 'Runtime Operations', pct: 20, note: 'Swarm infrastructure allocation' },
      { code: 'salary_bucket', label: 'Owner Salary Bucket', pct: 40, note: 'Monthly owner salary allocation' },
    ]
    for (const b of buckets) {
      await client.query(
        `INSERT INTO "FundBucket" (code, label, "percentagePct", balance, allocated, released, note, "updatedAt")
         VALUES ($1, $2, $3, 0, 0, 0, $4, NOW())
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, "percentagePct" = EXCLUDED."percentagePct", note = EXCLUDED.note`,
        [b.code, b.label, b.pct, b.note]
      )
    }
    console.log(`Created ${buckets.length} treasury buckets`)

    // 7. Create default PayoutRoutingRule → splits NET into treasury buckets.
    //    This is the rule settleAndPayout() resolves; without it the engine
    //    previously produced 0 splits.
    const defaultSplits = JSON.stringify([
      { bucketCode: 'sovereign_reserves', pct: 30 },
      { bucketCode: 'procurement_buffer', pct: 10 },
      { bucketCode: 'runtime_operations', pct: 20 },
      { bucketCode: 'salary_bucket', pct: 40 },
    ])
    await client.query(
      `INSERT INTO "PayoutRoutingRule" (id, name, "sourceType", "sourceFilter", "destinationSplits", "platformFeePct", "totalPct", priority, "cooldownMs", "isActive", "triggerCount", "lastTriggeredAt", "createdAt", "updatedAt")
       VALUES ($1, $2, 'any', NULL, $3::jsonb, 0, 100, 100, 0, true, 0, NULL, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [crypto.randomUUID(), 'Default Treasury Bucket Split (40/30/20/10)', defaultSplits]
    )
    console.log('Created default payout routing rule (treasury bucket split)')

    await client.query('COMMIT')
    console.log('✅ Seed complete!')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('❌ Seed failed:', err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
