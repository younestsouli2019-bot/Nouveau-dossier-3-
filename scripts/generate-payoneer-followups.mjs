import fs from 'fs'
import path from 'path'
import crypto from 'node:crypto'

function readCsv(file) {
  const s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const lines = s.trim().split('\n')
  const headers = lines[0].split(',')
  const rows = lines.slice(1).map((l) => {
    const vals = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (inQ) {
        if (ch === '"') {
          if (l[i + 1] === '"') {
            cur += '"'
            i++
          } else {
            inQ = false
          }
        } else {
          cur += ch
        }
      } else {
        if (ch === ',') {
          vals.push(cur)
          cur = ''
        } else if (ch === '"') {
          inQ = true
        } else {
          cur += ch
        }
      }
    }
    vals.push(cur)
    const obj = {}
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = vals[i] ?? ''
    return obj
  })
  return { headers, rows }
}

function parseCsvLine(l) {
  const vals = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < l.length; i++) {
    const ch = l[i]
    if (inQ) {
      if (ch === '"') {
        if (l[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cur += ch
      }
    } else {
      if (ch === ',') {
        vals.push(cur)
        cur = ''
      } else if (ch === '"') {
        inQ = true
      } else {
        cur += ch
      }
    }
  }
  vals.push(cur)
  return vals
}

function readSpreadsheet(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.csv') return readCsv(file)
  const s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const cand =
    'recipient,recipient_email,recipient_name,amount,currency,batch_id,item_id,note,payer_name,payer_email,payer_company,purpose,reference,prq_link'
  const idx = s.indexOf(cand)
  if (idx < 0) return { headers: [], rows: [] }
  const tail = s.slice(idx).split('\n')
  const headers = tail[0].split(',')
  let rowLine = ''
  const m = s.slice(idx).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+,[^\r\n]+/)
  if (m) rowLine = m[0]
  if (!rowLine) return { headers, rows: [] }
  const vals = parseCsvLine(rowLine)
  const obj = {}
  for (let i = 0; i < headers.length; i++) obj[headers[i]] = vals[i] ?? ''
  return { headers, rows: [obj] }
}

function latestPospProof() {
  const dir = path.resolve('exports/posp-proofs')
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (!files.length) return null
  const abs = files.map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  try {
    return JSON.parse(fs.readFileSync(abs[0], 'utf8'))
  } catch {
    return null
  }
}

function buildEmail({ payerEmail, payerName, amount, currency, recipientName, purpose, reference, prqLink, batchId }) {
  const subject = `Payment Request ${amount} ${currency} — ${recipientName} (${batchId})`
  const posp = latestPospProof()
  const pospLine = posp ? `\nEvidence: PoSP score ${posp.score}, proof ${posp.proof_hash}` : ''
  const body =
    `Hello ${payerName || 'Billing'},\n\n` +
    `This is a reminder to fulfill the Payoneer payment request for ${amount} ${currency} to ${recipientName}.\n` +
    (purpose ? `Purpose: ${purpose}\n` : '') +
    (reference ? `Reference: ${reference}\n` : '') +
    (prqLink ? `Payoneer Request Link: ${prqLink}\n` : '') +
    `${pospLine}\n\n` +
    `If you require additional documentation or invoice details, reply to this message.\n` +
    `Thank you,\nOperations`
  return { to: payerEmail, subject, body }
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.includes('=') ? a.split('=') : [a, true]
    return [k.replace(/^--/, ''), v]
  }))
  const dirArg = args.dir || ''
  if (dirArg) {
    const dir = path.resolve(dirArg)
    if (!fs.existsSync(dir)) {
      process.stdout.write('missing_or_invalid_input_dir\n')
      process.exitCode = 2
      return
    }
    const files = fs.readdirSync(dir).filter((f) => {
      const n = f.toLowerCase()
      return n.endsWith('.csv') || n.endsWith('.xls') || n.endsWith('.xlsx')
    })
    const outDir = path.resolve('exports/communications')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    const created = []
    for (const f of files) {
      const abs = path.join(dir, f)
      try {
        const { rows } = readSpreadsheet(abs)
        if (!rows.length) continue
        const r = rows[0]
        const comm = buildEmail({
          payerEmail: r.payer_email,
          payerName: r.payer_name,
          amount: r.amount,
          currency: r.currency,
          recipientName: r.recipient_name,
          purpose: r.purpose,
          reference: r.reference,
          prqLink: r.prq_link,
          batchId: r.batch_id
        })
        const outFile = path.join(outDir, `payoneer_followup_${r.batch_id}_${Date.now()}.json`)
        const payload = {
          created_at: new Date().toISOString(),
          batch_id: r.batch_id,
          item_id: r.item_id,
          amount: r.amount,
          currency: r.currency,
          payer_email: r.payer_email,
          payer_name: r.payer_name,
          purpose: r.purpose,
          reference: r.reference,
          prq_link: r.prq_link,
          email: comm
        }
        fs.writeFileSync(outFile, JSON.stringify(payload, null, 2))
        created.push(outFile)
      } catch {}
    }
    process.stdout.write(`${JSON.stringify({ ok: true, count: created.length, files: created })}\n`)
    return
  }
  const input = args.file || args.path || ''
  if (!input || !fs.existsSync(input)) {
    process.stdout.write('missing_or_invalid_input_file\n')
    process.exitCode = 2
    return
  }
  const { rows } = readSpreadsheet(input)
  if (!rows.length) {
    process.stdout.write('empty_csv\n')
    process.exitCode = 3
    return
  }
  const r = rows[0]
  const comm = buildEmail({
    payerEmail: r.payer_email,
    payerName: r.payer_name,
    amount: r.amount,
    currency: r.currency,
    recipientName: r.recipient_name,
    purpose: r.purpose,
    reference: r.reference,
    prqLink: r.prq_link,
    batchId: r.batch_id
  })
  const outDir = path.resolve('exports/communications')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `payoneer_followup_${r.batch_id}_${Date.now()}.json`)
  const payload = {
    created_at: new Date().toISOString(),
    batch_id: r.batch_id,
    item_id: r.item_id,
    amount: r.amount,
    currency: r.currency,
    payer_email: r.payer_email,
    payer_name: r.payer_name,
    purpose: r.purpose,
    reference: r.reference,
    prq_link: r.prq_link,
    email: comm
  }
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2))
  process.stdout.write(`${outFile}\n`)
}

main()
