import settlementPipeline from './pipeline.mjs';
import escrowEngine from './escrow.mjs';
import guardrailEngine from './guardrails.mjs';
import settlementEngine from './netting.mjs';
import sahlRail from './rails/sahl.mjs';

async function main() {
  const cmd = process.argv[2] || 'status';

  if (cmd === 'status') {
    const status = await settlementPipeline.status();
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (cmd === 'sahl-status') {
    const status = await sahlRail.status();
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (cmd === 'payout') {
    await settlementPipeline.init();
    const amount = parseFloat(process.argv[3]);
    const currency = process.argv[4] || 'MAD';
    const destinationKey = process.argv[5] || 'ma_attijariwafa';
    if (!amount || amount <= 0) {
      console.error('Usage: settlement.mjs payout <amount> [MAD] [ma_attijariwafa|ma_attijariwafa_carnet]');
      process.exit(1);
    }
    const destination = await settlementEngine.resolveDestination(destinationKey);
    if (!destination) { console.error(`FATAL: destination ${destinationKey} not found in owner-truth.json`); process.exit(1); }
    const result = await settlementPipeline.netAndSettle([
      { txId: `PAYOUT_${Date.now()}`, counterparty: 'OWNER', currency, amount },
    ], 'sahl', { submit: false });
    const batch = result.batches[0];
    const submitted = await settlementEngine.submitToRail(batch.batchId, { destinationAccount: destination, purpose: destinationKey === 'ma_attijariwafa_carnet' ? 'debt_repayment' : 'salary' });
    console.log(JSON.stringify({ destination: { key: destinationKey, iban: destination.iban }, net: result.nets, batch: submitted.batch, rail: submitted.railResult }, null, 2));
    return;
  }

  if (cmd === 'selftest') {
    await settlementPipeline.init();
    await settlementPipeline.registerAgent('selftest-agent', { kind: 'agent', role: 'qa' });

    const result = await settlementPipeline.postEarning({
      txId: `SELFTEST_${Date.now()}`,
      amount: 125,
      currency: 'USD',
      agent: 'selftest-agent',
      reference: 'SELFTEST-REF-1',
      payload: {
        counterpartyAck: { amount: 125, currency: 'USD' },
        gatewayLedger: { amount: 125, currency: 'USD' },
        oracleConfirmed: true,
        verified: true,
      },
    });

    const integrity = await settlementPipeline.verifyLedger();
    const frozenCheck = await guardrailEngine.recordError('selftest-agent', new Error('qa error'));

    console.log(JSON.stringify({ earning: result, integrity, frozenCheck, status: await settlementPipeline.status() }, null, 2));
    return;
  }

  if (cmd === 'net') {
    const rail = process.argv[3] || 'usdc';
    const net = await settlementPipeline.netAndSettle([
      { txId: 'T1', counterparty: 'ACME', currency: 'MAD', amount: 1500 },
      { txId: 'T2', counterparty: 'ACME', currency: 'MAD', amount: -200 },
      { txId: 'T3', counterparty: 'GLOBEX', currency: 'EUR', amount: 100 },
    ], rail, { submit: false });
    console.log(JSON.stringify(net, null, 2));
    return;
  }

  if (cmd === 'escrow-release-drill') {
    await settlementPipeline.init();
    const r = await settlementPipeline.postEarning({
      txId: `DRILL_${Date.now()}`,
      amount: 75,
      currency: 'EUR',
      agent: 'selftest-agent',
      payload: { counterpartyAck: { amount: 75, currency: 'EUR' }, gatewayLedger: { amount: 75, currency: 'EUR' }, oracleConfirmed: true, verified: true },
    });
    if (r.escrow) {
      for (const s of r.escrow.signers) await escrowEngine.sign(r.escrow.escrowId, s, 'drill-sig');
      let denial = null;
      try { await escrowEngine.release(r.escrow.escrowId); } catch (e) { denial = e.message; }
      const escrow = r.escrow;
      escrow.unlockAt = new Date(Date.now() - 1000).toISOString();
      const released = await escrowEngine.release(r.escrow.escrowId);
      console.log(JSON.stringify({ denialWhileLocked: denial, released, status: await settlementPipeline.status() }, null, 2));
    } else {
      console.log(JSON.stringify({ error: 'no escrow created', result: r }, null, 2));
    }
    return;
  }

  console.error(`Unknown command: ${cmd}. Usage: settlement.mjs [status|sahl-status|payout <amount> [MAD] [dest]|selftest|net [rail]|escrow-release-drill]`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('settlement.mjs')) {
  main().catch(e => { console.error('FATAL:', e); process.exit(1); });
}

export default settlementPipeline;
