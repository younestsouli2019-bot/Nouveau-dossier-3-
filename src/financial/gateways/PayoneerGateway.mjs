/**
 * PayoneerGateway (LIVE ONLY)
 *
 * Simulation removed. This gateway fails fast unless configured for LIVE
 * and real API integration is provided.
 */
export class PayoneerGateway {
  constructor({ provider = process.env.PAYONEER_PROVIDER } = {}) {
    this.provider = String(provider || '').toUpperCase()
  }

  ensureReady() {
    const live = String(process.env.SWARM_LIVE || 'false').toLowerCase() === 'true'
    const enabled = String(process.env.PAYONEER_ENABLE || 'false').toLowerCase() === 'true'
    if (!live) throw new Error('PayoneerGateway: SWARM_LIVE=true required')
    if (!enabled) throw new Error('PayoneerGateway: PAYONEER_ENABLE=true required')
    if (this.provider !== 'LIVE') {
      throw new Error('PayoneerGateway: Simulation disabled. Set PAYONEER_PROVIDER=LIVE or disable route')
    }
    // Provider credentials must be present for LIVE
    if (!process.env.PAYONEER_API_BASE || !process.env.PAYONEER_CLIENT_ID || !process.env.PAYONEER_CLIENT_SECRET) {
      throw new Error('PayoneerGateway: Missing API credentials (PAYONEER_API_BASE/CLIENT_ID/CLIENT_SECRET)')
    }
  }

  normalizeTransactions(transactions) {
    const list = Array.isArray(transactions) ? transactions : []
    if (!list.length) throw new Error('PayoneerGateway: No transactions provided')
    const currency = (list[0].currency || 'USD').toUpperCase()
    let total = 0
    for (const t of list) {
      const c = (t.currency || 'USD').toUpperCase()
      if (c !== currency) throw new Error(`PayoneerGateway: Mixed currencies not supported (${c} vs ${currency})`)
      const amt = Number(t.amount)
      if (!Number.isFinite(amt) || amt <= 0) continue
      total += amt
    }
    if (!(total > 0)) throw new Error('PayoneerGateway: Sum of amounts is zero')
    const reference = list[0]?.reference || `Payoneer payout ${new Date().toISOString().slice(0, 10)}`
    return { amount: Number(total.toFixed(2)), currency, reference }
  }

  async executeTransfer(transactions) {
    this.ensureReady()
    const { amount, currency, reference } = this.normalizeTransactions(transactions)
    // LIVE provider integration is not implemented in this repository.
    // Implement submit to Payoneer API and return provider references here.
    throw new Error('PayoneerGateway: LIVE provider integration not implemented. Disable route or integrate Payoneer.')
  }
}
