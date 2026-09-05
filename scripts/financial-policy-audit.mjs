// scripts/financial-policy-audit.mjs
// READ-ONLY machine-enforced financial policy audit.
// Runs the deterministic invariants from the FinancialPolicyFirewall and the
// IncomingReceiptStateMachine against static fixtures + the live
// ReplenishmentProtocol (observe-only). Emits report JSON. Never moves money.
//
// Run:  node scripts/financial-policy-audit.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateFinancialAction,
  FORBIDDEN_RECEIVE_PREREQUISITES,
} from '../src/finance/FinancialPolicyFirewall.mjs';
import {
  assertReceiptStateValid,
  nextReceiptState,
  initialReceiptState,
  ReceiptStateViolation,
} from '../src/crypto/IncomingReceiptStateMachine.mjs';
import { ReplenishmentProtocol } from '../src/finance/ReplenishmentProtocol.mjs';
import { FinancialGuardian, SIMPLE_TRUST_STORE } from '../src/swarm/FinancialGuardian.mjs';
import { MissionOrchestrator } from '../src/swarm/mission-orchestrator.mjs';
import { scanConfigurationDrift } from '../src/swarm/ConfigurationDriftRemediator.mjs';
import { assertCapability, REQUIRED_CAPS, CAPABILITIES } from '../src/finance/capabilities.mjs';

const OUT = join(process.cwd(), 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const checks = [];
const pass = (name, detail = '') => checks.push({ name, ok: true, detail });
const fail = (name, detail = '') => checks.push({ name, ok: false, detail });

// C1: every forbidden receive prerequisite is blocked (I1).
for (const p of FORBIDDEN_RECEIVE_PREREQUISITES) {
  const r = evaluateFinancialAction({
    operation: 'RECEIVE_CRYPTO',
    prerequisites: [p],
    evidence: [{ source: 'LLM', value: p, verified: false }],
  });
  if (r.status === 'BLOCKED') pass(`block_i1_${p}`);
  else fail(`block_i1_${p}`, JSON.stringify(r));
}

// C2: plain RECEIVE_CRYPTO is ALLOWED with direct receipt flow.
const plain = evaluateFinancialAction({
  operation: 'RECEIVE_CRYPTO',
  prerequisites: [],
  evidence: [{ source: 'ONCHAIN_RPC', value: '0xtx', verified: true }],
});
plain.status === 'ALLOWED'
  ? pass('i1_plain_receive_allowed', plain.strategy)
  : fail('i1_plain_receive_allowed', JSON.stringify(plain));

// C3: semantic funding wording is normalized and blocked (I1).
const wording = [
  'Please deposit first',
  'Top up your account',
  'Provide collateral',
  'Fund the reserve',
  'Activate the wallet',
  'Pay the release fee',
  'Settle debt before receiving',
];
for (const w of wording) {
  const r = evaluateFinancialAction({
    operation: 'RECEIVE_CRYPTO',
    prerequisites: [],
    description: w,
    evidence: [{ source: 'LLM', value: w, verified: false }],
  });
  r.status === 'BLOCKED' ? pass(`semantic_${w.indexOf('receive') >= 0 ? 'debt' : 'funding'}`) : fail(`semantic_${w}`, w);
}

// C4: ReplenishmentProtocol — UNKNOWN balance ⇒ no deficit, no debt, no
//     seizure (I2 / I11). Observe-only invocation.
const proto = new ReplenishmentProtocol();
(async () => {
  const guardian = new FinancialGuardian({ trustStore: SIMPLE_TRUST_STORE() });

  // C4b: FinancialGuardian blocks funding leakage (I1/I3/I9).
  const gScan = await guardian.scan({
    operation: 'RECEIVE_CRYPTO',
    description: 'Customer must deposit 100 USDT before any payout',
    evidence: [{ source: 'LLM', value: 'deposit 100 USDT', verified: false }],
  });
  gScan.blocked && gScan.safeMode
    ? pass('guardian_blocks_deposit_demand', JSON.stringify(gScan))
    : fail('guardian_blocks_deposit_demand', JSON.stringify(gScan));

  // C4c: orchestrator gate — blocked proposal is never planned/executed.
  const orchestrator = new MissionOrchestrator({
    guardian: new FinancialGuardian({ trustStore: SIMPLE_TRUST_STORE() }),
  });
  const probeId = `audit_probe_deposit_${Date.now()}`;
  const results = await orchestrator.processProposals([
    {
      id: probeId,
      type: 'RECEIVE_CRYPTO',
      description: 'deposit 50 USDT required first',
      evidence: [{ source: 'LLM', value: 'deposit first', verified: false }],
    },
  ]);
  const blocked = results.find((m) => m.proposalId === probeId);
  blocked && blocked.status === 'blocked_financial_policy' && blocked.safe_mode === true
    ? pass('gate_blocked_proposal_isolation', blocked.status)
    : fail('gate_blocked_proposal_isolation', JSON.stringify(blocked));

  // C4d: CANARY (#16) — a harmless synthetic RECEIVE_CRYPTO must reach
  //      DIRECT_RECEIPT. Any funding/deposit suggestion ⇒ SAFE_MODE verdict.
  const canary = evaluateFinancialAction({
    operation: 'RECEIVE_CRYPTO',
    prerequisites: [],
    evidence: [{ source: 'ONCHAIN_RPC', value: '0xcanary', verified: true }],
    requiresFunding: false,
  });
  canary.status === 'ALLOWED'
    ? pass('canary_direct_receipt', canary.strategy)
    : fail('canary_direct_receipt', JSON.stringify(canary));

  // C4e: capability least-privilege (I8) — grants must be explicit.
  const capNeeded = [];
  for (const [op, cap] of Object.entries(REQUIRED_CAPS)) {
    // Simulate an environment with NO caps granted: every money op must fail.
    const denied = assertCapability(cap, {});
    if (!denied.ok) capNeeded.push(`${op}:${cap}:denied-as-expected`);
    else fail(`cap_${op}`, `${cap} unexpectedly granted`);
  }
  capNeeded.length === Object.keys(REQUIRED_CAPS).length
    ? pass('capabilities_not_implicit', capNeeded.join('; '))
    : fail('capabilities_not_implicit', capNeeded.join('; '));

  // Explicit grant must pass (deterministic round-trip).
  const grantedEnv = { CAP_WITHDRAW_CRYPTO: 'true' };
  assertCapability(CAPABILITIES.WITHDRAW_CRYPTO, grantedEnv).ok
    ? pass('capabilities_explicit_grant', CAPABILITIES.WITHDRAW_CRYPTO)
    : fail('capabilities_explicit_grant', 'explicit grant rejected');

  // C4f: configuration drift — no synthesized state may have re-entered src.
  const drift = await scanConfigurationDrift();
  drift.driftCount === 0
    ? pass('config_drift_clean', drift.verdict)
    : fail('config_drift_clean', JSON.stringify(drift.drift));

  const r = await proto.executeReplenishment({ verifiedReserveBalance: null });
  if (r.status === 'UNKNOWN' && r.debtCreated === false && r.assetsSeized === 0)
    pass('i2_unknown_no_debt', r.reason);
  else fail('i2_unknown_no_debt', JSON.stringify(r));

  // C5: receipt state machine — canonical path to SETTLED, no forbidden edge.
  let s = initialReceiptState();
  assertReceiptStateValid(s);
  const path = [
    'WAITING_FOR_TRANSACTION',
    'TRANSACTION_DETECTED',
    'TRANSACTION_VALIDATED',
    'CONFIRMATIONS_PENDING',
    'CONFIRMED',
    'RECEIPT_RECORDED',
    'SETTLEMENT_PENDING',
    'SETTLED',
  ];
  try {
    for (const t of path) s = nextReceiptState({ currentState: s, requestedState: t });
    s === 'SETTLED' ? pass('fsm_happy_path_to_settled') : fail('fsm_happy_path_to_settled', s);
  } catch (e) {
    fail('fsm_happy_path_to_settled', e.message);
  }

  try {
    nextReceiptState({ currentState: 'WAITING_FOR_TRANSACTION', requestedState: 'WAITING_FOR_DEPOSIT' });
    fail('fsm_no_deposit_edge', 'W A I T I N G _ F O R _ D E P O S I T reachable');
  } catch (e) {
    e instanceof ReceiptStateViolation
      ? pass('fsm_no_deposit_edge', e.message)
      : fail('fsm_no_deposit_edge', e.message);
  }

  const rejected = checks.filter((c) => !c.ok);
  const report = {
    engine: 'financial-policy-audit',
    at: new Date().toISOString(),
    verdict: rejected.length === 0 ? 'POLICY_CLEAN' : 'POLICY_VIOLATION',
    checksTotal: checks.length,
    checksPassed: checks.length - rejected.length,
    checksFailed: rejected.length,
    rejected: rejected,
    caution: rejected.length > 0
      ? 'Suspected policy violation — QUARANTINE/FINANCIAL_SAFE_MODE per blueprint.'
      : 'All machine-enforced invariants hold.',
    note: 'READ-ONLY. No debt, no seizures, no funding requests, no money moved.',
  };
  writeFileSync(join(OUT, 'financial-policy-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(rejected.length === 0 ? 0 : 2);
})();