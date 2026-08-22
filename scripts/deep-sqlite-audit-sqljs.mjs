// ——— DEEP SQLITE DATABASE AUDIT (sql.js WASM version) ———
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(ROOT, 'workspace-52b995fb-7bc4-47b5-8597-83766cbf7229/db/custom.db');
const QUARANTINE_DIR = resolve(ROOT, 'data', 'quarantine');
const REPORT_DIR = resolve(ROOT, 'reports');
[QUARANTINE_DIR, REPORT_DIR].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

const CANONICAL = {
  paypalEmails: ['younestsouli2019@gmail.com'],
  payoneerEmails: ['younestsouli2019@gmail.com'],
  cryptoAddresses: ['0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7', '0xa46225a984e2b2b5e5082e52ae8d8915a09fefe7'],
  bankRIBs: ['007810000448500030594182'],
  bankAccountNums: ['0004485000305941'],
  ibans: ['LU774080000041265646'],
  swiftBICs: ['BCIRLULL'],
};

const PATTERNS = {
  HEX: /^[a-f0-9]{16,128}$/i,
  EXT_REF: /^[a-zA-Z0-9\-_:.]{6,}$/,
  ETH_TX: /^0x[a-fA-F0-9]{64}$/,
  ETH_ADDR: /^0x[a-fA-F0-9]{40}$/,
  IBAN: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/,
  FAKE: [/^fake/i, /^mock/i, /^test/i, /^demo/i, /^placeholder/i, /^xxx/i, /^0{6,}$/, /^1{6,}$/, /sample/i, /not.*real/i],
};

const audit = {
  timestamp: new Date().toISOString(),
  summary: { totalAudited: 0, critical: 0, high: 0, medium: 0, totalSuspectAmount: 0, quarantined: 0 },
  findings: [], quarantined: [], tables: {},
};

function addFinding({ type, entity, entityId, severity, rule, description, amount, evidence }) {
  audit.findings.push({ type, entity, entityId, severity, rule, description, amount: amount || 0, evidence: evidence || null, ts: new Date().toISOString() });
  audit.summary[severity]++;
  if (amount) audit.summary.totalSuspectAmount += amount;
}
function quarantined({ entity, entityId, reason, data }) {
  const entry = { entity, entityId, reason, data: data || null, at: new Date().toISOString() };
  audit.quarantined.push(entry);
  audit.summary.quarantined++;
  const safe = `${entity}_${String(entityId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
  try { writeFileSync(resolve(QUARANTINE_DIR, `deep_${Date.now()}_${safe}`), JSON.stringify(entry, null, 2)); } catch {}
}
function isFake(ref, label) {
  if (!ref || typeof ref !== 'string') return { fake: true, reason: `${label} null/empty` };
  if (ref.trim().length < 6) return { fake: true, reason: `${label} too short (${ref.length}): "${ref.slice(0,30)}"` };
  for (const p of PATTERNS.FAKE) if (p.test(ref)) return { fake: true, reason: `${label} matches ${p}: "${ref.slice(0,50)}"` };
  return { fake: false };
}

console.log('='.repeat(80));
console.log('  DEEP SQLITE DATABASE AUDIT (sql.js WASM)');
console.log('='.repeat(80));
console.log(`[DB] ${DB_PATH} | Exists: ${existsSync(DB_PATH)}`);
if (!existsSync(DB_PATH)) { console.error('[FATAL] DB not found'); process.exit(1); }

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

function runQuery(sql) {
  try {
    const results = db.exec(sql);
    if (results.length === 0) return [];
    const cols = results[0].columns;
    return results[0].values.map(row => {
      const o = {};
      cols.forEach((c, i) => { o[c] = row[i]; });
      return o;
    });
  } catch (e) {
    return [];
  }
}
function tableExists(name) {
  return runQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
}

const tables = runQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
console.log(`\n[DB] Found ${tables.length} tables:`);
for (const { name } of tables) {
  const c = runQuery(`SELECT COUNT(*) as c FROM "${name}"`)[0]?.c || 0;
  audit.tables[name] = c;
  audit.summary.totalAudited += c;
  console.log(`  - ${name}: ${c} rows`);
}

// 1. REVENUE EVENTS
console.log('\n>>> 1. REVENUE EVENTS');
if (tableExists('RevenueEvent')) {
  const revs = runQuery('SELECT * FROM RevenueEvent');
  const seen = new Map();
  for (const r of revs) {
    if (r.status === 'verified' && (!r.proofHash || !PATTERNS.HEX.test(String(r.proofHash)))) {
      addFinding({ type: 'revenue_missing_proof', entity: 'RevenueEvent', entityId: r.id, severity: Number(r.amount) > 500 ? 'critical' : 'high', rule: 'REV-001 (TRUTH-003)',
        description: `RevenueEvent id=${r.id} $${r.amount} status=verified but proofHash invalid/missing (type=${r.proofType || 'none'})`,
        amount: Number(r.amount), evidence: { proofHash: r.proofHash ? String(r.proofHash).slice(0,20) : null, proofType: r.proofType } });
      if (Number(r.amount) > 1000) quarantined({ entity: 'RevenueEvent', entityId: r.id, reason: 'Verified revenue without cryptographic proof', data: r });
    }
    const k = `${r.amount}|${r.source}|${String(r.createdAt || '').slice(0,10) || 'nodate'}`;
    if (seen.has(k)) {
      addFinding({ type: 'revenue_duplicate', entity: 'RevenueEvent', entityId: r.id, severity: Number(r.amount) > 200 ? 'critical' : 'high', rule: 'REV-003',
        description: `DUPLICATE revenue $${r.amount} from ${r.source} — matches ${seen.get(k)}`,
        amount: Number(r.amount) });
      quarantined({ entity: 'RevenueEvent', entityId: r.id, reason: 'Duplicate revenue event', data: r });
    } else seen.set(k, r.id);
    if (r.status === 'verified' && !r.payoutBatchId && !r.referenceId && Number(r.amount) > 100) {
      addFinding({ type: 'revenue_unbacked', entity: 'RevenueEvent', entityId: r.id, severity: 'high', rule: 'REV-002',
        description: `Revenue $${r.amount} verified but NO referenceId/payoutBatchId — unbacked?`,
        amount: Number(r.amount), evidence: { source: r.source } });
    }
  }
  console.log(`  - ${revs.length} records | Pending:${revs.filter(r=>r.status==='pending').length} Verified:${revs.filter(r=>r.status==='verified').length} Rejected:${revs.filter(r=>r.status==='rejected').length}`);
}

// 2. OWNER SETTLEMENTS
console.log('\n>>> 2. OWNER SETTLEMENTS');
if (tableExists('OwnerSettlement') && tableExists('OwnerAccount')) {
  const setts = runQuery(`SELECT s.*, a.label as accountLabel, a.accountType, a.accountNumber, a.walletAddress, a.paypalEmail, a.purposes as accountPurposes 
    FROM OwnerSettlement s LEFT JOIN OwnerAccount a ON s.ownerAccountId = a.id`);
  const buckets = new Map();
  for (const s of setts) {
    const amt = Number(s.amount);
    if (s.status === 'completed' && (!s.externalRef || !PATTERNS.EXT_REF.test(String(s.externalRef)))) {
      addFinding({ type: 'completed_no_ref', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-001 (TRUTH-001)',
        description: `Settlement $${amt} id=${s.id} COMPLETED WITHOUT externalRef (dataSource=${s.dataSource})`,
        amount: amt, evidence: { externalRef: s.externalRef, dataSource: s.dataSource } });
      quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'TRUTH-001: Completed without valid externalRef', data: s });
    }
    if (s.status === 'completed' && s.dataSource === 'internal_ledger_only') {
      addFinding({ type: 'fictional_settlement', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-002 (TRUTH-002)',
        description: `FICTIONAL SETTLEMENT: $${amt} completed with internal_ledger_only. NEVER LEFT SYSTEM!`,
        amount: amt });
      quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'TRUTH-002: Fictional completed settlement', data: s });
    }
    if (s.accountType === 'l2_crypto' && s.walletAddress) {
      const inCan = CANONICAL.cryptoAddresses.some(a => a.toLowerCase() === String(s.walletAddress).toLowerCase());
      if (!inCan) {
        addFinding({ type: 'misrouted_crypto', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-004a',
          description: `MISROUTED CRYPTO: $${amt} to ${String(s.walletAddress).slice(0,10)}... not in canonical wallets`,
          amount: amt, evidence: { wallet: s.walletAddress, account: s.accountLabel } });
        quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'MISROUTED: Crypto to non-owner wallet', data: s });
      }
    }
    if (s.accountType === 'paypal' && s.paypalEmail) {
      const inCan = CANONICAL.paypalEmails.includes(String(s.paypalEmail).toLowerCase()) || CANONICAL.payoneerEmails.includes(String(s.paypalEmail).toLowerCase());
      if (!inCan) {
        addFinding({ type: 'misrouted_paypal', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-004b',
          description: `MISROUTED PAYPAL: $${amt} to ${s.paypalEmail} not canonical`,
          amount: amt });
        quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'MISROUTED: PayPal to non-owner email', data: s });
      }
    }
    if (s.status === 'completed' && s.externalRef) {
      const fake = isFake(String(s.externalRef), 'OwnerSettlement.externalRef');
      if (fake.fake) {
        addFinding({ type: 'fake_ref', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-005',
          description: `FAKE externalRef on completed $${amt}: ${fake.reason}`, amount: amt });
        quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'FAKE externalRef', data: s });
      }
    }
    // cannibalism bucket
    const bk = `${s.amount}|${s.direction}|${s.ownerAccountId}|${String(s.createdAt || '').slice(0,13)}`;
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk).push(s);
  }
  for (const [k, grp] of buckets) {
    if (grp.length >= 3 && Number(grp[0].amount) > 50) {
      for (let i = 1; i < grp.length; i++) {
        addFinding({ type: 'cannibalistic_settlement', entity: 'OwnerSettlement', entityId: grp[i].id, severity: 'critical', rule: 'OS-CANNIBAL',
          description: `CANNIBALISTIC: ${grp.length}x $${grp[0].amount} settlements within 1hr — INTERNAL FRONT-RUNNING (${i+1}/${grp.length})`,
          amount: Number(grp[i].amount) });
        quarantined({ entity: 'OwnerSettlement', entityId: grp[i].id, reason: `CANNIBALISTIC #${i+1}/${grp.length}`, data: grp[i] });
      }
    }
  }
  console.log(`  - ${setts.length} records | Completed:${setts.filter(s=>s.status==='completed').length} Pending:${setts.filter(s=>s.status==='pending').length}`);
}

// 3. OWNER ACCOUNTS & PAYMENTS
console.log('\n>>> 3. OWNER ACCOUNTS + PAYMENTS ROUTING');
if (tableExists('OwnerAccount')) {
  const accts = runQuery('SELECT * FROM OwnerAccount WHERE isActive = 1');
  for (const a of accts) {
    if (a.accountType === 'l2_crypto' && a.walletAddress) {
      const inCan = CANONICAL.cryptoAddresses.some(x => x.toLowerCase() === String(a.walletAddress).toLowerCase());
      if (!inCan) {
        addFinding({ type: 'non_owner_crypto_account', entity: 'OwnerAccount', entityId: a.id, severity: 'critical', rule: 'OA-001',
          description: `ACTIVE OwnerAccount '${a.label}' wallet ${String(a.walletAddress).slice(0,10)}... NOT in canonical owner list — AUTO-MISROUTE RISK!`,
          amount: Number(a.totalReceived || 0), evidence: { label: a.label, totalReceived: a.totalReceived } });
        quarantined({ entity: 'OwnerAccount', entityId: a.id, reason: 'ACTIVE non-canonical crypto wallet — dangerous auto-routing', data: a });
      }
    }
  }
  console.log(`  - Active OwnerAccounts: ${accts.length}`);
}
if (tableExists('OwnerPayment')) {
  const pays = runQuery('SELECT * FROM OwnerPayment');
  for (const p of pays) {
    if (!p.recovered && p.ribNumber && Number(p.amount) > 200) {
      const matches = CANONICAL.bankRIBs.some(r => r.includes(String(p.ribNumber).slice(-6))) ||
        CANONICAL.ibans.some(i => i.includes(String(p.ribNumber).slice(-6)));
      if (!matches) {
        addFinding({ type: 'owner_payment_unknown_rib', entity: 'OwnerPayment', entityId: p.id, severity: 'high', rule: 'OP-002',
          description: `OwnerPayment $${p.amount} routed to RIB ...${String(p.ribNumber).slice(-4)} NOT canonical — NOT RECOVERED (recovered=${p.recovered})`,
          amount: Number(p.amount) });
      }
      const fake = isFake(String(p.ribNumber), 'OwnerPayment RIB');
      if (fake.fake && Number(p.amount) > 50) {
        addFinding({ type: 'owner_payment_fake_rib', entity: 'OwnerPayment', entityId: p.id, severity: 'critical', rule: 'OP-001',
          description: `OwnerPayment $${p.amount} has FAKE RIB: ${fake.reason}`, amount: Number(p.amount) });
        quarantined({ entity: 'OwnerPayment', entityId: p.id, reason: 'FAKE RIB', data: p });
      }
    }
  }
  console.log(`  - OwnerPayments: ${pays.length} | Recovered:${pays.filter(p=>p.recovered).length}`);
}

// 4. CRYPTO SETTLEMENTS
console.log('\n>>> 4. CRYPTO SETTLEMENTS');
if (tableExists('CryptoSettlement')) {
  const cs = runQuery('SELECT * FROM CryptoSettlement');
  for (const c of cs) {
    const amt = Number(c.amount);
    if (c.txHash && !PATTERNS.ETH_TX.test(String(c.txHash))) {
      const fake = isFake(String(c.txHash), 'CryptoSettlement.txHash');
      if (fake.fake || !String(c.txHash).startsWith('0x') || String(c.txHash).length !== 66) {
        addFinding({ type: 'fake_crypto_tx', entity: 'CryptoSettlement', entityId: c.id, severity: 'critical', rule: 'CS-001',
          description: `FAKE/MALFORMED txHash on $${amt} ${c.token}: ${fake.fake ? fake.reason : 'length='+String(c.txHash).length}`,
          amount: amt });
        quarantined({ entity: 'CryptoSettlement', entityId: c.id, reason: 'FAKE: txHash invalid format', data: c });
      }
    }
    if (c.status === 'confirmed' && !c.recovered && (c.misplaced == 1 || c.isOwner == 0) && c.recipientAddress) {
      const inCan = CANONICAL.cryptoAddresses.some(a => a.toLowerCase() === String(c.recipientAddress).toLowerCase());
      if (!inCan) {
        addFinding({ type: 'misplaced_crypto_unrecovered', entity: 'CryptoSettlement', entityId: c.id, severity: 'critical', rule: 'CS-002',
          description: `UNRECOVERED MISROUTE: $${amt} ${c.token} on ${c.network} → ${String(c.recipientAddress).slice(0,10)}... | misplaced=${c.misplaced} isOwner=${c.isOwner} recovered=${c.recovered}`,
          amount: amt });
        quarantined({ entity: 'CryptoSettlement', entityId: c.id, reason: 'LOSS: Crypto misrouted + UNRECOVERED', data: c });
      }
    }
    if (c.status === 'confirmed' && !c.recipientAddress && c.type !== 'approve') {
      addFinding({ type: 'confirmed_no_recipient', entity: 'CryptoSettlement', entityId: c.id, severity: 'high', rule: 'CS-003',
        description: `CryptoSettlement $${amt} confirmed but recipientAddress NULL — untraceable`,
        amount: amt });
    }
  }
  const misplacedUnrec = cs.filter(c => c.misplaced == 1 && c.recovered == 0).length;
  console.log(`  - ${cs.length} records | Confirmed:${cs.filter(c=>c.status==='confirmed').length} Misplaced+Unrecovered:${misplacedUnrec}`);
}

// 5. PAYOUT BATCHES + ITEMS
console.log('\n>>> 5. PAYOUT BATCHES + ITEMS');
if (tableExists('PayoutBatch')) {
  const batches = runQuery('SELECT * FROM PayoutBatch');
  const seen = new Map();
  for (const b of batches) {
    const amt = Number(b.totalAmount);
    if (b.status === 'completed' && (!b.providerBatchRef || !PATTERNS.EXT_REF.test(String(b.providerBatchRef)))) {
      addFinding({ type: 'completed_no_provider', entity: 'PayoutBatch', entityId: b.id, severity: 'critical', rule: 'PB-001 (TRUTH-004)',
        description: `PayoutBatch ${b.batchNumber} $${amt} COMPLETED WITHOUT providerBatchRef — disbursement NEVER externalized!`,
        amount: amt, evidence: { providerBatchRef: b.providerBatchRef, paymentProvider: b.paymentProvider } });
      quarantined({ entity: 'PayoutBatch', entityId: b.id, reason: 'TRUTH-004: Completed batch without provider ref', data: b });
    }
    if (b.providerBatchRef) {
      const fake = isFake(String(b.providerBatchRef), 'providerBatchRef');
      if (fake.fake && (b.status === 'completed' || b.status === 'submitted')) {
        addFinding({ type: 'fake_provider_ref', entity: 'PayoutBatch', entityId: b.id, severity: 'critical', rule: 'PB-006',
          description: `FABRICATED providerRef on ${b.status} batch ${b.batchNumber}: ${fake.reason}`,
          amount: amt });
        quarantined({ entity: 'PayoutBatch', entityId: b.id, reason: 'FABRICATED: provider ref fake pattern', data: b });
      }
    }
    const k = `${b.batchNumber}|${b.totalAmount}`;
    if (seen.has(k)) {
      addFinding({ type: 'duplicate_batch_number', entity: 'PayoutBatch', entityId: b.id, severity: 'critical', rule: 'PB-004',
        description: `DUPLICATE batchNumber ${b.batchNumber} $${amt} vs ${seen.get(k)} — double disbursement risk`,
        amount: amt });
      quarantined({ entity: 'PayoutBatch', entityId: b.id, reason: 'DUPLICATE: Batch number reused', data: b });
    } else seen.set(k, b.id);
  }
  console.log(`  - Batches:${batches.length} Completed:${batches.filter(b=>b.status==='completed').length} Submitted:${batches.filter(b=>b.status==='submitted').length}`);
}
if (tableExists('PayoutItem')) {
  const items = runQuery('SELECT * FROM PayoutItem');
  const dupMap = new Map();
  for (const it of items) {
    const amt = Number(it.amount);
    if (it.status === 'completed' && (!it.transactionRef || !PATTERNS.EXT_REF.test(String(it.transactionRef)))) {
      addFinding({ type: 'item_no_ref', entity: 'PayoutItem', entityId: it.id, severity: 'high', rule: 'PI-001',
        description: `PayoutItem $${amt} to ${it.recipientName} <${it.recipientEmail}> completed without transactionRef`,
        amount: amt });
    }
    const k = `${it.recipientEmail}|${it.amount}|${String(it.createdAt || '').slice(0,10)}`;
    if (dupMap.has(k) && it.status !== 'failed' && dupMap.get(k).status !== 'failed') {
      addFinding({ type: 'duplicate_item', entity: 'PayoutItem', entityId: it.id, severity: amt > 200 ? 'critical' : 'high', rule: 'PI-003',
        description: `DUPLICATE payout $${amt} to ${it.recipientEmail} (${it.batchNumber}) — matches ${dupMap.get(k).id}`,
        amount: amt });
      quarantined({ entity: 'PayoutItem', entityId: it.id, reason: 'DUPLICATE payout item', data: it });
    } else dupMap.set(k, it);
    if (it.transactionRef && it.status === 'completed') {
      const fake = isFake(String(it.transactionRef), 'PayoutItem.transactionRef');
      if (fake.fake) {
        addFinding({ type: 'fake_item_ref', entity: 'PayoutItem', entityId: it.id, severity: 'critical', rule: 'PI-004',
          description: `FAKE txRef on completed payout $${amt} to ${it.recipientEmail}: ${fake.reason}`,
          amount: amt });
        quarantined({ entity: 'PayoutItem', entityId: it.id, reason: 'FABRICATED: payout completed with fake tx ref', data: it });
      }
    }
  }
  console.log(`  - PayoutItems:${items.length} Completed:${items.filter(i=>i.status==='completed').length} Failed:${items.filter(i=>i.status==='failed').length}`);
}

// 6. PROCUREMENT STATE MACHINE
console.log('\n>>> 6. PROCUREMENT STATE MACHINE');
const procStates = ['pending','ordered','shipped','delivered','cancelled','returned'];
const poStates = ['draft','submitted','pending_approval','approved','partially_ordered','ordered','completed','rejected','cancelled'];
const shipStates = ['pending','label_created','picked_up','in_transit','customs','out_for_delivery','delivered','failed','returned'];

if (tableExists('ProcurementItem')) {
  const items = runQuery('SELECT * FROM ProcurementItem');
  for (const p of items) {
    const total = Number(p.totalEst) || Number(p.quantity || 0) * Number(p.unitPriceEst || 0);
    if (p.status === 'ordered' && (!p.orderRef || !p.supplierName)) {
      addFinding({ type: 'ordered_no_ref', entity: 'ProcurementItem', entityId: p.id, severity: 'high', rule: 'PR-002 (TRUTH-007)',
        description: `'${p.name}' ordered without orderRef (${p.orderRef || 'null'}) or supplierName (${p.supplierName || 'null'})`,
        amount: total });
    }
    if (p.status === 'delivered' && (!p.receiptConfirmedBy || p.receiptConfirmedBy === 'system' || p.receiptConfirmedBy === 'wet-run-engine')) {
      addFinding({ type: 'delivered_no_human', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-003 (TRUTH-008)',
        description: `DELIVERED confirmed by '${p.receiptConfirmedBy}' (NOT HUMAN) on '${p.name}' — TRUTH-008`,
        amount: total });
      quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'TRUTH-008: Delivered without human receipt confirmation', data: p });
    }
    if (p.receiptConfirmedAt && (!p.deliveryProofHash || !PATTERNS.HEX.test(String(p.deliveryProofHash)))) {
      addFinding({ type: 'no_delivery_proof', entity: 'ProcurementItem', entityId: p.id, severity: 'high', rule: 'PR-004 (TRUTH-005)',
        description: `Receipt confirmed but invalid/absent deliveryProofHash (${String(p.deliveryProofHash || 'null').slice(0,20)}) — TRUTH-005 on '${p.name}'`,
        amount: total });
    }
    if (p.deliveredAt && p.shippedAt && new Date(p.deliveredAt) < new Date(p.shippedAt)) {
      addFinding({ type: 'chrono_violation', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-005',
        description: `CHRONOLOGY FRAUD: '${p.name}' deliveredAt BEFORE shippedAt`, amount: total });
      quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'FRAUD: Delivered BEFORE shipped', data: p });
    }
    if (p.shippedAt && p.orderedAt && new Date(p.shippedAt) < new Date(p.orderedAt)) {
      addFinding({ type: 'chrono_violation2', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-006',
        description: `CHRONOLOGY FRAUD: '${p.name}' shippedAt BEFORE orderedAt`, amount: total });
      quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'FRAUD: Shipped BEFORE ordered', data: p });
    }
    if (p.quantityReceived !== null && p.quantityReceived !== undefined && Number(p.quantityReceived) !== Number(p.quantity)) {
      addFinding({ type: 'qty_mismatch', entity: 'ProcurementItem', entityId: p.id, severity: Number(p.quantityReceived) < Number(p.quantity) ? 'high' : 'medium', rule: 'PR-007',
        description: `QTY MISMATCH on '${p.name}': ordered ${p.quantity}, received ${p.quantityReceived}`,
        amount: Math.abs(Number(p.quantity) - Number(p.quantityReceived)) * Number(p.unitPriceEst || 0) });
    }
    if (p.orderedAt && p.deliveredAt) {
      const ms = new Date(p.deliveredAt) - new Date(p.orderedAt);
      if (ms > 0 && ms < 3600000) {
        addFinding({ type: 'impossible_fulfillment', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-008',
          description: `IMPOSSIBLE FULFILLMENT: '${p.name}' ordered→delivered in ${Math.round(ms/60000)}min — STATE FABRICATION`,
          amount: total });
        quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'FRAUD: Impossible <1hr order→delivery', data: p });
      }
    }
  }
  console.log(`  - ProcurementItems:${items.length} Delivered:${items.filter(p=>p.status==='delivered').length} Ordered:${items.filter(p=>p.status==='ordered').length}`);
}
if (tableExists('PurchaseOrder')) {
  const pos = runQuery('SELECT * FROM PurchaseOrder');
  for (const po of pos) {
    if (po.status === 'submitted' && po.ackStatus === 'SLA_BREACHED' && !po.approvedBy) {
      addFinding({ type: 'po_sla_breach', entity: 'PurchaseOrder', entityId: po.id, severity: 'high', rule: 'PO-002',
        description: `PO ${po.poNumber} $${po.totalAmount} SLA BREACHED: ackStatus=SLA_BREACHED escalations=${po.escalationCount} — supplier not acknowledging`,
        amount: Number(po.totalAmount) });
    }
  }
  console.log(`  - POs:${pos.length} Approved+Ordered:${pos.filter(p=>['approved','ordered','completed'].includes(p.status)).length}`);
}
if (tableExists('Shipment')) {
  const ships = runQuery('SELECT * FROM Shipment');
  for (const s of ships) {
    if (s.trackingVerified == 1 && !s.trackingNumber) {
      addFinding({ type: 'ship_verified_no_track', entity: 'Shipment', entityId: s.id, severity: 'critical', rule: 'SH-003',
        description: `Shipment ${s.shipmentNumber} trackingVerified=true but NO trackingNumber — verification FALSIFIED` });
      quarantined({ entity: 'Shipment', entityId: s.id, reason: 'FRAUD: trackingVerified=true without tracking number', data: s });
    }
  }
  console.log(`  - Shipments:${ships.length} Delivered:${ships.filter(s=>s.status==='delivered').length}`);
}

// 7. BALANCE RECONCILIATION
console.log('\n>>> 7. LEDGER BALANCE RECONCILIATION');
let totalRev = 0, totalSet = 0, totalDisbursed = 0, totalReject = 0;
if (tableExists('RevenueEvent')) {
  const r = runQuery("SELECT status, SUM(amount) as s FROM RevenueEvent GROUP BY status");
  for (const row of r) {
    if (row.status === 'rejected') totalReject += Number(row.s || 0);
    else totalRev += Number(row.s || 0);
  }
}
if (tableExists('OwnerSettlement')) {
  const r = runQuery("SELECT status, SUM(amount) as s FROM OwnerSettlement WHERE direction='inbound' GROUP BY status");
  for (const row of r) if (row.status === 'completed') totalSet += Number(row.s || 0);
}
if (tableExists('PayoutBatch')) {
  const r = runQuery("SELECT COALESCE(SUM(totalAmount),0) as s FROM PayoutBatch WHERE status IN ('completed','submitted')");
  totalDisbursed = Number(r[0]?.s || 0);
}
const delta = Math.round((totalRev - totalSet - totalDisbursed - totalReject) * 100) / 100;
console.log(`  - Total Revenue (non-rejected): $${totalRev.toFixed(2)}`);
console.log(`  - Total Settled (owner inbound): $${totalSet.toFixed(2)}`);
console.log(`  - Total Disbursed (payouts completed+submitted): $${totalDisbursed.toFixed(2)}`);
console.log(`  - Total Rejected Revenue: $${totalReject.toFixed(2)}`);
console.log(`  - BALANCE DELTA: $${delta.toFixed(2)} — ${Math.abs(delta) < 0.01 ? '✅ BALANCED' : Math.abs(delta) < 100 ? '⚠️  MINOR' : '❌ CRITICAL IMBALANCE'}`);
if (Math.abs(delta) >= 100) {
  addFinding({ type: 'balance_delta', entity: 'Reconciliation', entityId: 'BALANCE-LEDGER', severity: Math.abs(delta) > 1000 ? 'critical' : 'high', rule: 'RECON-001',
    description: `LEDGER IMBALANCE: Delta $${delta.toFixed(2)} | Rev=$${totalRev.toFixed(2)} Settled=$${totalSet.toFixed(2)} Disbursed=$${totalDisbursed.toFixed(2)} Rejected=$${totalReject.toFixed(2)}`,
    amount: Math.abs(delta), evidence: { totalRev, totalSet, totalDisbursed, totalReject, delta } });
}

db.close();

// WRITE REPORT
const now = Date.now();
const reportPath = resolve(REPORT_DIR, `deep-sqlite-audit-${now}.json`);
writeFileSync(reportPath, JSON.stringify(audit, null, 2));

const md = [];
md.push('# 🔴 DEEP SQLITE LEDGER AUDIT — COMPREHENSIVE REPORT');
md.push(`\n**Generated:** ${audit.timestamp}`);
md.push(`**Total rows audited:** ${audit.summary.totalAudited}`);
md.push('\n## FINDINGS SUMMARY\n');
md.push('| Severity | Count |');
md.push('|---|---|');
md.push(`| 🔴 CRITICAL | **${audit.summary.critical}** |`);
md.push(`| 🟠 HIGH | **${audit.summary.high}** |`);
md.push(`| 🟡 MEDIUM | **${audit.summary.medium}** |`);
md.push(`| 🛑 QUARANTINED (deep run) | **${audit.summary.quarantined}** |`);
md.push(`\n## 💰 TOTAL SUSPECT / AT-RISK FUNDS\n\n**$${audit.summary.totalSuspectAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}**\n`);
md.push('\n---\n## 🚨 CRITICAL FINDINGS\n');
const crits = audit.findings.filter(f => f.severity === 'critical');
if (crits.length === 0) md.push('_No critical findings._\n');
else crits.forEach((f, i) => {
  md.push(`### CRITICAL #${i+1}: [${f.entity}] ${f.type} — ${f.rule}`);
  md.push(`- **At risk:** $${(f.amount||0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`);
  md.push(`- **Entity ID:** ${f.entityId}`);
  md.push(`- **Description:** ${f.description}`);
  if (f.evidence) md.push(`- **Evidence:** \`${JSON.stringify(f.evidence).slice(0,300)}\``);
  md.push('');
});
md.push('\n---\n## 🛑 QUARANTINED ENTITIES\n');
if (audit.quarantined.length === 0) md.push('_None in deep run._\n');
else {
  md.push('| # | Entity | ID | Reason |');
  md.push('|---|---|---|---|');
  audit.quarantined.forEach((q, i) => {
    md.push(`| ${i+1} | ${q.entity} | ${String(q.entityId).slice(0,30)}${String(q.entityId).length>30?'...':''} | ${q.reason.slice(0,95)} |`);
  });
}
md.push(`\n📄 Full JSON: \`${reportPath}\``);
const mdPath = resolve(REPORT_DIR, `deep-sqlite-audit-summary-${now}.md`);
writeFileSync(mdPath, md.join('\n'));

console.log('\n' + '='.repeat(80));
console.log('  DEEP DATABASE AUDIT COMPLETE');
console.log('='.repeat(80));
console.log(`\n🔴 CRITICAL:${audit.summary.critical} | 🟠 HIGH:${audit.summary.high} | 🟡 MEDIUM:${audit.summary.medium}`);
console.log(`💰 AT-RISK: $${audit.summary.totalSuspectAmount.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`);
console.log(`🛑 QUARANTINED: ${audit.summary.quarantined}`);
console.log(`\n📄 JSON: ${reportPath}`);
console.log(`📑 MD Summary: ${mdPath}`);
console.log('='.repeat(80));
