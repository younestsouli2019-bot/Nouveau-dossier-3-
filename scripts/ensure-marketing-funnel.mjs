import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function main() {
  const outDir = path.resolve('data/funnels')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const filePath = path.join(outDir, 'owner.json')
  const funnel = {
    id: 'owner_default',
    created_at: new Date().toISOString(),
    steps: [
      { name: 'Awareness', channel: 'content', status: 'active' },
      { name: 'Consideration', channel: 'landing', status: 'active' },
      { name: 'Checkout', channel: 'paypal_ncp', status: 'active', link: process.env.PAYPAL_NCP_PAYMENT_LINK || null },
      { name: 'Settlement', channel: 'autonomous', status: 'active', routes: ['payoneer','bank','crypto','paypal'] }
    ],
    settlement: {
      preferred: ['bank','payoneer','crypto','paypal'],
      owner_email: process.env.OWNER_PAYPAL_EMAIL || null,
      owner_payoneer: process.env.OWNER_PAYONEER_EMAIL || null
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(funnel, null, 2))
  console.log(filePath)
}

main()

