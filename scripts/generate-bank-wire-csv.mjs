import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function loadStore(filePath) {
  if (!fs.existsSync(filePath)) return { entities: {} }
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return { entities: {} } }
}

function csvEscape(value) {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toBankCsv(items, bank) {
  const header = ['earning_id','amount','currency','beneficiary','reference','bank_beneficiary_name','bank_name','bank_iban','bank_rib','bank_swift','bank_account','bank_country','bank_city','occurred_at','status','settlement_id']
  const lines = [header.join(',')]
  for (const it of items) {
    lines.push([
      csvEscape(it.earning_id),
      csvEscape(it.amount),
      csvEscape(it.currency),
      csvEscape(it.beneficiary),
      csvEscape(bank.reference || ''),
      csvEscape(bank.beneficiaryName || ''),
      csvEscape(bank.bankName || ''),
      csvEscape(bank.iban || ''),
      csvEscape(bank.rib || ''),
      csvEscape(bank.swift || ''),
      csvEscape(bank.account || ''),
      csvEscape(bank.country || ''),
      csvEscape(bank.city || ''),
      csvEscape(it.occurred_at),
      csvEscape(it.status),
      csvEscape(it.settlement_id || '')
    ].join(','))
  }
  return `${lines.join('\n')}\n`
}

function main() {
  const storePath = process.env.BASE44_OFFLINE_STORE_PATH || '.autonomous-offline-store.json'
  const beneficiary = process.env.OWNER_PAYONEER_EMAIL || process.env.OWNER_PAYPAL_EMAIL
  const store = loadStore(storePath)
  const rows = store?.entities?.Earning?.records || []
  const items = rows.filter(r => String(r.beneficiary || '') === String(beneficiary))
  const bank = {
    beneficiaryName: process.env.BANK_BENEFICIARY_NAME || 'Owner',
    bankName: process.env.BANK_NAME || 'Barclays',
    iban: process.env.BANK_IBAN || '',
    rib: process.env.BANK_RIB || '',
    swift: process.env.BANK_SWIFT || '',
    account: process.env.BANK_ACCOUNT || '',
    country: process.env.BANK_COUNTRY || 'GB',
    city: process.env.BANK_CITY || 'London',
    reference: process.env.SETTLEMENT_REFERENCE || ''
  }
  const csv = toBankCsv(items, bank)
  const outDir = path.resolve('settlements/bank_wires')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const filePath = path.join(outDir, `owner_bank_wire_${Date.now()}.csv`)
  fs.writeFileSync(filePath, csv, 'utf8')
  console.log(filePath)
}

main()

