import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function buildPaypalMe(amount, note) {
  const forceMe = String(process.env.PAYPAL_FORCE_ME || '').toLowerCase() === 'true'
  const ncp = forceMe ? null : process.env.PAYPAL_NCP_PAYMENT_LINK
  if (ncp) return String(ncp)
  const handle = (process.env.PAYPAL_ME_HANDLE || '').replace(/^@/, '') || 'realworldcerts'
  const base = `https://paypal.me/${encodeURIComponent(handle)}/${encodeURIComponent(String(amount))}`
  const qs = note ? `?note=${encodeURIComponent(String(note))}` : ''
  return `${base}${qs}`
}

function main() {
  const amounts = (process.env.PAYPAL_ME_AMOUNTS || '25,40,85').split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
  const note = process.env.SETTLEMENT_NOTE || 'Support / Settlement'
  const ncp = process.env.PAYPAL_NCP_PAYMENT_LINK || null
  const links = amounts.map((a) => ({ amount: a, url: buildPaypalMe(a, note) }))
  const outDir = path.resolve('settlements/paypal')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const filePath = path.join(outDir, `paypalme_links_${Date.now()}.json`)
  const payload = ncp ? { note, ncp_url: ncp, links } : { note, links }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
  console.log(filePath)
}

main()
