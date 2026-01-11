import { IntentInvariant } from './IntentInvariant.mjs'
import { PowerGradient } from './PowerGradient.mjs'
import { TransparencyCost } from './TransparencyCost.mjs'
import { DomainAutonomy } from './DomainAutonomy.mjs'
import { ReputationLedger } from './ReputationLedger.mjs'
import { DeadmanSwitch } from './DeadmanSwitch.mjs'
import { RevenuePriority } from './RevenuePriority.mjs'

export class GovernanceGate {
  constructor() {
    this.intent = new IntentInvariant()
    this.power = new PowerGradient()
    this.transparency = new TransparencyCost()
    this.autonomy = new DomainAutonomy()
    this.rep = new ReputationLedger()
    this.deadman = new DeadmanSwitch()
    this.revenue = new RevenuePriority()
  }
  evaluate(task) {
    const dm = this.deadman.check(task)
    if (!dm.ok) {
      this.rep.write({ type: 'blocked', reason: dm.reason, task })
      return { ok: false, reason: dm.reason }
    }
    
    // REVENUE PRIORITY CHECK
    const rp = this.revenue.check(task)
    if (!rp.ok) {
      this.rep.write({ type: 'financial_block', reason: rp.reason, task })
      return { ok: false, reason: rp.reason }
    }

    const ii = this.intent.check(task)
    if (!ii.ok) {
      this.rep.write({ type: 'intent_violation', reason: ii.reason, task })
      return { ok: false, reason: ii.reason }
    }
    const pg = this.power.check(task)
    if (!pg.ok) {
      this.rep.write({ type: 'power_risk', reason: pg.reason, score: pg.score, task })
      return { ok: false, reason: pg.reason }
    }
    const tc = this.transparency.check(task)
    if (!tc.ok) {
      this.rep.write({ type: 'transparency_risk', reason: tc.reason, budget: tc.budget, task })
      return { ok: false, reason: tc.reason }
    }
    const da = this.autonomy.check(task)
    if (!da.ok) {
      this.rep.write({ type: 'autonomy_violation', reason: da.reason, task })
      return { ok: false, reason: da.reason }
    }
    return { ok: true }
  }
}
