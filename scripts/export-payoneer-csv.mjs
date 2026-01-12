import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function csvEscape(v) {
  const s = String(v ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function nowBatchId() {
  return `PAYO_${Date.now()}`
}

function buildLines({ recipient, email, name, amount, currency, batchId, itemId, note, payerName, payerEmail, payerCompany, purpose, reference }) {
  const lines = []
  lines.push([
    'recipient',
    'recipient_email',
    'recipient_name',
    'amount',
    'currency',
    'batch_id',
    'item_id',
    'note',
    'payer_name',
    'payer_email',
    'payer_company',
    'purpose',
    'reference'
  ].map(csvEscape).join(','))
  lines.push([
    recipient,
    email,
    name,
    amount,
    currency,
    batchId,
    itemId,
    note,
    payerName,
    payerEmail,
    payerCompany,
    purpose,
    reference
  ].map(csvEscape).join(','))
  return `${lines.join('\n')}\n`
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.includes('=') ? a.split('=') : [a, true]
    return [k.replace(/^--/, ''), v]
  }))
  const recipient = args.recipient || process.env.OWNER_PAYONEER_EMAIL || process.env.PAYONEER_EMAIL || ''
  const name = args.recipient_name || process.env.BENEFICIARY_NAME_BC || process.env.BENEFICIARY_NAME_BARCLAYS || process.env.OWNER_NAME || ''
  const currency = args.currency || 'USD'
  const amountEnv = args.amount || process.env.SETTLEMENT_AMOUNT_USD || '1'
  const amount = String(amountEnv)
  const batchId = args.batch_id || process.env.PAYONEER_BATCH_ID || nowBatchId()
  const itemId = args.item_id || `${batchId}-ITEM-1`
  const note = args.note || process.env.SETTLEMENT_NOTE || batchId
  const payerName = args.payer_name || process.env.SETTLEMENT_REQUESTOR_NAME || process.env.OWNER_NAME || ''
  const payerEmail = args.payer_email || process.env.SETTLEMENT_REQUESTOR_EMAIL || process.env.OWNER_PAYPAL_EMAIL || ''
  const payerCompany = args.payer_company || process.env.SETTLEMENT_REQUESTOR_COMPANY || process.env.BENEFICIARY_NAME_BC || ''
  const purpose = args.purpose || process.env.SETTLEMENT_PURPOSE || 'Service/Settlement'
  const reference = args.reference || process.env.SETTLEMENT_REFERENCE || batchId
  const email = recipient && String(recipient).includes('@') ? recipient : ''
  const csv = buildLines({ recipient, email, name, amount, currency, batchId, itemId, note, payerName, payerEmail, payerCompany, purpose, reference })
  const outDir = path.resolve('settlements/payoneer')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const targetPath = path.join(outDir, `payoneer_payout_${batchId}.csv`)
  fs.writeFileSync(targetPath, csv, 'utf8')
  console.log(targetPath)
}

main()
