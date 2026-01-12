import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function nowIso() {
  return new Date().toISOString()
}

function makeEarning({ earning_id, amount, currency, occurred_at, source, beneficiary, status, settlement_id, metadata }) {
  return {
    id: `offline_Earning_${earning_id}`,
    created_date: nowIso(),
    updated_date: nowIso(),
    earning_id,
    amount,
    currency,
    occurred_at,
    source,
    beneficiary,
    status,
    settlement_id,
    metadata
  }
}

function main() {
  const outPath = process.env.BASE44_OFFLINE_STORE_PATH || '.autonomous-offline-store.json'
  const beneficiary = process.env.OWNER_PAYONEER_EMAIL || process.env.EARNING_BENEFICIARY || 'owner@example.com'
  const currency = process.env.BASE44_DEFAULT_CURRENCY || 'USD'
  const payerName = process.env.SETTLEMENT_REQUESTOR_NAME || 'Owner'
  const payerEmail = process.env.SETTLEMENT_REQUESTOR_EMAIL || ''
  const payerCompany = process.env.SETTLEMENT_REQUESTOR_COMPANY || ''
  const purpose = process.env.SETTLEMENT_PURPOSE || 'Service/Settlement'
  const reference = process.env.SETTLEMENT_REFERENCE || 'INV-TEST'

  const items = [
    makeEarning({
      earning_id: `REV_${Date.now() - 60000}`,
      amount: 25,
      currency,
      occurred_at: nowIso(),
      source: 'swarm_revenue',
      beneficiary,
      status: 'settled_externally_pending',
      settlement_id: null,
      metadata: { payer_name: payerName, payer_email: payerEmail, payer_company: payerCompany, purpose, reference }
    }),
    makeEarning({
      earning_id: `REV_${Date.now() - 30000}`,
      amount: 40,
      currency,
      occurred_at: nowIso(),
      source: 'swarm_revenue',
      beneficiary,
      status: 'settled_externally_pending',
      settlement_id: null,
      metadata: { payer_name: payerName, payer_email: payerEmail, payer_company: payerCompany, purpose, reference }
    }),
    makeEarning({
      earning_id: `REV_${Date.now()}`,
      amount: 85,
      currency,
      occurred_at: nowIso(),
      source: 'swarm_revenue',
      beneficiary,
      status: 'settled_externally_pending',
      settlement_id: null,
      metadata: { payer_name: payerName, payer_email: payerEmail, payer_company: payerCompany, purpose, reference }
    })
  ]

  let store = {}
  if (fs.existsSync(outPath)) {
    try {
      store = JSON.parse(fs.readFileSync(outPath, 'utf8'))
    } catch {
      store = {}
    }
  }
  if (!store.entities) store.entities = {}
  if (!store.entities.Earning) store.entities.Earning = { records: [] }
  if (!Array.isArray(store.entities.Earning.records)) store.entities.Earning.records = []

  // Append new earnings, dedupe by earning_id
  const existing = new Set(store.entities.Earning.records.map(r => String(r.earning_id)))
  for (const it of items) {
    if (!existing.has(String(it.earning_id))) {
      store.entities.Earning.records.push(it)
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(store, null, 2))
  console.log(outPath)
}

main()

