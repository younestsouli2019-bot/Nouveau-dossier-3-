import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import immutableLedger from './immutable-ledger.mjs';
import didRegistry from './did-registry.mjs';
import reconciliationEngine from './reconciliation.mjs';
import escrowEngine from './escrow.mjs';
import settlementEngine from './netting.mjs';
import guardrailEngine from './guardrails.mjs';
import receivablesEngine from './receivables.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MISSION_PLAN_PATH = path.join(ROOT, 'data', 'swarm', 'mission-plan.json');

class SettlementPipeline {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return this;
    await didRegistry.init();
    await immutableLedger.init();
    await reconciliationEngine.init();
    await escrowEngine.init();
    await settlementEngine.init();
    await guardrailEngine.init();
    await receivablesEngine.init();
    this.initialized = true;
    return this;
  }

  async registerAgent(agentId, opts = {}) {
    await this.init();
    return didRegistry.register(agentId, opts);
  }

  async postEarning({ txId, amount, currency, agent, sourceAccount, revenueAccount, reference, payload, missionId }) {
    await this.init();
    const agentEntry = await didRegistry.register(agent || 'swarm');
    const tx = txId || `TXN_${Date.now()}_${cryptoRandom()}`;

    const capCheck = await guardrailEngine.checkValue(agentEntry.agentId, amount);
    if (!capCheck.allowed) {
      await immutableLedger.record(tx, 'revenue_cap_denied', [
        { account: sourceAccount || 'REVENUE_SUSPENSE', amount: Number(amount), currency, reference, payload: { reason: capCheck.reason } },
      ], { agent: agentEntry.agentId, did: agentEntry.did });
      return { status: 'CAP_DENIED', txId: tx, reason: capCheck.reason };
    }

    await immutableLedger.recordDualEntry(tx, 'revenue', {
      account: sourceAccount || 'REVENUE_SUSPENSE',
      amount: Number(amount),
      currency,
      reference,
      payload: payload || {},
    }, {
      account: revenueAccount || 'EARNINGS',
      amount: Number(amount),
      currency,
      reference,
      payload: payload || {},
    }, { agent: agentEntry.agentId, did: agentEntry.did });

    const recon = await reconciliationEngine.threeWayMatch({
      internalTrigger: { txId: tx, amount, currency },
      counterpartyAck: payload?.counterpartyAck ? { txId: tx, ...payload.counterpartyAck } : null,
      gatewayLedger: payload?.gatewayLedger ? { txId: tx, ...payload.gatewayLedger } : null,
      stateVars: payload?.stateVars || {},
    });

    const mission = missionId || payload?.missionId || payload?.proposalId || null;
    const receivable = await receivablesEngine.registerReceivable({
      txId: tx,
      missionId: mission,
      amount,
      currency,
      agent: agentEntry.agentId,
      recon,
      evidence: {
        counterpartyAck: payload?.counterpartyAck,
        gatewayLedger: payload?.gatewayLedger,
        oracleConfirmed: payload?.oracleConfirmed,
      },
    });

    const isRevenueMission = this._isRevenueGeneratingMission(mission);
    const blocked = isRevenueMission && receivable.klass !== 'A';

    let escrow = null;
    if (recon.status === 'MATCHED') {
      escrow = await escrowEngine.createEscrow({
        txId: tx,
        amount,
        currency,
        destination: payload?.destination || 'ma_attijariwafa',
        sourceAccount,
        purpose: payload?.purpose || 'revenue_settlement',
        agent: agentEntry.agentId,
      });
      if (payload?.oracleConfirmed) escrowEngine.confirmByOracle(escrow.escrowId, payload.oracle || 'oracle_gateway');
      if (payload?.verified) escrowEngine.verify(escrow.escrowId, payload.verifier || 'compliance', true);
    } else {
      await reconciliationEngine.quarantine({ txId: tx, amount, currency, agent: agentEntry.agentId }, `recon_mismatch:${recon.status}`);
    }

    return {
      status: recon.status === 'MATCHED' ? 'ESCROWED' : 'QUARANTINED',
      txId: tx,
      reconciliation: recon,
      escrow,
      receivable,
      receivableBlocked: blocked,
      blockedReason: blocked ? `NON_CLASS_A_RECEIVABLE:${receivable.klass}` : null,
    };
  }

  _isRevenueGeneratingMission(missionId) {
    if (!missionId) return false;
    const plan = this._loadMissionPlan();
    if (!plan || !Array.isArray(plan.missions)) return false;
    const mission = plan.missions.find(m => m.id === missionId);
    if (!mission) return false;
    return receivablesEngine.revenueGeneratingTypes().includes(mission.type);
  }

  _loadMissionPlan() {
    if (!existsSync(MISSION_PLAN_PATH)) return null;
    try { return JSON.parse(readFileSync(MISSION_PLAN_PATH, 'utf-8')); }
    catch { return null; }
  }

  async settleRevenue(rail = 'charipay', opts = {}) {
    await this.init();
    const { nets, blocked, batches } = await settlementEngine.settleReceivables(receivablesEngine.state.receivables, rail, opts);
    for (const batch of batches) {
      for (const rId of batch.receivableIds || []) {
        const rec = receivablesEngine.state.receivables.find(r => r.receivableId === rId);
        if (rec) await receivablesEngine.settleReceivable(rec.txId, { batchId: batch.batchId, rail });
      }
    }
    return { nets, blocked, batches };
  }

  async auditRevenueMissions() {
    await this.init();
    return receivablesEngine.auditRevenueMissions();
  }

  async receivablesStatus() {
    await this.init();
    return receivablesEngine.status();
  }

  async netAndSettle(transactions, rail = 'ach', opts = {}) {
    await this.init();
    return settlementEngine.settle(transactions, rail, opts);
  }

  async verifyLedger() {
    await this.init();
    return immutableLedger.verify();
  }

  async status() {
    await this.init();
    const agents = await didRegistry.list();
    return {
      agents: agents.map(a => ({ agentId: a.agentId, did: a.did, kind: a.kind })),
      ledger: await immutableLedger.summary(),
      ledgerIntegrity: await immutableLedger.verify(),
      reconciliation: await reconciliationEngine.status(),
      escrow: await escrowEngine.status(),
      settlements: await settlementEngine.status(),
      guardrails: await guardrailEngine.status(),
      receivables: await receivablesEngine.status(),
    };
  }
}

function cryptoRandom() {
  return crypto.randomBytes(6).toString('hex');
}

const settlementPipeline = new SettlementPipeline();
export default settlementPipeline;
export { SettlementPipeline };
