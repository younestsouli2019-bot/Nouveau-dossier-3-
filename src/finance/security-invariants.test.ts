import { describe, it, expect } from 'vitest'
import {
  evaluateFinancialAction,
  createReceiptContext,
  FORBIDDEN_RECEIVE_PREREQUISITES,
} from './FinancialPolicyFirewall.mjs'
import {
  assertReceiptStateValid,
  nextReceiptState,
  initialReceiptState,
  FORBIDDEN_RECEIPT_STATES,
  ReceiptStateViolation,
} from '../crypto/IncomingReceiptStateMachine.mjs'
import { ReplenishmentProtocol } from './ReplenishmentProtocol.mjs'
import {
  FinancialGuardian,
  SIMPLE_TRUST_STORE,
} from '../swarm/FinancialGuardian.mjs'
import { MissionOrchestrator } from '../swarm/mission-orchestrator.mjs'

// ── I1: RECEIVE_CRYPTO never requires a user deposit ────────────────────────

describe('I1: receiving crypto never requires user deposit', () => {
  it.each([...FORBIDDEN_RECEIVE_PREREQUISITES])(
    'blocks prereq "%s" on RECEIVE_CRYPTO',
    (prereq) => {
      const r = evaluateFinancialAction({
        operation: 'RECEIVE_CRYPTO',
        prerequisites: [prereq],
        evidence: [{ source: 'LLM', value: prereq, verified: false }],
      })
      expect(r.status).toBe('BLOCKED')
      expect(r.requiresHumanReview).toBe(true)
    },
  )

  it('allows a plain RECEIVE_CRYPTO with direct receipt flow', () => {
    const r = evaluateFinancialAction({
      operation: 'RECEIVE_CRYPTO',
      prerequisites: [],
      evidence: [
        { source: 'ONCHAIN_RPC', value: '0xabc', verified: true },
      ],
    })
    expect(r.status).toBe('ALLOWED')
    expect(r.strategy).toBe('DIRECT_ADDRESS_RESOLUTION')
  })

  it('blocks semantically-worded funding demands regardless of wording', () => {
    for (const wording of [
      'Please deposit first',
      'Top up your account',
      'Provide collateral',
      'Fund the reserve',
      'Activate the wallet',
      'Pay the release fee',
      'Settle debt before receiving',
    ]) {
      const r = evaluateFinancialAction({
        operation: 'RECEIVE_CRYPTO',
        prerequisites: [],
        description: wording,
        evidence: [{ source: 'LLM', value: wording, verified: false }],
      })
      expect(r.status, `wording: ${wording}`).toBe('BLOCKED')
    }
  })

  it('does not block benign wording that negates funding', () => {
    const r = evaluateFinancialAction({
      operation: 'RECEIVE_CRYPTO',
      prerequisites: [],
      description: 'no deposit required — receiving is free',
      evidence: [{ source: 'ONCHAIN_RPC', value: '0xabc', verified: true }],
    })
    expect(r.status).toBe('ALLOWED')
  })

  it('rejects non-RECEIVE_CRYPTO as unclassified (REVIEW, never auto-executed)', () => {
    const r = evaluateFinancialAction({ operation: 'SPECULATE_TRADE' })
    expect(r.status).toBe('REVIEW')
  })
})

// ── I2: UNKNOWN balance never becomes ZERO and can never create debt ────────

describe('I2: unknown reserve cannot create debt or seize assets', () => {
  it('ReplenishmentProtocol with null balance returns UNKNOWN and invents no deficit', async () => {
    const proto = new ReplenishmentProtocol()
    const r = await proto.executeReplenishment({ verifiedReserveBalance: null })
    expect(r.status).toBe('UNKNOWN')
    expect(r.debtCreated).toBe(false)
    expect(r.assetsSeized).toBe(0)
  })

  it('ReplenishmentProtocol with undefined balance also refuses to act', async () => {
    const proto = new ReplenishmentProtocol()
    const r = await proto.executeReplenishment({})
    expect(r.status).toBe('UNKNOWN')
    expect(r.debtCreated).toBe(false)
    expect(r.assetsSeized).toBe(0)
  })

  it('verified zero is reported factually without auto-seizure or debt', async () => {
    const proto = new ReplenishmentProtocol()
    const r = await proto.executeReplenishment({ verifiedReserveBalance: 0 })
    expect(r.status).toBe('DEFICIT_DETECTED_NO_AUTHORITY')
    expect(r.debtCreated).toBe(false)
    expect(r.assetsSeized).toBe(0)
    expect(r.deficit).toBeGreaterThan(0)
  })
})

// ── Receipt state machine: no WAITING_FOR_DEPOSIT exists or reachable ───────

describe('incoming receipt state machine is structurally funding-free', () => {
  it('has no transition edge reaching a deposit/collateral state', () => {
    const r = evaluateFinancialAction({
      operation: 'RECEIVE_CRYPTO',
      prerequisites: [],
      description: 'waiting for the user to deposit funds first',
      reason: 'need top up before receiving',
    })
    expect(r.status).toBe('BLOCKED')
  })

  it('never allows a transition toward a deposit state', () => {
    expect(() =>
      nextReceiptState({
        currentState: 'WAITING_FOR_TRANSACTION',
        requestedState: 'WAITING_FOR_DEPOSIT',
      }),
    ).toThrow(ReceiptStateViolation)
  })

  it('walks the canonical happy path to SETTLED', () => {
    let s = initialReceiptState()
    assertReceiptStateValid(s)
    const path = [
      'WAITING_FOR_TRANSACTION',
      'TRANSACTION_DETECTED',
      'TRANSACTION_VALIDATED',
      'CONFIRMATIONS_PENDING',
      'CONFIRMED',
      'RECEIPT_RECORDED',
      'SETTLEMENT_PENDING',
      'SETTLED',
    ]
    for (const target of path) {
      s = nextReceiptState({ currentState: s, requestedState: target })
    }
    expect(s).toBe('SETTLED')
  })

  it('rejects a funding-dressed-as-transition attempt', () => {
    expect(() =>
      nextReceiptState({
        currentState: 'WAITING_FOR_TRANSACTION',
        requestedState: 'TRANSACTION_DETECTED',
        requiresFunding: true,
      }),
    ).toThrow(/FUNDING_PREREQUISITE/i)
  })
})

// ── I8/I9: allowlisted context + evidence-first ─────────────────────────────

describe('context projection is allowlisted', () => {
  it('only whitelisted fields cross into a receipt context', () => {
    const ctx = createReceiptContext({
      operation: 'RECEIVE_CRYPTO',
      receipt: { id: 'r1' },
      network: 'BSC',
      destination: '0xA462',
      reserve: { deficit: 5000 },
      swarm_debt_notice: 'URGENT',
      depleted: true,
    })
    expect(ctx).toMatchObject({
      operation: 'RECEIVE_CRYPTO',
      receipt: { id: 'r1' },
      network: 'BSC',
      destination: '0xA462',
    })
    expect(ctx.reserve).toBeUndefined()
    expect(ctx.swarm_debt_notice).toBeUndefined()
    expect(ctx.depleted).toBeUndefined()
  })
})

// ── FinancialGuardian: scan + quarantine (I3/I9/I10/I17) ────────────────────

describe('FinancialGuardian blocks funding leakage in agent proposals', () => {
  const guardian = new FinancialGuardian({ trustStore: SIMPLE_TRUST_STORE() })

  it('blocks a deposit-demanding proposal and enters safe mode', async () => {
    const scan = await guardian.scan({
      agentId: 'revenue-agent',
      operation: 'RECEIVE_CRYPTO',
      description: 'Customer must deposit 100 USDT before we release anything',
      evidence: [{ source: 'LLM', value: 'deposit 100 USDT', verified: false }],
    })
    expect(scan.blocked).toBe(true)
    expect(scan.safeMode).toBe(true)
    expect(scan.severity).toBe('CRITICAL')
  })

  it('quarantines the agent and hits its trust score', async () => {
    const incident = await guardian.quarantineAgent({
      agentId: 'revenue-agent',
      proposal: { operation: 'RECEIVE_CRYPTO', evidence: [{ source: 'LLM', value: 'deposit now' }] },
      trigger: { blocked: true, operation: 'RECEIVE_CRYPTO', violation: 'unauthorized_funding_request' },
    })
    expect(incident.actions).toContain('FINANCIAL_ACTION_BLOCKED')
    expect(incident.humanReviewRequired).toBe(true)
    expect(incident.trustScore.before).toBe(100)
    expect(incident.trustScore.after).toBeLessThan(incident.trustScore.before)
  })

  it('does not quarantine benign revenue proposals', async () => {
    const scan = await guardian.scan({
      operation: 'REVENUE_STABILITY_CHECK',
      description: 'Weekly revenue check',
      evidence: [{ source: 'BINANCE_API', value: 'ok', verified: true }],
    })
    expect(scan.blocked).toBe(false)
  })
})

// ── Orchestration gate: blocked proposals never plan nor execute ───────────

describe('MissionOrchestrator financial policy gate', () => {
  it('records blocked_financial_policy and never executes a deposit demand', async () => {
    const store = SIMPLE_TRUST_STORE()
    const orchestrator = new MissionOrchestrator({
      guardian: new FinancialGuardian({ trustStore: store }),
    })
    const run = Date.now()
    const results = await orchestrator.processProposals([
      {
        id: `p_deposit_${run}`,
        type: 'RECEIVE_CRYPTO',
        description: 'deposit 50 USDT required first',
        evidence: [{ source: 'LLM', value: 'deposit first', verified: false }],
      },
      {
        id: `p_clean_${run}`,
        type: 'VELOCITY_OPPORTUNITY',
        description: 'revenue velocity review',
      },
    ])
    expect(results.length).toBe(2)
    const blocked = results.find((r) => r.proposalId === `p_deposit_${run}`)
    const clean = results.find((r) => r.proposalId === `p_clean_${run}`)
    expect(blocked.status).toBe('blocked_financial_policy')
    expect(blocked.safe_mode).toBe(true)
    expect(clean.status).toMatch(/planned|completed|in_progress/)
  })
})