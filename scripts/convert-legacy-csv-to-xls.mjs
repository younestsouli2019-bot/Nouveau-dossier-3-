import fs from 'fs'
import path from 'path'
import 'dotenv/config'
import { parseArgs } from '../src/utils/cli.mjs'

function buildXls({ headers, rows, sheetName = 'Legacy' }) {
  const xmlEscape = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')

  const asCell = (v, headerName) => {
    const s = String(v ?? '').trim()
    const isAmount = headerName === 'amount'
    const isNumber = isAmount && s.length > 0 && /^-?\d+(\.\d+)?$/.test(s)
    const type = isNumber ? 'Number' : 'String'
    const val = isNumber ? Number(s) : s
    return `<Cell><Data ss:Type="${type}">${xmlEscape(val)}</Data></Cell>`
  }

  const headerRow = headers.map((h) => `<Cell><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join('')
  const dataRows = rows.map((r) => `<Row>${r.map((v, i) => asCell(v, headers[i])).join('')}</Row>`).join('')

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${xmlEscape(sheetName)}">
    <Table>
      <Row>${headerRow}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>\n`
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  const parseLine = (line) => {
    const out = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          const next = line[i + 1]
          if (next === '"') {
            field += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          field += ch
        }
        continue
      }
      if (ch === ',') {
        out.push(field)
        field = ''
        continue
      }
      if (ch === '"') {
        inQuotes = true
        continue
      }
      field += ch
    }
    out.push(field)
    return out
  }
  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

function normalizeAmount(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const cleaned = s.replace(/\s+/g, '').replace(/,/g, '.')
  const num = Number(cleaned)
  if (Number.isFinite(num)) return String(num)
  return s
}

function convertFile(csvPath, opts = {}) {
  const base = path.basename(csvPath).replace(/\.csv$/i, '')
  const sheet = opts.sheetName || (base.includes('bank') ? 'BankWire' : base.includes('payoneer') ? 'Payoneer' : 'Legacy')
  const data = fs.readFileSync(csvPath, 'utf8')
  const { headers, rows } = parseCsv(data)
  // augment uniformly where possible
  const wantsUniform = new Set([
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
    'prq_link',
    'bank_beneficiary_name',
    'bank_name',
    'bank_swift',
    'bank_account'
  ])
  const headerSet = new Set(headers.map((h) => String(h).trim()))
  const finalHeaders = Array.from(wantsUniform)
  const colIndex = Object.fromEntries(headers.map((h, i) => [String(h).trim(), i]))
  const token = process.env.PAYONEER_PRQ_TOKEN || ''
  const prqLink = token ? `https://link.payoneer.com/Token?t=${String(token)}&src=prqLink` : ''
  const payerEmailDefault =
    opts.payerEmail ||
    process.env.SETTLEMENT_REQUESTOR_EMAIL ||
    process.env.OWNER_PAYONEER_EMAIL ||
    process.env.OWNER_PAYPAL_EMAIL ||
    ''
  const payerNameDefault = opts.payerName || process.env.SETTLEMENT_REQUESTOR_NAME || ''
  const payerCompanyDefault = opts.payerCompany || process.env.SETTLEMENT_REQUESTOR_COMPANY || ''
  const purposeDefault = opts.purpose || process.env.SETTLEMENT_PURPOSE || ''
  const referenceDefault = opts.reference || process.env.SETTLEMENT_REFERENCE || ''
  const noteDefault = opts.note || process.env.SETTLEMENT_NOTE || ''
  const currencyDefault = opts.currency || process.env.SETTLEMENT_CURRENCY || 'USD'
  const filteredRows = rows.filter((r) => {
    const idxRecipient = colIndex['recipient']
    const idxAmount = colIndex['amount']
    const hasRecipient = idxRecipient != null && String(r[idxRecipient] || '').trim() !== ''
    const hasAmount = idxAmount != null && String(r[idxAmount] || '').trim() !== ''
    return hasRecipient || hasAmount
  })
  const finalRows = filteredRows.map((r) => {
    const get = (name) => {
      const idx = colIndex[name]
      return idx == null ? '' : r[idx]
    }
    return finalHeaders.map((h) => {
      if (!headerSet.has(h)) {
        if (h === 'recipient_email') return get('recipient')?.includes('@') ? get('recipient') : ''
        if (h === 'prq_link') return prqLink
        if (h === 'payer_email') return payerEmailDefault
        if (h === 'payer_name') return payerNameDefault
        if (h === 'payer_company') return payerCompanyDefault
        if (h === 'purpose') return purposeDefault
        if (h === 'reference') return referenceDefault
        if (h === 'note') return noteDefault
        if (h === 'currency') return currencyDefault
        return ''
      }
      if (h === 'amount') return normalizeAmount(get('amount'))
      return get(h)
    })
  })
  const xls = buildXls({ headers: finalHeaders, rows: finalRows, sheetName: sheet })
  const xlsPath = path.join(path.dirname(csvPath), `${base}.xls`)
  fs.writeFileSync(xlsPath, xls, 'utf8')
  return xlsPath
}

function main() {
  const args = parseArgs(process.argv)
  const targets = []
  const dirs = [
    args.dir ? path.resolve(args.dir) : path.resolve('settlements/payoneer'),
    args.dir ? path.resolve(args.dir) : path.resolve('settlements/bank_wires')
  ]
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) {
      if (f.toLowerCase().endsWith('.csv')) {
        targets.push(path.join(d, f))
      }
    }
  }
  const out = []
  for (const p of targets) {
    try {
      const x = convertFile(p, {
        sheetName: args.sheet || undefined,
        payerEmail: args['payer-email'] || undefined,
        payerName: args['payer-name'] || undefined,
        payerCompany: args['payer-company'] || undefined,
        purpose: args['purpose'] || undefined,
        reference: args['reference'] || undefined,
        note: args['note'] || undefined,
        currency: args['currency'] || undefined
      })
      out.push({ ok: true, csv: p, xls: x })
      console.log(x)
    } catch (e) {
      out.push({ ok: false, csv: p, error: e?.message || String(e) })
      console.error('FAILED', p, e?.message || e)
    }
  }
  if (out.length === 0) console.log('No legacy CSV files found.')
}

main()
