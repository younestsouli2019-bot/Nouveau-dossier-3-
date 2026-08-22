/**
 * Seed REAL procurement data into Neon PostgreSQL.
 * 3 PurchaseOrders / 47 ProcurementItems - swarm pre-pays everything.
 * Run: node scripts/seed-real-procurement.mjs
 */

import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
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

const ADDR_YOUNES = 'Lot. Rita LOT C Im B, APT 17, BOUZNIKA, CASABLANCA SETTAT 13100, Maroc'
const ADDR_BACHIR = '45 Avenue Ibn Sina, Agdal, Rabat, Appt 4'
const ADDR_HIND = 'Etage 2 JASMIN II IMM H3 APPT 21, SIDI-YAHYA-ZAIR, 12150 Casablanca'

// [name, brand, reference, category, quantity, unitPriceEst, supplierName]
const YOUNES_ITEMS = [
  // Amazon US
  ['Dell Precision 3541 Laptop with 4TB', 'Dell', 'PREC-3541-4TB', 'it_equipment', 2, 850, 'Amazon US'],
  ['OnePlus 15 5G Android Smartphone', 'OnePlus', 'ONEPLUS-15-5G', 'electronics', 1, 750, 'Amazon US'],
  ['Mini PC and Monitor', null, null, 'it_equipment', 1, 320, 'Amazon US'],
  ['Opalescence Go Teeth Whitening', 'Opalescence', null, 'health', 1, 50, 'Amazon US'],
  ['Crest 3D Whitestrips Professional Effects', 'Crest', null, 'health', 1, 45, 'Amazon US'],
  ['Natural Alternatives to NAC Supplement', null, null, 'health', 1, 25, 'Amazon US'],
  // Amazon EU
  ['TV SAMSUNG UHD SMART 43"', 'SAMSUNG', 'UA43U8000FUXM', 'electronics', 1, 350, 'Amazon EU'],
  ['Kit Pause Café Gold', null, null, 'kitchen', 1, 170, 'Amazon EU'],
  ['BARRE DE SON SAMSUNG 2.0', 'SAMSUNG', 'HW-B400F/MV', 'electronics', 1, 130, 'Amazon EU'],
  ['Samsung Smart TV UHD 65"', 'SAMSUNG', null, 'electronics', 1, 125, 'Amazon EU'],
  ['Tablette CR 10.1" Android 16 2-en-1 GMS Tab', 'CR', null, 'electronics', 1, 120, 'Amazon EU'],
  ['Paco Rabanne Perfume', 'Paco Rabanne', null, 'beauty', 1, 85, 'Amazon EU'],
  ['Mont Blanc Legend Perfume', 'Mont Blanc', null, 'beauty', 1, 75, 'Amazon EU'],
  ['Mini-Bar ELEXIA RM004', 'ELEXIA', 'RM004', 'home', 1, 60, 'Amazon EU'],
  ['Stylish Cane', null, null, 'other', 1, 45, 'Amazon EU'],
  // Temu
  ['Wholesale Electronics Bulk Pack', null, null, 'wholesale_lot', 1, 200, 'Temu'],
  ['Diabetes Pack', null, null, 'health', 1, 45, 'Temu'],
  ['Plus Diabetes Pack', null, null, 'health', 1, 40, 'Temu'],
  ['Nitric Oxide Production Stimulator', null, null, 'health', 1, 35, 'Temu'],
  ['Cafe Pur Arabica 1KG Bali', null, null, 'food', 3, 8, 'Temu'],
  // AliExpress
  ['Security Cameras for Shop Pack', null, null, 'it_equipment', 1, 180, 'AliExpress'],
  ['Kricely Trail Shoes EU 49/US 13', 'Kricely', null, 'clothing', 2, 65, 'AliExpress'],
  ['Brandit M-65 Giant Jacket Olive 2XL', 'Brandit', null, 'clothing', 1, 90, 'AliExpress'],
  ['Mil-Tec US Tactical Flight Jacket Black 2XL', 'Mil-Tec', null, 'clothing', 1, 80, 'AliExpress'],
  ['Camera DVR TOTNG 1080P 170° Night Vision', 'TOTNG', 'TOTNG-DVR-1080', 'electronics', 1, 45, 'AliExpress'],
  ['Premium Orthopedic Slippers', null, null, 'clothing', 1, 40, 'AliExpress'],
  ['Nettoyeur Haute Pression Lightning', 'Lightning', null, 'home', 1, 35, 'AliExpress'],
  ['Camera Accessories Multiples Pack', null, null, 'accessories', 2, 15, 'AliExpress'],
  ['Brosse Électrique Rotative 5-en-1 USB', null, null, 'home', 1, 25, 'AliExpress'],
  // CTT Maroc
  ['Mini Téléphone Portable 2G Dual SIM', null, null, 'telecom', 1, 18, 'CTT Maroc'],
  ['Pack Légumes Frais Maroc + Fresh Fish 5Kg', null, null, 'food', 1, 25, 'CTT Maroc'],
  ['Winston Filter Soft', 'Winston', null, 'tobacco', 20, 0.30, 'CTT Maroc'],
  ['Panter Cafe Creme Original', 'Panter', null, 'tobacco', 5, 1.50, 'CTT Maroc'],
  ['Panter Mignon', 'Panter', null, 'tobacco', 5, 1.20, 'CTT Maroc'],
  ['Camel Yellow Soft Filters', 'Camel', null, 'tobacco', 5, 0.40, 'CTT Maroc'],
  // AliExpress (football stickers)
  ['Football Stickers 54 pcs Q Version', null, null, 'accessories', 1, 5, 'AliExpress'],
  ['Football Stickers 50 pcs Multi-color', null, null, 'accessories', 1, 5, 'AliExpress'],
]

const BACHIR_ITEMS = [
  ['Tablette CR 10.1" Android 16 2-en-1 GMS Tab', 'CR', null, 'electronics', 1, 120, 'Amazon EU'],
  ['Paco Rabanne Perfume', 'Paco Rabanne', null, 'beauty', 1, 85, 'Amazon EU'],
  ['Mont Blanc Legend Perfume', 'Mont Blanc', null, 'beauty', 1, 75, 'Amazon EU'],
  ['Stylish Cane', null, null, 'other', 1, 45, 'Amazon EU'],
  ['Premium Orthopedic Slippers', null, null, 'clothing', 1, 40, 'Amazon EU'],
]

const HIND_ITEMS = [
  ['TV SAMSUNG UHD SMART 43"', 'SAMSUNG', 'UA43U8000FUXM', 'electronics', 1, 350, 'Amazon EU'],
  ['BARRE DE SON SAMSUNG 2.0', 'SAMSUNG', 'HW-B400F/MV', 'electronics', 1, 130, 'Amazon EU'],
  ['Caméra DVR TOTNG 1080P 170° Night Vision', 'TOTNG', 'TOTNG-DVR-1080', 'electronics', 1, 45, 'Amazon EU'],
  ['Brosse Électrique Rotative 5-en-1 USB', null, null, 'home', 1, 25, 'Amazon EU'],
  ['Nettoyeur Haute Pression Lightning', 'Lightning', null, 'home', 1, 35, 'Amazon EU'],
]

const round2 = (n) => Math.round(n * 100) / 100

const PURCHASE_ORDERS = [
  { poNumber: 'PO-PROC-2026-001', recipientName: 'Younes Tsouli', address: ADDR_YOUNES, items: YOUNES_ITEMS },
  { poNumber: 'PO-PROC-2026-002', recipientName: 'M Bachir Tsouli', address: ADDR_BACHIR, items: BACHIR_ITEMS },
  { poNumber: 'PO-PROC-2026-003', recipientName: 'Mrs Hind Tsouli', address: ADDR_HIND, items: HIND_ITEMS },
]

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Clearing existing procurement data...')
    await client.query('DELETE FROM "ProcurementItem"')
    await client.query('DELETE FROM "PurchaseOrder"')

    let insertedItems = 0

    for (const po of PURCHASE_ORDERS) {
      const lines = po.items.map(([name, brand, reference, category, quantity, unitPriceEst, supplierName], idx) => ({
        id: randomUUID(),
        name,
        brand,
        reference,
        category,
        quantity,
        unitPriceEst,
        totalEst: round2(quantity * unitPriceEst),
        supplierName,
        poLineItem: idx + 1,
      }))

      const totalAmount = round2(lines.reduce((sum, l) => sum + l.totalEst, 0))
      const poId = randomUUID()

      await client.query(
        `INSERT INTO "PurchaseOrder"
           (id, "poNumber", title, "supplierName", status, priority, currency,
            "lineItemCount", "totalAmount", "orderedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'Multiple Suppliers', 'ordered', 'high', 'USD',
                 $4, $5, NOW(), NOW(), NOW())`,
        [poId, po.poNumber, `Procurement for ${po.recipientName}`, lines.length, totalAmount],
      )

      for (const l of lines) {
        await client.query(
          `INSERT INTO "ProcurementItem"
             (id, name, brand, reference, category, quantity,
              "unitPriceEst", "totalEst", currency,
              "recipientName", "recipientAddress", "deliveryAddress",
              "prePaidBySwarm", status, "supplierName",
              "purchaseOrderId", "poLineItem", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6,
                   $7, $8, 'USD',
                   $9, $10, $10,
                   true, 'ordered', $11,
                   $12, $13, NOW(), NOW())`,
          [l.id, l.name, l.brand, l.reference, l.category, l.quantity,
           l.unitPriceEst, l.totalEst,
           po.recipientName, po.address,
           l.supplierName,
           poId, l.poLineItem],
        )
        insertedItems++
      }

      console.log(`Inserted ${po.poNumber} (${po.recipientName}): ${lines.length} items, $${totalAmount.toFixed(2)}`)
    }

    await client.query('COMMIT')

    const poCount = await client.query('SELECT COUNT(*)::int AS n FROM "PurchaseOrder"')
    const itemCount = await client.query('SELECT COUNT(*)::int AS n FROM "ProcurementItem"')
    const perRecipient = await client.query(
      `SELECT "recipientName",
              COUNT(*)::int AS items,
              SUM("totalEst")::float AS total
         FROM "ProcurementItem"
        GROUP BY "recipientName"
        ORDER BY "recipientName"`,
    )
    const grandTotal = await client.query('SELECT SUM("totalEst")::float AS t FROM "ProcurementItem"')

    console.log('\n========== SEED SUMMARY ==========')
    console.log(`PurchaseOrders inserted : ${poCount.rows[0].n}`)
    console.log(`ProcurementItems seeded : ${itemCount.rows[0].n}`)
    console.log('----------------------------------')
    for (const row of perRecipient.rows) {
      console.log(`${row.recipientName.padEnd(18)} : ${row.items} items | $${row.total.toFixed(2)}`)
    }
    console.log('----------------------------------')
    console.log(`GRAND TOTAL             : $${grandTotal.rows[0].t.toFixed(2)} USD`)
    console.log('All items: prePaidBySwarm=true, status=ordered, currency=USD')
    console.log('==================================\n')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
