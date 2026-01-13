import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function buildXls({ headers, rows, sheetName = 'Payoneer' }) {
  const esc = (v) => String(v ?? '')
  const headerRow = headers.map((h) => `<Cell><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('')
  const dataRows = rows
    .map((r) => {
      return `<Row>${r
        .map((v) => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`)
        .join('')}</Row>`
    })
    .join('')
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${esc(sheetName)}">
    <Table>
      <Row>${headerRow}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>\n`
}

function buildCsv({ headers, rows }) {
  function q(v) {
    const s = String(v ?? '')
    const needs = s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
    if (!needs) return s
    return `"${s.replace(/"/g, '""')}"`
  }
  const lines = []
  lines.push(headers.map(q).join(','))
  for (const r of rows) lines.push(r.map(q).join(','))
  return `${lines.join('\n')}\n`
}

function nowBatchId() {
  return `PAYO_${Date.now()}`
}

function sanitize(v) {
  const s = String(v ?? '')
  const out = s.replace(/test/gi, '')
  return out.trim()
}

function buildRows({ recipient, email, name, amount, currency, batchId, itemId, note, payerName, payerEmail, payerCompany, purpose, reference, prqLink }) {
  const headers = [
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
    'reference',
    'prq_link'
  ]
  const row = [
    sanitize(recipient),
    sanitize(email),
    sanitize(name),
    amount,
    currency,
    batchId,
    itemId,
    sanitize(note),
    sanitize(payerName),
    sanitize(payerEmail),
    sanitize(payerCompany),
    sanitize(purpose),
    sanitize(reference),
    prqLink
  ]
  return { headers, rows: [row] }
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
  const payerName = args.payer_name || process.env.SETTLEMENT_REQUESTOR_NAME || ''
  const payerEmail = args.payer_email || process.env.SETTLEMENT_REQUESTOR_EMAIL || ''
  const payerCompany = args.payer_company || process.env.SETTLEMENT_REQUESTOR_COMPANY || ''
  const purpose = args.purpose || process.env.SETTLEMENT_PURPOSE || 'Service/Settlement'
  const reference = args.reference || process.env.SETTLEMENT_REFERENCE || batchId
  const email = recipient && String(recipient).includes('@') ? recipient : ''
  const token = args.prq_token || process.env.PAYONEER_PRQ_TOKEN || ''
  const prqLink = token ? `https://link.payoneer.com/Token?t=${String(token)}&src=prqLink` : ''

  if (!payerEmail || !String(payerEmail).includes('@')) {
    process.stderr.write('missing_payer_email\n')
    process.exit(2)
    return
  }

  const norm = (s) => String(s || '').trim().toLowerCase()
  if (norm(payerEmail) === norm(email) || norm(payerEmail) === norm(recipient)) {
    process.stderr.write('invalid_payer_email_same_as_recipient\n')
    process.exit(2)
    return
  }

  const fieldsToCheck = [note, payerName, payerEmail, payerCompany, purpose, reference, recipient, email, name]
  for (const f of fieldsToCheck) {
    if (String(f || '').toLowerCase().includes('test')) {
      process.stderr.write('invalid_field_contains_test\n')
      process.exit(3)
      return
    }
  }

  const { headers, rows } = buildRows({ recipient, email, name, amount, currency, batchId, itemId, note, payerName, payerEmail, payerCompany, purpose, reference, prqLink })
  const outDir = path.resolve('settlements/payoneer')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const preferCsv = args.csv !== undefined ? Boolean(args.csv) : true
  if (preferCsv) {
    const csv = buildCsv({ headers, rows })
    const targetPath = path.join(outDir, `payoneer_payout_${batchId}.csv`)
    fs.writeFileSync(targetPath, csv, 'utf8')
    console.log(targetPath)
    return
  }
  const xls = buildXls({ headers, rows, sheetName: 'Payoneer' })
  const targetPath = path.join(outDir, `payoneer_payout_${batchId}.xls`)
  fs.writeFileSync(targetPath, xls, 'utf8')
  console.log(targetPath)
}

main()
