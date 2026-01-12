import fs from 'fs'
import path from 'path'
import 'dotenv/config'
import { PayPalGateway } from '../src/financial/gateways/PayPalGateway.mjs'

function loadStore(filePath) {
  if (!fs.existsSync(filePath)) return { entities: {} }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return { entities: {} }
  }
}

function pickOwnerEarnings(store, { beneficiary, maxTotal = 200 }) {
  const recs = store?.entities?.Earning?.records || []
  const rows = recs.filter(r => String(r.beneficiary || '') === String(beneficiary))
  const out = []
  let total = 0
  for (const r of rows) {
    const amt = Number(r.amount || 0)
    if (!Number.isFinite(amt) || amt <= 0) continue
    if (total + amt > maxTotal) break
    out.push(r)
    total += amt
  }
  return out
}

async function main() {
  const storePath = process.env.BASE44_OFFLINE_STORE_PATH || '.autonomous-offline-store.json'
  const beneficiary = process.env.OWNER_PAYPAL_EMAIL || process.env.OWNER_PAYONEER_EMAIL
  const purpose = process.env.SETTLEMENT_PURPOSE || 'Service/Settlement'
  const gateway = new PayPalGateway()
  const store = loadStore(storePath)
  const picks = pickOwnerEarnings(store, { beneficiary, maxTotal: Number(process.env.PAYPAL_DAILY_LIMIT || '500') || 500 })
  if (picks.length === 0) {
    console.log('NO_EARNINGS')
    return
  }
  const tx = picks.map(r => ({
    amount: Number(r.amount || 0),
    currency: String(r.currency || 'USD'),
    destination: String(beneficiary),
    note: process.env.SETTLEMENT_NOTE || purpose
  }))
  const res = await gateway.createInvoices(tx)
  const outDir = path.resolve('settlements/paypal')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const filePath = path.join(outDir, `paypal_invoices_${Date.now()}.json`)
  fs.writeFileSync(filePath, JSON.stringify(res, null, 2))
  console.log(filePath)
}

main()

