import fs from 'fs'
import path from 'path'
import 'dotenv/config'
import { buildBase44ServiceClient } from '../src/base44-client.mjs'
import { getEarningConfigFromEnv } from '../src/base44-earning.mjs'

function csvEscape(v) {
  const s = String(v ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

async function listEarnings(base44, cfg, { limit }) {
  const entity = base44.asServiceRole.entities[cfg.entityName]
  const rows = await entity.list('-created_date', limit, 0)
  return Array.isArray(rows) ? rows : []
}

function normalizeEarningRow(cfg, row) {
  const map = cfg.fieldMap
  return {
    id: row?.id ?? null,
    earning_id: row?.[map.earningId] ?? null,
    amount: Number(row?.[map.amount] ?? 0),
    currency: row?.[map.currency] ?? 'USD',
    occurred_at: row?.[map.occurredAt] ?? null,
    source: row?.[map.source] ?? null,
    beneficiary: row?.[map.beneficiary] ?? null,
    status: row?.[map.status] ?? null,
    settlement_id: row?.[map.settlementId] ?? null,
    metadata: row?.[map.metadata] ?? {}
  }
}

function buildXls({ headers, rows, sheetName = 'Payoneer' }) {
  const esc = (v) => String(v ?? '')
  const headerRow = headers.map((h) => `<Cell><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('')
  const dataRows = rows
    .map((r) => `<Row>${r.map((v) => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('')}</Row>`)
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

function buildPayoneerXls({ items, batchId, payer }) {
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
  const token = process.env.PAYONEER_PRQ_TOKEN || ''
  const prqLink = token ? `https://link.payoneer.com/Token?t=${String(token)}&src=prqLink` : ''
  const rows = []
  for (const it of items) {
    const recipient = process.env.OWNER_PAYONEER_EMAIL || process.env.PAYONEER_EMAIL || ''
    const recipientEmail = recipient && String(recipient).includes('@') ? recipient : ''
    const recipientName = process.env.SETTLEMENT_REQUESTOR_NAME || 'Owner'
    const note = process.env.SETTLEMENT_NOTE || batchId
    const itemId = `${batchId}-${it.earning_id || Math.floor(Math.random() * 1e9)}`
    const payerName = payer.name || process.env.SETTLEMENT_REQUESTOR_NAME || ''
    const payerEmail = payer.email || process.env.SETTLEMENT_REQUESTOR_EMAIL || ''
    const payerCompany = payer.company || process.env.SETTLEMENT_REQUESTOR_COMPANY || ''
    const purpose = payer.purpose || process.env.SETTLEMENT_PURPOSE || 'Service/Settlement'
    const reference = payer.reference || process.env.SETTLEMENT_REFERENCE || batchId
    rows.push([
      recipient,
      recipientEmail,
      recipientName,
      it.amount,
      it.currency,
      batchId,
      itemId,
      note,
      payerName,
      payerEmail,
      payerCompany,
      purpose,
      reference,
      prqLink
    ])
  }
  return buildXls({ headers, rows, sheetName: 'Payoneer' })
}

function inferPayerFromItems(items) {
  const firstMeta = items.find((it) => it.metadata && typeof it.metadata === 'object')?.metadata || {}
  return {
    name: firstMeta.payer_name || firstMeta.source_name || firstMeta.client_name || '',
    email: firstMeta.payer_email || firstMeta.client_email || '',
    company: firstMeta.payer_company || firstMeta.source_company || '',
    purpose: firstMeta.purpose || firstMeta.service || '',
    reference: firstMeta.reference || firstMeta.invoice || ''
  }
}

async function main() {
  const args = parseArgs(process.argv)
  let items = []
  let fromBase44 = true
  try {
    const base44 = buildBase44ServiceClient({ mode: 'auto' })
    const earningCfg = getEarningConfigFromEnv()
    const limit = Number(process.env.EARNING_LIST_LIMIT || '500') || 500
    const rows = await listEarnings(base44, earningCfg, { limit })
    items = rows.map((r) => normalizeEarningRow(earningCfg, r))
  } catch {
    const amt = Number(process.env.SETTLEMENT_AMOUNT_USD || '25') || 25
    items = [{ earning_id: `sim_${Date.now()}`, amount: amt, currency: 'USD', metadata: {} }]
    fromBase44 = false
  }

  const beneficiary = args.beneficiary || process.env.EARNING_BENEFICIARY || process.env.OWNER_PAYONEER_EMAIL || null
  if (beneficiary && fromBase44) items = items.filter((it) => String(it.beneficiary ?? '') === String(beneficiary))
  const status = args.status || process.env.EARNING_STATUS || 'settled_externally_pending'
  if (status && fromBase44) items = items.filter((it) => String(it.status ?? '') === String(status))

  const currency = args.currency || process.env.EARNING_CURRENCY || items[0]?.currency || 'USD'
  items = items.filter((it) => String(it.currency ?? '') === String(currency))
  if (!items.length) {
    const amt = Number(process.env.SETTLEMENT_AMOUNT_USD || '25') || 25
    items = [{ earning_id: `sim_${Date.now()}`, amount: amt, currency, metadata: {} }]
  }

  const maxUsd = Number(process.env.PAYONEER_DAILY_LIMIT || '1000') || 1000
  let total = 0
  const selected = []
  for (const it of items) {
    if (total + it.amount > maxUsd) break
    selected.push(it)
    total += it.amount
  }
  const batchId = `PAYO_${Date.now()}`
  const payer = inferPayerFromItems(selected)
  const xls = buildPayoneerXls({ items: selected, batchId, payer })
  const outDir = path.resolve('settlements/payoneer')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const targetPath = path.join(outDir, `payoneer_payout_${batchId}.xls`)
  fs.writeFileSync(targetPath, xls, 'utf8')
  const receiptDir = path.join(outDir, 'receipts')
  if (!fs.existsSync(receiptDir)) fs.mkdirSync(receiptDir, { recursive: true })
  const receipt = {
    batch_id: batchId,
    count: selected.length,
    amount_total_usd: Number(total.toFixed(2)),
    currency,
    xls_path: targetPath,
    payer,
    beneficiary,
    status: 'SUBMITTED_MANUAL',
    created_at: new Date().toISOString()
  }
  fs.writeFileSync(path.join(receiptDir, `payoneer_receipt_${batchId}.json`), JSON.stringify(receipt, null, 2))
  console.log(targetPath)
}

main()
