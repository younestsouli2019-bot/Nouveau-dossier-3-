#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');
const RECOVERY_LOG = path.join(ROOT, '.swarm', 'recovery-salaire.json');

async function log(msg) {
  const line = `[${new Date().toISOString()}] [RECOVERY] ${msg}`;
  console.log(line);
  try { await fs.appendFile(path.join(ROOT, '.swarm', 'recovery-salaire.log'), line + '\n', 'utf-8'); } catch (e) { console.error('log write failed:', e.message); }
}

async function loadJSON(fp) {
  try { return JSON.parse(await fs.readFile(fp, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('loadJSON failed:', fp, e.message); return null; }
}

async function saveJSON(fp, data) {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf-8');
}

async function executeBaaSTransfer(amountMAD, iban, beneficiary, bankCode, description) {
  const baasKey = process.env.CHARI_BAAS_SECRET_KEY;
  const walletId = process.env.BAAS_WALLET_ID;
  if (!baasKey || !walletId || baasKey.includes('PLACEHOLDER')) {
    return { status: 'DEFERRED', reason: 'BaaS credentials not set — recorded for later execution' };
  }

  const baseUrl = process.env.BAAS_ENV === 'production' ? 'https://api.baas.ma/v1' : 'https://sandbox.baas.ma/v1';
  const payload = {
    source_account_id: walletId,
    amount: amountMAD,
    currency: 'MAD',
    destination: { type: 'bank_account', iban: iban.replace(/\s/g, ''), beneficiary_name: beneficiary, bank_code: bankCode },
    description, idempotency_key: `RECOVERY_${Date.now()}_${Math.floor(amountMAD * 100)}`,
    metadata: { automation_layer: 'Recovery_v1', purpose: 'salary_debt_recovery' },
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(`${baseUrl}/transfers`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${baasKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const data = resp.ok ? await resp.json() : null;
      const settled = resp.status === 200 || resp.status === 201;
      if (settled) return { status: 'SETTLED', trackingId: data?.transfer_id, data };
      if (resp.status === 401 || resp.status === 403) return { status: 'AUTH_FAILED', reason: 'BaaS rejected credentials' };
      return { status: 'FAILED', httpStatus: resp.status };
    } catch (err) {
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
      else return { status: 'NETWORK_ERROR', reason: err.message };
    }
  }
}

async function main() {
  console.log(`
═══════════════════════════════════════════════════════════
     RECOVERY SALAIRE & DETTES — Régularisation virements
═══════════════════════════════════════════════════════════
  Procédure de rattrapage des fonds Salaire (10%) et
  Dettes (40%) historiquement routés vers des comptes
  de transition au lieu des RIB Attijariwafa désignés.
═══════════════════════════════════════════════════════════
  `);

  const truth = await loadJSON(TRUTH_PATH);
  if (!truth) { console.error('FATAL: owner-truth.json not found'); process.exit(1); }

  const salaireAccount = truth.paymentDestinations?.bankAccounts?.ma_attijariwafa;
  const dettesAccount = truth.paymentDestinations?.bankAccounts?.ma_attijariwafa_carnet;
  if (!salaireAccount) { console.error('FATAL: ma_attijariwafa not found in owner-truth.json'); process.exit(1); }
  if (!dettesAccount) { console.error('FATAL: ma_attijariwafa_carnet not found in owner-truth.json'); process.exit(1); }

  const salaireIBAN = salaireAccount.iban.replace(/\s/g, '');
  const dettesRIB = dettesAccount.iban.replace(/\s/g, '');
  const beneficiary = salaireAccount.accountHolder || 'Younes Tsouli';

  const args = process.argv.slice(2);
  const salaireMAD = parseFloat(args[0]);
  const dettesMAD = parseFloat(args[1]);

  if (!salaireMAD && !dettesMAD) {
    console.log(`
  Usage:  node src/recovery-salaire.mjs <salaire_amount_MAD> <dettes_amount_MAD>

  Exemple:
    node src/recovery-salaire.mjs 15000 60000

  Pour exécuter sans attendre les credentials BaaS:
    BAAS_WALLET_ID=xxx CHARI_BAAS_SECRET_KEY=xxx node src/recovery-salaire.mjs 15000 60000

  Les deux virements seront émis vers:
    1. Salaire  (10%):  ${salaireIBAN}  (Attijariwafa principal)
    2. Dettes   (40%):  ${dettesRIB}    (Attijariwafa Compte sur Carnet)
    `);
    process.exit(0);
  }

  await log(`=== RECOVERY: Salaire=${salaireMAD} MAD, Dettes=${dettesMAD} MAD ===`);
  await log(`Destination salaire: ${salaireIBAN} (${beneficiary})`);
  await log(`Destination dettes:  ${dettesRIB} (${beneficiary})`);

  const results = [];

  if (salaireMAD > 0) {
    await log(`[SALAIRE] Initiating transfer of ${salaireMAD} MAD to ${salaireIBAN}`);
    const r = await executeBaaSTransfer(salaireMAD, salaireIBAN, beneficiary, '007', `RECOVERY_SALAIRE_${Date.now()}`);
    results.push({ purpose: 'salaire', amountMAD: salaireMAD, destination: 'ma_attijariwafa', iban: salaireIBAN, result: r });
    await log(`[SALAIRE] ${r.status}${r.trackingId ? ' tracking=' + r.trackingId : ''}${r.reason ? ' reason=' + r.reason : ''}`);
  }

  if (dettesMAD > 0) {
    await log(`[DETTES] Initiating transfer of ${dettesMAD} MAD to ${dettesRIB}`);
    const r = await executeBaaSTransfer(dettesMAD, dettesRIB, beneficiary, '007', `RECOVERY_DETTES_${Date.now()}`);
    results.push({ purpose: 'dettes', amountMAD: dettesMAD, destination: 'ma_attijariwafa_carnet', iban: dettesRIB, result: r });
    await log(`[DETTES] ${r.status}${r.trackingId ? ' tracking=' + r.trackingId : ''}${r.reason ? ' reason=' + r.reason : ''}`);
  }

  const allDeferred = results.every(r => r.result.status === 'DEFERRED');
  const manifest = {
    executedAt: new Date().toISOString(),
    authorizedBy: 'CIN A337773 — Younes Tsouli',
    totalSalaireMAD: salaireMAD,
    totalDettesMAD: dettesMAD,
    totalMAD: salaireMAD + dettesMAD,
    results,
    status: allDeferred ? 'DEFERRED — set BaaS credentials and re-run' : results.some(r => r.result.status === 'SETTLED') ? 'PARTIALLY_SETTLED' : 'EXECUTED',
  };

  await saveJSON(RECOVERY_LOG, manifest);

  // Update owner-truth.json with recovery saldo
  truth.settlementPolicy.fundAllocation.recovery.saldoSalaireMAD = salaireMAD;
  truth.settlementPolicy.fundAllocation.recovery.saldoDettesMAD = dettesMAD;
  truth.settlementPolicy.fundAllocation.recovery.executedAt = manifest.executedAt;
  truth.settlementPolicy.fundAllocation.recovery.status = manifest.status;
  await saveJSON(TRUTH_PATH, truth);

  console.log(`
═══════════════════════════════════════════════════════════
  RECOVERY COMPLETE
═══════════════════════════════════════════════════════════
  Salaire: ${salaireMAD} MAD → ${salaireIBAN}
  Dettes:  ${dettesMAD} MAD → ${dettesRIB}
  Total:   ${salaireMAD + dettesMAD} MAD
  Status:  ${manifest.status}
═══════════════════════════════════════════════════════════
  `);

  if (allDeferred) {
    console.log(`  Les credentials BaaS ne sont pas configurés.
  Pour exécuter les virements une fois les clés disponibles :

    .\\src\\mcp\\swarm-vault.ps1 -SetSecret CHARI_BAAS_SECRET_KEY -Value "VOTRE_CLE"
    .\\src\\mcp\\swarm-vault.ps1 -SetSecret BAAS_WALLET_ID -Value "VOTRE_WALLET_ID"
    node src/recovery-salaire.mjs ${salaireMAD} ${dettesMAD}
  `);
  }

  return manifest;
}

main().catch(err => { console.error(`FATAL: ${err.message}`); process.exit(1); });
