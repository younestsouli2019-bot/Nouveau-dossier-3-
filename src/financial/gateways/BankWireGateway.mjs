import crypto from 'node:crypto'

/**
 * BankWireGateway (LIVE ONLY)
 *
 * Simulation paths are removed. This gateway will NOT submit any payment unless
 * explicitly configured for LIVE provider and required env flags are set.
 * Use RouteManager failover or disable the route until a real provider is integrated.
 */
export class BankWireGateway {
  constructor({ provider = process.env.BANK_WIRE_PROVIDER } = {}) {
    this.provider = String(provider || '').toUpperCase()
  }

  computeBeneficiaryFingerprint({ name, iban, swift }) {
    const norm = `${String(name || '').trim()}|${String(iban || '').replace(/\s+/g, '').toUpperCase()}|${String(swift || '').trim().toUpperCase()}`
    return crypto.createHash('sha256').update(norm).digest('hex')
  }

  ensureReady() {
    const live = String(process.env.SWARM_LIVE || 'false').toLowerCase() === 'true'
    const enabled = String(process.env.BANK_WIRE_ENABLE || 'false').toLowerCase() === 'true'
    if (!live) throw new Error('BankWireGateway: SWARM_LIVE=true required')
    if (!enabled) throw new Error('BankWireGateway: BANK_WIRE_ENABLE=true required')

    if (this.provider !== 'LIVE') {
      throw new Error('BankWireGateway: Simulation disabled. Set BANK_WIRE_PROVIDER=LIVE or disable route')
    }

    const owner = {
      name: process.env.OWNER_BENEFICIARY_NAME,
      iban: process.env.OWNER_IBAN,
      swift: process.env.OWNER_SWIFT,
      bankName: process.env.OWNER_BANK_NAME,
      bankCountry: process.env.OWNER_BANK_COUNTRY || undefined
    }
    if (!owner.name || !owner.iban || !owner.swift) {
      throw new Error('BankWireGateway: Missing owner bank details (OWNER_BENEFICIARY_NAME/OWNER_IBAN/OWNER_SWIFT)')
    }
    const fp = this.computeBeneficiaryFingerprint(owner)
    const allowJson = process.env.OWNER_BENEFICIARY_ALLOWLIST_JSON || '[]'
    let allow = []
    try { allow = JSON.parse(allowJson) } catch { allow = [] }
    const allowed = Array.isArray(allow) && allow.map(String).includes(fp)
    if (!allowed) throw new Error('BankWireGateway: Owner beneficiary not allowlisted (OWNER_BENEFICIARY_ALLOWLIST_JSON)')

    // Provider-specific integration required here. Fail fast until implemented.
    return { owner }
  }

  normalizeTransactions(transactions) {
    const list = Array.isArray(transactions) ? transactions : []
    if (list.length === 0) throw new Error('BankWireGateway: No transactions provided')
    const currency = (list[0].currency || 'USD').toUpperCase()
    let total = 0
    for (const t of list) {
      const c = (t.currency || 'USD').toUpperCase()
      if (c !== currency) throw new Error(`BankWireGateway: Mixed currencies not supported (${c} vs ${currency})`)
      const amt = Number(t.amount)
      if (!Number.isFinite(amt) || amt <= 0) continue
      total += amt
    }
    if (!(total > 0)) throw new Error('BankWireGateway: Sum of amounts is zero')
    const reference = list[0]?.reference || `Owner wire ${new Date().toISOString().slice(0, 10)}`
    return { amount: Number(total.toFixed(2)), currency, reference }
  }

  async executeTransfer(transactions) {
    const { owner } = this.ensureReady()
    const { amount, currency, reference } = this.normalizeTransactions(transactions)

    // LIVE provider integration not implemented here by design.
    // To enable, implement submit to your bank API and return provider refs.
    throw new Error('BankWireGateway: LIVE provider integration not implemented. Disable route or integrate real provider.')
  }
}
