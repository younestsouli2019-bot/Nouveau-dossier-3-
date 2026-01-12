import fs from 'fs'
import path from 'path'
import 'dotenv/config'

function planEscalation({ startUsd = 1, steps = 6, factor = 2, maxUsd = 500, routes = ['payoneer','bank','crypto','paypal'] }) {
  const plan = []
  let amt = startUsd
  for (let i = 0; i < steps; i++) {
    for (const r of routes) {
      plan.push({ route: r, amount_usd: Math.min(amt, maxUsd) })
    }
    amt = Math.min(amt * factor, maxUsd)
  }
  return plan
}

function main() {
  const start = Number(process.env.SETTLEMENT_ESCALATION_START_USD || 1)
  const steps = Number(process.env.SETTLEMENT_ESCALATION_STEPS || 6)
  const factor = Number(process.env.SETTLEMENT_ESCALATION_FACTOR || 2)
  const max = Number(process.env.SETTLEMENT_ESCALATION_MAX_USD || 2000)
  const routes = (process.env.SETTLEMENT_ROUTES || 'payoneer,bank,crypto,paypal').split(',').map((s) => s.trim())
  const plan = planEscalation({ startUsd: start, steps, factor, maxUsd: max, routes })
  const outDir = path.resolve('settlements')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, 'escalation_plan.json')
  fs.writeFileSync(target, JSON.stringify({ plan, generated_at: new Date().toISOString() }, null, 2))
  console.log(target)
}

main()

