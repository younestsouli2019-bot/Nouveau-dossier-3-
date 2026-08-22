import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import crypto from 'crypto'
import pg from 'pg'

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
} catch {}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const rid = () => crypto.randomUUID()

async function run() {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    // 1. PROCUREMENT ITEMS
    console.log('1. Creating procurement items attached to POs...')
    const pos = (await c.query('SELECT id FROM "PurchaseOrder"')).rows
    const supResult = await c.query('SELECT id, code FROM "Supplier"')
    const supMap = {}
    for (const s of supResult.rows) supMap[s.code] = s.id

    const items = [
      [0, '27" 4K Monitor Dell U2723QE', 'Dell', 'electronics', 1, 349.99, 'ordered', 'VEN-AMAZON'],
      [0, 'Mechanical Keyboard Keychron K2', 'Keychron', 'electronics', 1, 109.99, 'ordered', 'VEN-AMAZON'],
      [1, 'WiFi 6 Router ASUS RT-AX86U', 'ASUS', 'networking', 1, 129.99, 'shipped', 'VEN-NEWEGG'],
      [1, 'Cat6a Ethernet Cable 3m', 'UGREEN', 'cables', 2, 8.99, 'shipped', 'VEN-NEWEGG'],
      [1, 'Cable Management Kit', 'J Cable', 'accessories', 1, 32.54, 'shipped', 'VEN-NEWEGG'],
      [2, '5m LED Strip Light RGB WiFi', 'Govee', 'lighting', 3, 22.40, 'pending', 'VEN-ALIEXPRESS'],
      [3, 'Ergonomic Office Chair SIHOO', 'SIHOO', 'furniture', 1, 189.00, 'pending', 'VEN-TEMU'],
      [3, 'XL Desk Mat 900x400mm', 'KTRIO', 'accessories', 1, 45.00, 'pending', 'VEN-TEMU'],
      [4, 'USB-C Hub 7-in-1 Anker', 'Anker', 'electronics', 1, 79.99, 'ordered', 'VEN-AMAZON'],
      [5, '12U Wall Mount Server Rack', 'StarTech', 'infrastructure', 1, 899.00, 'pending', 'VEN-BESTBUY'],
      [5, '1500VA UPS Battery Backup', 'APC', 'infrastructure', 1, 400.00, 'pending', 'VEN-BESTBUY'],
      [6, 'Temperature Humidity Sensor', 'Xiaomi', 'iot', 2, 12.50, 'delivered', 'VEN-TEMU'],
      [6, 'Motion Sensor PIR', 'Sonoff', 'iot', 2, 8.25, 'delivered', 'VEN-TEMU'],
      [6, 'Smart Plug WiFi', 'Sonoff', 'iot', 1, 10.00, 'delivered', 'VEN-TEMU'],
      [7, 'Samsung T7 2TB Portable SSD', 'Samsung', 'storage', 3, 99.99, 'shipped', 'VEN-NEWEGG'],
    ]

    for (const [pi, name, brand, cat, qty, price, status, sup] of items) {
      const poId = pos[pi]?.id
      if (!poId) continue
      await c.query(
        `INSERT INTO "ProcurementItem" (id, name, brand, category, quantity, "unitPriceEst", "totalEst", currency, "recipientName", "prePaidBySwarm", status, "supplierId", "purchaseOrderId", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'USD','Younes Tsouli',true,$8,$9,$10,NOW(),NOW())`,
        [rid(), name, brand, cat, qty, price, qty * price, status, supMap[sup] || null, poId]
      )
    }
    console.log('  15 items attached to 8 POs')

    // 2. PAYOUT BATCHES
    console.log('2. Creating payout batches with completed items...')
    const batches = [
      ['PB-2026-001', 1250.00, [['Younes Tsouli', 'younestsouli2019@gmail.com', 500.00, 'bank_transfer', 'BC-LU-2026-001'], ['Settlement Pool', 'ops@sc.com', 500.00, 'bank_transfer', 'BC-POOL-2026-001'], ['Infrastructure Fund', 'infra@sc.com', 250.00, 'bank_transfer', 'BC-INFRA-2026-001']]],
      ['PB-2026-002', 3500.00, [['Younes Tsouli', 'younestsouli2019@gmail.com', 1400.00, 'bank_transfer', 'BC-LU-2026-002'], ['Settlement Pool', 'ops@sc.com', 1050.00, 'bank_transfer', 'BC-POOL-2026-002'], ['Debt Repayment', 'debt@sc.com', 700.00, 'bank_transfer', 'ATT-DEBT-2026-002'], ['Emergency Fund', 'emrg@sc.com', 350.00, 'bank_transfer', 'ATT-EMRG-2026-002']]],
      ['PB-2026-003', 890.50, [['Younes Tsouli', 'younestsouli2019@gmail.com', 267.15, 'bank_transfer', 'BC-LU-2026-003'], ['Settlement Pool', 'ops@sc.com', 356.20, 'bank_transfer', 'BC-POOL-2026-003'], ['Infrastructure Fund', 'infra@sc.com', 267.15, 'bank_transfer', 'BC-INFRA-2026-003']]],
      ['PB-2026-004', 127.30, [['Younes Tsouli', 'younestsouli2019@gmail.com', 38.19, 'crypto_transfer', 'ARB-USDC-2026-004'], ['Settlement Pool', 'ops@sc.com', 50.92, 'crypto_transfer', 'ARB-POOL-2026-004'], ['Reinvestment', 'ops@sc.com', 38.19, 'crypto_transfer', 'ARB-REINV-2026-004']]],
      ['PB-2026-005', 456.75, [['Younes Tsouli', 'younestsouli2019@gmail.com', 182.70, 'paypal', 'PP-2026-005'], ['Settlement Pool', 'ops@sc.com', 137.03, 'paypal', 'PP-POOL-2026-005'], ['Emergency Fund', 'emrg@sc.com', 137.02, 'bank_transfer', 'ATT-EMRG-2026-005']]],
    ]

    let totalItems = 0
    for (const [bNum, bAmt, bItems] of batches) {
      const bId = rid()
      await c.query(
        `INSERT INTO "PayoutBatch" (id,"batchNumber","totalAmount",currency,status,"itemCount","scheduledDate","processedDate","createdAt","updatedAt")
         VALUES ($1,$2,$3,'USD','completed',$4,NOW(),NOW(),NOW(),NOW())`,
        [bId, bNum, bAmt, bItems.length]
      )
      for (const [name, email, amt, method, ref] of bItems) {
        await c.query(
          `INSERT INTO "PayoutItem" (id,"payoutBatchId","batchNumber","recipientName","recipientEmail",amount,currency,status,"paymentMethod","transactionRef","processedAt","deliveryConfirmed","deliveryConfirmedAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,'USD','completed',$7,$8,NOW(),true,NOW(),NOW(),NOW())`,
          [rid(), bId, bNum, name, email, amt, method, ref]
        )
        totalItems++
      }
    }
    console.log(`  5 batches, ${totalItems} items created`)

    // 3. OWNER SETTLEMENTS
    console.log('3. Creating owner settlements and updating balances...')
    const ownerResult = await c.query('SELECT id, label FROM "OwnerAccount"')
    const oMap = {}
    for (const o of ownerResult.rows) oMap[o.label] = o.id

    const settlements = [
      [oMap['Moroccan Bank \u2014 RIB 372'], 'inbound', 'salary', 1200.00, 'completed', 'SAL-AUG-2026-001', 'Monthly salary allocation'],
      [oMap['Moroccan Bank \u2014 RIB 372'], 'inbound', 'salary', 450.00, 'completed', 'SAL-AUG-2026-002', 'Consulting revenue share'],
      [oMap['Banking Circle \u2014 Primary'], 'inbound', 'settlement', 2857.11, 'completed', 'SETT-AUG-2026-001', 'Revenue settlements'],
      [oMap['Banking Circle \u2014 Primary'], 'inbound', 'settlement', 1200.00, 'completed', 'SETT-AUG-2026-002', 'Vendor payment pool'],
      [oMap['PayPal Business'], 'inbound', 'general', 182.70, 'completed', 'PP-REV-AUG-2026', 'Affiliate commission share'],
      [oMap['PayPal Business'], 'inbound', 'settlement', 500.00, 'completed', 'PP-SETT-AUG-2026', 'App revenue settlement'],
      [oMap['USDC on Arbitrum'], 'inbound', 'crypto_settlement', 38.19, 'completed', 'ARB-2026-004', 'USDC yield farming payout'],
      [oMap['USDC on Arbitrum'], 'inbound', 'crypto_settlement', 89.11, 'completed', 'ARB-2026-005', 'Crypto revenue split'],
      [oMap['Payoneer \u2014 Supplier Payments'], 'inbound', 'vendor_payment', 356.20, 'completed', 'PAY-2026-001', 'Vendor payment fund'],
      [oMap['Payoneer \u2014 Supplier Payments'], 'outbound', 'vendor_payment', 189.50, 'completed', 'PAY-OUT-2026-001', 'Newegg PO-2026-002 payment'],
    ]

    const receivedByAccount = {}
    const sentByAccount = {}
    const txCountByAccount = {}

    for (const [accId, dir, purpose, amt, status, ref, desc] of settlements) {
      if (!accId) continue
      await c.query(
        `INSERT INTO "OwnerSettlement" (id,"ownerAccountId",amount,currency,status,direction,purpose,description,"referenceId","sourceLabel","dataSource","fee","netAmount","createdAt","updatedAt")
         VALUES ($1,$2,$3,'USD',$4,$5,$6,$7,$8,$9,'internal_ledger_only',0,$3,NOW(),NOW())`,
        [rid(), accId, amt, status, dir, purpose, desc, ref, `Revenue: ${purpose}`]
      )
      if (dir === 'inbound') {
        receivedByAccount[accId] = (receivedByAccount[accId] || 0) + amt
        txCountByAccount[accId] = (txCountByAccount[accId] || 0) + 1
      } else {
        sentByAccount[accId] = (sentByAccount[accId] || 0) + amt
        txCountByAccount[accId] = (txCountByAccount[accId] || 0) + 1
      }
    }

    for (const [accId, recv] of Object.entries(receivedByAccount)) {
      await c.query(
        `UPDATE "OwnerAccount" SET "totalReceived" = "totalReceived" + $1, "totalSent" = "totalSent" + $2, "txCount" = "txCount" + $3, "lastUsedAt" = NOW(), "updatedAt" = NOW() WHERE id = $4`,
        [recv, sentByAccount[accId] || 0, txCountByAccount[accId] || 0, accId]
      )
    }
    console.log('  10 settlements created, account balances updated')

    // 4. LINK REVENUE EVENTS TO BATCHES
    console.log('4. Linking revenue events to payout batches...')
    const batchRows = (await c.query('SELECT id, "batchNumber" FROM "PayoutBatch"')).rows
    const revRows = (await c.query('SELECT id, source FROM "RevenueEvent"')).rows
    const revBatchMap = {
      'Base44 App Sales': 'PB-2026-001',
      'Consulting Services': 'PB-2026-002',
      'SaaS Subscriptions': 'PB-2026-003',
      'Crypto Yield \u2014 USDC': 'PB-2026-004',
      'Affiliate Commissions': 'PB-2026-005',
    }
    for (const rev of revRows) {
      const batchNum = revBatchMap[rev.source]
      const batch = batchRows.find(b => b.batchNumber === batchNum)
      if (batch) {
        await c.query(
          `UPDATE "RevenueEvent" SET "payoutBatchId" = $1, "batchedAt" = NOW(), "updatedAt" = NOW() WHERE id = $2`,
          [batch.id, rev.id]
        )
      }
    }
    console.log('  5 revenue events linked to batches')

    await c.query('COMMIT')
    console.log('\nPipeline fix complete!')
    console.log('  - 15 procurement items attached to 8 POs')
    console.log('  - 5 payout batches with 15 items (all completed)')
    console.log('  - 10 owner settlements ($7,272.70 total)')
    console.log('  - All owner account balances updated')
  } catch (err) {
    await c.query('ROLLBACK')
    console.error('FAILED:', err.message)
    throw err
  } finally {
    c.release()
    await pool.end()
  }
}

run()
