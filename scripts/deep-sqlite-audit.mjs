// ——— DEEP SQLITE DATABASE AUDIT — Full Ledger Reconciliation ———
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(ROOT, 'workspace-52b995fb-7bc4-47b5-8597-83766cbf7229/db/custom.db');
const QUARANTINE_DIR = resolve(ROOT, 'data', 'quarantine');
const REPORT_DIR = resolve(ROOT, 'reports');

const CANONICAL = {
  paypalEmails: ['younestsouli2019@gmail.com'],
  payoneerEmails: ['younestsouli2019@gmail.com'],
  cryptoAddresses: [
    '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
    '0xa46225a984e2b2b5e5082e52ae8d8915a09fefe7',
  ],
  bankRIBs: ['007810000448500030594182'],
  bankAccountNums: ['0004485000305941'],
  ibans: ['LU774080000041265646'],
  swiftBICs: ['BCIRLULL'],
  bankNames: ['Banking Circle S.A.', 'Attijariwafa Bank', 'Banque Populaire', 'Citibank', 'Barclays', 'MUFG'],
  beneficiaryNames: ['Mr Younes Tsouli', 'Younes Tsouli', 'Mrs Hind Tsouli', 'M Bachir Tsouli'],
};

const PATTERNS = {
  HEX: /^[a-f0-9]{16,128}$/i,
  EXT_REF: /^[a-zA-Z0-9\-_:.]{6,}$/,
  PAYPAL_TXN: /^[0-9A-Z]{17}$/,
  ETH_TX: /^0x[a-fA-F0-9]{64}$/,
  ETH_ADDR: /^0x[a-fA-F0-9]{40}$/,
  IBAN: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/,
  SWIFT: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
  RIB: /^[0-9]{23}$/,
  FAKE: [/^fake/i, /^mock/i, /^test/i, /^demo/i, /^placeholder/i, /^xxx/i, /^0{6,}$/, /^1{6,}$/, /sample/i, /not.*real/i],
};

const audit = {
  timestamp: new Date().toISOString(),
  summary: { totalAudited: 0, critical: 0, high: 0, medium: 0, totalSuspectAmount: 0, quarantined: 0 },
  findings: [],
  quarantined: [],
  tables: {},
};

function addFinding({ type, entity, entityId, severity, rule, description, amount, evidence }) {
  audit.findings.push({ type, entity, entityId, severity, rule, description, amount: amount || 0, evidence: evidence || null, ts: new Date().toISOString() });
  audit.summary[severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : 'medium']++;
  if (amount) audit.summary.totalSuspectAmount += amount;
}
function quarantined({ entity, entityId, reason, data }) {
  const entry = { entity, entityId, reason, data: data || null, at: new Date().toISOString() };
  audit.quarantined.push(entry);
  audit.summary.quarantined++;
  const safe = `${entity}_${String(entityId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
  try { writeFileSync(resolve(QUARANTINE_DIR, `db_${Date.now()}_${safe}`), JSON.stringify(entry, null, 2)); } catch {}
}
function isFake(ref, label) {
  if (!ref || typeof ref !== 'string') return { fake: true, reason: `${label} null/empty` };
  if (ref.trim().length < 6) return { fake: true, reason: `${label} too short (${ref.length}): "${ref.slice(0,30)}"` };
  for (const p of PATTERNS.FAKE) if (p.test(ref)) return { fake: true, reason: `${label} matches ${p}: "${ref.slice(0,50)}"` };
  return { fake: false };
}
function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

console.log('='.repeat(80));
console.log('  DEEP SQLITE DATABASE AUDIT — Full Ledger Reconciliation');
console.log('='.repeat(80));
console.log(`[DB] ${DB_PATH}`);
console.log(`[DB] Exists: ${existsSync(DB_PATH)}`);
if (!existsSync(DB_PATH)) { console.error('[FATAL] DB not found'); process.exit(1); }

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

function getTables() {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return rows.map(r => r.name);
}
function countRows(table) { try { return db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get().c; } catch { return 0; } }

const tables = getTables();
console.log(`\n[DB] Found ${tables.length} tables:`);
for (const t of tables) {
  const c = countRows(t);
  audit.tables[t] = c;
  audit.summary.totalAudited += c;
  console.log(`  - ${t}: ${c} rows`);
}

// ============================================
// 1. REVENUE EVENTS
// ============================================
console.log('\n>>> 1. REVENUE EVENTS AUDIT');
if (tables.includes('RevenueEvent')) {
  const revs = db.prepare('SELECT * FROM RevenueEvent').all();
  const seenKeys = new Map();
  for (const r of revs) {
    // REV-001: verified without proof
    if (r.status === 'verified' && (!r.proofHash || !PATTERNS.HEX.test(r.proofHash))) {
      addFinding({ type: 'revenue_missing_proof', entity: 'RevenueEvent', entityId: r.id, severity: r.amount > 500 ? 'critical' : 'high', rule: 'REV-001 (TRUTH-003)',
        description: `RevenueEvent id=${r.id} $${r.amount} status=verified but proofHash invalid/missing (type=${r.proofType || 'none'})`,
        amount: r.amount, evidence: { proofHash: r.proofHash?.slice(0,20) || null, proofType: r.proofType } });
      if (r.amount > 1000) quarantined({ entity: 'RevenueEvent', entityId: r.id, reason: 'Verified revenue without cryptographic proof', data: r });
    }
    // REV-002: fabricated (status verified but dataSource internal only, no batch link)
    if (r.status === 'verified' && !r.payoutBatchId && !r.referenceId && r.amount > 100) {
      addFinding({ type: 'revenue_unbacked', entity: 'RevenueEvent', entityId: r.id, severity: 'high', rule: 'REV-002',
        description: `RevenueEvent $${r.amount} verified but NO referenceId, NO payoutBatchId — potentially unbacked/fabricated`,
        amount: r.amount, evidence: { source: r.source, referenceId: r.referenceId, payoutBatchId: r.payoutBatchId } });
    }
    // REV-003: duplicate (same source + amount + same-day)
    const k = `${r.amount}|${r.source}|${r.createdAt?.slice(0,10) || 'nodate'}`;
    if (seenKeys.has(k)) {
      const prev = seenKeys.get(k);
      addFinding({ type: 'revenue_duplicate', entity: 'RevenueEvent', entityId: r.id, severity: r.amount > 200 ? 'critical' : 'high', rule: 'REV-003',
        description: `DUPLICATE revenue $${r.amount} from ${r.source} — matches ${prev.id} (same day same amount same source)`,
        amount: r.amount, evidence: { duplicateOf: prev.id } });
      quarantined({ entity: 'RevenueEvent', entityId: r.id, reason: 'Duplicate revenue event', data: r });
    } else seenKeys.set(k, { id: r.id });
    // REV-004: batch integrity hash check
    if (r.status === 'verified' && r.batchIntegrityHash && !PATTERNS.HEX.test(r.batchIntegrityHash)) {
      addFinding({ type: 'bad_batch_hash', entity: 'RevenueEvent', entityId: r.id, severity: 'medium', rule: 'REV-004',
        description: `batchIntegrityHash format invalid: ${r.batchIntegrityHash?.slice(0,30)}`,
        evidence: { hash: r.batchIntegrityHash } });
    }
    // REV-005: rejected without reason
    if (r.status === 'rejected' && !r.rejectedReason) {
      addFinding({ type: 'rejected_no_reason', entity: 'RevenueEvent', entityId: r.id, severity: 'medium', rule: 'REV-005',
        description: `Revenue $${r.amount} rejected without rejectedReason`, amount: r.amount });
    }
  }
  console.log(`  - Total: ${revs.length} | Pending: ${revs.filter(r=>r.status==='pending').length} | Verified: ${revs.filter(r=>r.status==='verified').length} | Rejected: ${revs.filter(r=>r.status==='rejected').length}`);
  const sum = revs.reduce((s,r) => s + (r.status !== 'rejected' ? r.amount : 0), 0);
  console.log(`  - Total non-rejected amount: $${sum.toFixed(2)}`);
}

// ============================================
// 2. OWNER SETTLEMENTS
// ============================================
console.log('\n>>> 2. OWNER SETTLEMENTS AUDIT');
if (tables.includes('OwnerSettlement')) {
  const setts = db.prepare('SELECT s.*, a.label as accountLabel, a.accountType, a.accountNumber, a.walletAddress, a.paypalEmail, a.purposes as accountPurposes FROM OwnerSettlement s LEFT JOIN OwnerAccount a ON s.ownerAccountId = a.id').all();
  const buckets = new Map();
  for (const s of setts) {
    // OS-001: completed without externalRef (TRUTH-001)
    if (s.status === 'completed' && (!s.externalRef || !PATTERNS.EXT_REF.test(s.externalRef))) {
      addFinding({ type: 'completed_no_ref', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-001 (TRUTH-001)',
        description: `Settlement $${s.amount} id=${s.id} COMPLETED WITHOUT externalRef or ref invalid (dataSource=${s.dataSource})`,
        amount: s.amount, evidence: { externalRef: s.externalRef, dataSource: s.dataSource } });
      quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'TRUTH-001: Completed without valid externalRef', data: s });
    }
    // OS-002: completed + internal_ledger_only = FICTIONAL (TRUTH-002)
    if (s.status === 'completed' && s.dataSource === 'internal_ledger_only') {
      addFinding({ type: 'fictional_settlement', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-002 (TRUTH-002)',
        description: `FICTIONAL SETTLEMENT: $${s.amount} completed with dataSource='internal_ledger_only'. Funds NEVER left the system!`,
        amount: s.amount, evidence: { dataSource: s.dataSource, verifiedAt: s.verifiedAt } });
      quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'TRUTH-002: Fictional completed settlement (internal ledger only)', data: s });
    }
    // OS-003: completed but verifiedAt null
    if (s.status === 'completed' && !s.verifiedAt) {
      addFinding({ type: 'completed_unverified', entity: 'OwnerSettlement', entityId: s.id, severity: 'high', rule: 'OS-003',
        description: `Settlement $${s.amount} completed but verifiedAt is NULL — not externally validated`,
        amount: s.amount });
    }
    // OS-004: Misrouted — crypto/PayPal/bank destination not in canonical owner list
    const destLabel = (s.destinationLabel || s.externalRef || '').toString();
    if (s.accountType === 'l2_crypto' && s.walletAddress) {
      const inCanon = CANONICAL.cryptoAddresses.some(a => a.toLowerCase() === s.walletAddress.toLowerCase());
      if (!inCanon) {
        addFinding({ type: 'misrouted_crypto', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-004a',
          description: `MISROUTED CRYPTO: $${s.amount} settled to ${s.walletAddress.slice(0,10)}... not in canonical owner wallets`,
          amount: s.amount, evidence: { wallet: s.walletAddress, account: s.accountLabel } });
        quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'MISROUTED: Crypto to non-owner wallet', data: s });
      }
    }
    if (s.accountType === 'paypal' && s.paypalEmail) {
      const inCanon = CANONICAL.paypalEmails.includes(s.paypalEmail.toLowerCase());
      if (!inCanon) {
        addFinding({ type: 'misrouted_paypal', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-004b',
          description: `MISROUTED PAYPAL: $${s.amount} settled to ${s.paypalEmail} not in canonical owner emails`,
          amount: s.amount, evidence: { paypalEmail: s.paypalEmail } });
        quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'MISROUTED: PayPal to non-owner email', data: s });
      }
    }
    if (s.accountType === 'bank_wire' && s.accountNumber) {
      const matches = CANONICAL.bankAccountNums.some(n => s.accountNumber.includes(n.slice(-6))) ||
        CANONICAL.bankRIBs.some(r => r.includes(s.accountNumber.slice(-6)));
      if (!matches && s.amount > 50) {
        addFinding({ type: 'misrouted_bank', entity: 'OwnerSettlement', entityId: s.id, severity: 'high', rule: 'OS-004c',
          description: `POSSIBLY MISROUTED BANK: $${s.amount} to account ${s.accountNumber.slice(0,4)}...${s.accountNumber.slice(-4)} — not matching canonical owner RIBs`,
          amount: s.amount, evidence: { accountNumber: s.accountNumber, accountLabel: s.accountLabel } });
      }
    }
    // OS-005: reference format mismatch by type
    const fake = isFake(s.externalRef, 'OwnerSettlement.externalRef');
    if (s.status === 'completed' && s.externalRef && fake.fake) {
      addFinding({ type: 'fake_ref', entity: 'OwnerSettlement', entityId: s.id, severity: 'critical', rule: 'OS-005',
        description: `FAKE externalRef on completed $${s.amount}: ${fake.reason}`,
        amount: s.amount, evidence: { externalRef: s.externalRef?.slice(0,50) } });
      quarantined({ entity: 'OwnerSettlement', entityId: s.id, reason: 'FAKE externalRef on completed settlement', data: s });
    }
    // OS-006: account purpose mismatch
    if (s.purpose && s.accountPurposes) {
      const purps = s.accountPurposes.split(',').map(p => p.trim());
      if (!purps.includes(s.purpose) && !purps.includes('general') && purps.length > 0) {
        addFinding({ type: 'purpose_mismatch', entity: 'OwnerSettlement', entityId: s.id, severity: 'high', rule: 'OS-006',
          description: `Settlement purpose '${s.purpose}' doesn't match account purposes [${s.accountPurposes}] on ${s.accountLabel}`,
          amount: s.amount });
      }
    }
    // Bucket for cannibalism detection
    const bk = `${s.amount}|${s.direction}|${s.ownerAccountId}|${s.createdAt?.slice(0,13) || ''}`;
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk).push(s);
  }
  // Cannibalistic competition: >2 identical settlements same hour
  for (const [k, grp] of buckets) {
    if (grp.length >= 3 && grp[0].amount > 50) {
      for (let i = 1; i < grp.length; i++) {
        addFinding({ type: 'cannibalistic_settlement', entity: 'OwnerSettlement', entityId: grp[i].id, severity: 'critical', rule: 'OS-CANNIBAL',
          description: `CANNIBALISTIC: ${grp.length}x $${grp[0].amount} settlements within 1hr to same account — INTERNAL FRONT-RUNNING (${i+1}/${grp.length})`,
          amount: grp[i].amount, evidence: { groupSize: grp.length, firstId: grp[0].id } });
        quarantined({ entity: 'OwnerSettlement', entityId: grp[i].id, reason: `CANNIBALISTIC #${i+1}/${grp.length} — duplicate settlement cluster`, data: grp[i] });
      }
    }
  }
  console.log(`  - Total: ${setts.length} | Completed: ${setts.filter(s=>s.status==='completed').length} | Pending: ${setts.filter(s=>s.status==='pending').length}`);
  const totalSettled = setts.filter(s => s.status === 'completed').reduce((s,x) => s + x.amount, 0);
  console.log(`  - Total completed: $${totalSettled.toFixed(2)}`);
}

// ============================================
// 3. OWNER ACCOUNTS & PAYMENTS ROUTING
// ============================================
console.log('\n>>> 3. OWNER ACCOUNTS + PAYMENTS ROUTING AUDIT');
if (tables.includes('OwnerAccount')) {
  const accts = db.prepare('SELECT * FROM OwnerAccount').all();
  for (const a of accts) {
    if (!a.isActive) continue;
    if (a.accountType === 'l2_crypto' && a.walletAddress) {
      const inCan = CANONICAL.cryptoAddresses.some(x => x.toLowerCase() === a.walletAddress.toLowerCase());
      if (!inCan) {
        addFinding({ type: 'non_owner_crypto_account', entity: 'OwnerAccount', entityId: a.id, severity: 'critical', rule: 'OA-001',
          description: `ACTIVE OwnerAccount '${a.label}' has wallet ${a.walletAddress.slice(0,10)}... NOT in canonical owner wallet list — RISK of automatic misrouting!`,
          amount: a.totalReceived || 0, evidence: { label: a.label, wallet: a.walletAddress, totalReceived: a.totalReceived } });
        quarantined({ entity: 'OwnerAccount', entityId: a.id, reason: 'ACTIVE: Non-canonical crypto wallet registered as owner account', data: a });
      }
    }
    if (a.accountType === 'paypal' && a.paypalEmail) {
      const inCan = CANONICAL.paypalEmails.includes(a.paypalEmail.toLowerCase()) || CANONICAL.payoneerEmails.includes(a.paypalEmail.toLowerCase());
      if (!inCan) {
        addFinding({ type: 'non_owner_paypal_account', entity: 'OwnerAccount', entityId: a.id, severity: 'high', rule: 'OA-002',
          description: `ACTIVE OwnerAccount '${a.label}' has PayPal email ${a.paypalEmail} NOT in canonical list`,
          evidence: { paypalEmail: a.paypalEmail } });
      }
    }
  }
  console.log(`  - OwnerAccounts: ${accts.length} (Active: ${accts.filter(a=>a.isActive).length})`);
}
if (tables.includes('OwnerPayment')) {
  const pays = db.prepare('SELECT * FROM OwnerPayment').all();
  for (const p of pays) {
    if (!p.recovered && (p.status === 'routed' || p.status === 'completed' || p.status === 'processing')) {
      if (p.ribNumber) {
        const fake = isFake(p.ribNumber, 'OwnerPayment RIB');
        if (fake.fake && p.amount > 50) {
          addFinding({ type: 'owner_payment_fake_rib', entity: 'OwnerPayment', entityId: p.id, severity: 'critical', rule: 'OP-001',
            description: `OwnerPayment $${p.amount} id=${p.id} has FAKE RIB/account: ${fake.reason}`,
            amount: p.amount, evidence: { rib: p.ribNumber?.slice(0,30) } });
          quarantined({ entity: 'OwnerPayment', entityId: p.id, reason: 'FAKE RIB: non-recoverable without manual reversal', data: p });
        }
        // Routing check
        const matches = CANONICAL.bankRIBs.some(r => r.includes(String(p.ribNumber).slice(-6))) ||
          CANONICAL.ibans.some(i => i.includes(String(p.ribNumber).slice(-6)));
        if (!matches && !p.recovered && p.amount > 200) {
          addFinding({ type: 'owner_payment_unknown_rib', entity: 'OwnerPayment', entityId: p.id, severity: 'high', rule: 'OP-002',
            description: `OwnerPayment $${p.amount} routed to RIB ${String(p.ribNumber).slice(0,4)}...${String(p.ribNumber).slice(-4)} NOT matching canonical owner accounts — NOT RECOVERED`,
            amount: p.amount });
        }
      }
    }
  }
  console.log(`  - OwnerPayments: ${pays.length} | Recovered: ${pays.filter(p=>p.recovered).length}`);
}

// ============================================
// 4. CRYPTO SETTLEMENTS
// ============================================
console.log('\n>>> 4. CRYPTO SETTLEMENTS AUDIT');
if (tables.includes('CryptoSettlement')) {
  const cs = db.prepare('SELECT * FROM CryptoSettlement').all();
  for (const c of cs) {
    // CS-001: txHash format
    if (c.txHash && !PATTERNS.ETH_TX.test(c.txHash)) {
      const fake = isFake(c.txHash, 'CryptoSettlement.txHash');
      if (fake.fake || !c.txHash.startsWith('0x') || c.txHash.length !== 66) {
        addFinding({ type: 'fake_crypto_tx', entity: 'CryptoSettlement', entityId: c.id, severity: 'critical', rule: 'CS-001',
          description: `FAKE/MALFORMED txHash on CryptoSettlement $${c.amount} ${c.token}: ${fake.fake ? fake.reason : 'length=' + c.txHash.length}`,
          amount: c.amount, evidence: { txHash: c.txHash?.slice(0, 40) } });
        quarantined({ entity: 'CryptoSettlement', entityId: c.id, reason: 'FAKE txHash: transaction does not exist on any chain', data: c });
      }
    }
    // CS-002: recipient not owner + misplaced = true + NOT recovered
    if (c.status === 'confirmed' && !c.recovered && (c.misplaced === true || c.isOwner === false)) {
      if (c.recipientAddress) {
        const inCan = CANONICAL.cryptoAddresses.some(a => a.toLowerCase() === c.recipientAddress.toLowerCase());
        if (!inCan) {
          addFinding({ type: 'misplaced_crypto', entity: 'CryptoSettlement', entityId: c.id, severity: 'critical', rule: 'CS-002',
            description: `MISROUTED CRYPTO (UNRECOVERED): $${c.amount} ${c.token} on ${c.network} → ${c.recipientAddress.slice(0,10)}...${c.recipientAddress.slice(-6)} | misplaced=${c.misplaced} isOwner=${c.isOwner} recovered=${c.recovered}`,
            amount: c.amount, evidence: { recipient: c.recipientAddress, network: c.network, token: c.token } });
          quarantined({ entity: 'CryptoSettlement', entityId: c.id, reason: 'LOSS: Crypto misrouted + NOT recovered — funds may be permanently lost', data: c });
        }
      }
    }
    // CS-003: confirmed but recipientAddress NULL
    if (c.status === 'confirmed' && !c.recipientAddress && c.type !== 'approve') {
      addFinding({ type: 'confirmed_no_recipient', entity: 'CryptoSettlement', entityId: c.id, severity: 'high', rule: 'CS-003',
        description: `CryptoSettlement $${c.amount} confirmed but recipientAddress is NULL — untraceable destination`,
        amount: c.amount });
    }
  }
  const confirmedSum = cs.filter(c=>c.status==='confirmed').reduce((s,x)=>s+x.amount,0);
  const misplacedSum = cs.filter(c=>c.misplaced===true && !c.recovered).reduce((s,x)=>s+x.amount,0);
  console.log(`  - Total: ${cs.length} | Confirmed: ${cs.filter(c=>c.status==='confirmed').length} | Misplaced & Unrecovered: ${cs.filter(c=>c.misplaced===true && !c.recovered).length} ($${misplacedSum.toFixed(2)})`);
  console.log(`  - Total confirmed value: $${confirmedSum.toFixed(2)}`);
}

// ============================================
// 5. PAYOUT BATCHES + ITEMS
// ============================================
console.log('\n>>> 5. PAYOUT BATCHES + ITEMS AUDIT');
if (tables.includes('PayoutBatch')) {
  const batches = db.prepare('SELECT * FROM PayoutBatch').all();
  const seen = new Map();
  for (const b of batches) {
    // PB-001: completed without provider ref
    if (b.status === 'completed' && (!b.providerBatchRef || !PATTERNS.EXT_REF.test(b.providerBatchRef))) {
      addFinding({ type: 'completed_no_provider', entity: 'PayoutBatch', entityId: b.id, severity: 'critical', rule: 'PB-001 (TRUTH-004)',
        description: `PayoutBatch ${b.batchNumber} $${b.totalAmount} COMPLETED WITHOUT valid providerBatchRef — disbursement NEVER happened externally!`,
        amount: b.totalAmount, evidence: { providerBatchRef: b.providerBatchRef, paymentProvider: b.paymentProvider } });
      quarantined({ entity: 'PayoutBatch', entityId: b.id, reason: 'TRUTH-004: Completed batch without provider ref', data: b });
    }
    // PB-002: submitted without provider
    if (b.status === 'submitted' && (!b.providerBatchRef || !b.paymentProvider)) {
      addFinding({ type: 'submitted_no_provider', entity: 'PayoutBatch', entityId: b.id, severity: 'high', rule: 'PB-002 (TRUTH-009)',
        description: `PayoutBatch ${b.batchNumber} $${b.totalAmount} submitted without providerBatchRef (${b.providerBatchRef || 'null'}) or paymentProvider (${b.paymentProvider || 'null'})`,
        amount: b.totalAmount });
    }
    // PB-003: completed without proofHash
    if (b.status === 'completed' && !b.proofHash) {
      addFinding({ type: 'completed_no_proof', entity: 'PayoutBatch', entityId: b.id, severity: 'high', rule: 'PB-003',
        description: `PayoutBatch ${b.batchNumber} completed but proofHash NULL — no integrity evidence`,
        amount: b.totalAmount });
    }
    // PB-004: Duplicate batchNumber
    const k = `${b.batchNumber}|${b.totalAmount}`;
    if (seen.has(k)) {
      addFinding({ type: 'duplicate_batch_number', entity: 'PayoutBatch', entityId: b.id, severity: 'critical', rule: 'PB-004',
        description: `DUPLICATE batchNumber ${b.batchNumber} $${b.totalAmount} — ${b.id} vs ${seen.get(k).id}. 2x same batch disbursed?`,
        amount: b.totalAmount, evidence: { duplicateOf: seen.get(k).id } });
      quarantined({ entity: 'PayoutBatch', entityId: b.id, reason: 'DUPLICATE batch number — double disbursement risk', data: b });
    } else seen.set(k, { id: b.id });
    // PB-005: integrity hash mismatch
    if (b.settlementIntegrityHash && !PATTERNS.HEX.test(b.settlementIntegrityHash)) {
      addFinding({ type: 'bad_integrity_hash', entity: 'PayoutBatch', entityId: b.id, severity: 'medium', rule: 'PB-005',
        description: `settlementIntegrityHash format invalid on ${b.batchNumber}`, evidence: { hash: b.settlementIntegrityHash?.slice(0,30) } });
    }
    // PB-006: fake provider ref
    if (b.providerBatchRef) {
      const fake = isFake(b.providerBatchRef, 'PayoutBatch.providerBatchRef');
      if (fake.fake) {
        addFinding({ type: 'fake_provider_ref', entity: 'PayoutBatch', entityId: b.id, severity: 'critical', rule: 'PB-006',
          description: `FABRICATED providerBatchRef on ${b.batchNumber}: ${fake.reason}`,
          amount: b.totalAmount });
        quarantined({ entity: 'PayoutBatch', entityId: b.id, reason: 'FABRICATED: provider ref is fake/test pattern', data: b });
      }
    }
  }
  console.log(`  - PayoutBatches: ${batches.length} | Completed: ${batches.filter(b=>b.status==='completed').length} | Submitted: ${batches.filter(b=>b.status==='submitted').length}`);
  const totalDisbursed = batches.filter(b=>b.status==='completed').reduce((s,x)=>s+x.totalAmount,0);
  console.log(`  - Total completed disbursement: $${totalDisbursed.toFixed(2)}`);
}
if (tables.includes('PayoutItem')) {
  const items = db.prepare('SELECT * FROM PayoutItem').all();
  const dupMap = new Map();
  for (const it of items) {
    // PI-001: completed without transactionRef
    if (it.status === 'completed' && (!it.transactionRef || !PATTERNS.EXT_REF.test(it.transactionRef))) {
      addFinding({ type: 'item_no_ref', entity: 'PayoutItem', entityId: it.id, severity: 'high', rule: 'PI-001',
        description: `PayoutItem $${it.amount} to ${it.recipientName} <${it.recipientEmail}> completed without transactionRef — no proof of send`,
        amount: it.amount, evidence: { batch: it.batchNumber, recipient: it.recipientEmail } });
    }
    // PI-002: delivery confirmed but transaction missing
    if (it.deliveryConfirmed && !it.deliveryConfirmedAt) {
      addFinding({ type: 'delivery_no_ts', entity: 'PayoutItem', entityId: it.id, severity: 'medium', rule: 'PI-002',
        description: `PayoutItem deliveryConfirmed=true but deliveryConfirmedAt null`,
        amount: it.amount });
    }
    // PI-003: duplicate detection (same recipient + amount + same day)
    const k = `${it.recipientEmail}|${it.amount}|${it.createdAt?.slice(0,10)}`;
    if (dupMap.has(k)) {
      const prev = dupMap.get(k);
      if (it.status !== 'failed' && prev.status !== 'failed') {
        addFinding({ type: 'duplicate_item', entity: 'PayoutItem', entityId: it.id, severity: it.amount > 200 ? 'critical' : 'high', rule: 'PI-003',
          description: `DUPLICATE payout item $${it.amount} to ${it.recipientEmail} (${it.batchNumber}) — matches ${prev.id} (${prev.batchNumber})`,
          amount: it.amount, evidence: { duplicateOf: prev.id } });
        quarantined({ entity: 'PayoutItem', entityId: it.id, reason: 'DUPLICATE payout item', data: it });
      }
    } else dupMap.set(k, it);
    // PI-004: fake transaction ref
    if (it.transactionRef) {
      const fake = isFake(it.transactionRef, 'PayoutItem.transactionRef');
      if (fake.fake && it.status === 'completed') {
        addFinding({ type: 'fake_item_ref', entity: 'PayoutItem', entityId: it.id, severity: 'critical', rule: 'PI-004',
          description: `FAKE transactionRef on completed payout $${it.amount} to ${it.recipientEmail}: ${fake.reason}`,
          amount: it.amount });
        quarantined({ entity: 'PayoutItem', entityId: it.id, reason: 'FABRICATED: payout completed with fake tx ref', data: it });
      }
    }
  }
  console.log(`  - PayoutItems: ${items.length} | Completed: ${items.filter(i=>i.status==='completed').length} | Failed: ${items.filter(i=>i.status==='failed').length}`);
}

// ============================================
// 6. PROCUREMENT STATE MACHINE
// ============================================
console.log('\n>>> 6. PROCUREMENT STATE MACHINE AUDIT');
const procStates = ['pending','ordered','shipped','delivered','cancelled','returned'];
const poStates = ['draft','submitted','pending_approval','approved','partially_ordered','ordered','completed','rejected','cancelled'];
const shipStates = ['pending','label_created','picked_up','in_transit','customs','out_for_delivery','delivered','failed','returned'];

if (tables.includes('ProcurementItem')) {
  const items = db.prepare('SELECT * FROM ProcurementItem').all();
  for (const p of items) {
    // PR-001: invalid state
    if (p.status && !procStates.includes(p.status)) {
      addFinding({ type: 'invalid_state', entity: 'ProcurementItem', entityId: p.id, severity: 'medium', rule: 'PR-001',
        description: `ProcurementItem '${p.name}' has invalid status '${p.status}'`, evidence: { status: p.status } });
    }
    // PR-002: ordered without orderRef/supplierName (TRUTH-007)
    if (p.status === 'ordered' && (!p.orderRef || !p.supplierName)) {
      addFinding({ type: 'ordered_no_ref', entity: 'ProcurementItem', entityId: p.id, severity: 'high', rule: 'PR-002 (TRUTH-007)',
        description: `ProcurementItem '${p.name}' ordered without orderRef (${p.orderRef || 'null'}) or supplierName (${p.supplierName || 'null'})`,
        amount: p.totalEst });
    }
    // PR-003: delivered without receiptConfirmedBy HUMAN (TRUTH-008)
    if (p.status === 'delivered' && (!p.receiptConfirmedBy || p.receiptConfirmedBy === 'system' || p.receiptConfirmedBy === 'wet-run-engine')) {
      addFinding({ type: 'delivered_no_human', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-003 (TRUTH-008)',
        description: `DELIVERED but confirmed by '${p.receiptConfirmedBy}' (NOT A HUMAN) — TRUTH-008 violation on '${p.name}'`,
        amount: p.totalEst, evidence: { confirmedBy: p.receiptConfirmedBy } });
      quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'TRUTH-008: Delivered without human receipt confirmation', data: p });
    }
    // PR-004: receipt confirmed without deliveryProofHash (TRUTH-005)
    if (p.receiptConfirmedAt && (!p.deliveryProofHash || !PATTERNS.HEX.test(p.deliveryProofHash))) {
      addFinding({ type: 'no_delivery_proof', entity: 'ProcurementItem', entityId: p.id, severity: 'high', rule: 'PR-004 (TRUTH-005)',
        description: `Receipt confirmed without valid deliveryProofHash (${p.deliveryProofHash?.slice(0,20) || 'null'}) — TRUTH-005 violation on '${p.name}'`,
        amount: p.totalEst });
    }
    // PR-005: chronology violation — delivered before shipped
    if (p.deliveredAt && p.shippedAt && new Date(p.deliveredAt) < new Date(p.shippedAt)) {
      addFinding({ type: 'chrono_violation', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-005',
        description: `CHRONOLOGY VIOLATION: '${p.name}' deliveredAt BEFORE shippedAt — state machine falsified`,
        amount: p.totalEst, evidence: { shippedAt: p.shippedAt, deliveredAt: p.deliveredAt } });
      quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'FRAUD: Chronology violation — delivered before shipped', data: p });
    }
    // PR-006: chronology — shipped before ordered
    if (p.shippedAt && p.orderedAt && new Date(p.shippedAt) < new Date(p.orderedAt)) {
      addFinding({ type: 'chrono_violation2', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-006',
        description: `CHRONOLOGY VIOLATION: '${p.name}' shippedAt BEFORE orderedAt — state machine falsified`,
        amount: p.totalEst });
      quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'FRAUD: Chronology violation — shipped before ordered', data: p });
    }
    // PR-007: quantity mismatch
    if (p.quantityReceived !== null && p.quantityReceived !== undefined && p.quantityReceived !== p.quantity) {
      addFinding({ type: 'qty_mismatch', entity: 'ProcurementItem', entityId: p.id, severity: p.quantityReceived < p.quantity ? 'high' : 'medium', rule: 'PR-007 (RWC-PROC-001)',
        description: `QTY MISMATCH: '${p.name}' ordered ${p.quantity}, received ${p.quantityReceived} — ${p.quantity > p.quantityReceived ? 'SHORT DELIVERY' : 'OVER DELIVERY'}`,
        amount: Math.abs(p.quantity - p.quantityReceived) * (p.unitPriceEst || 0),
        evidence: { ordered: p.quantity, received: p.quantityReceived } });
    }
    // PR-008: impossible order→delivery < 1hr
    if (p.orderedAt && p.deliveredAt) {
      const ms = new Date(p.deliveredAt) - new Date(p.orderedAt);
      if (ms > 0 && ms < 3600000) {
        addFinding({ type: 'impossible_fulfillment', entity: 'ProcurementItem', entityId: p.id, severity: 'critical', rule: 'PR-008',
          description: `IMPOSSIBLE FULFILLMENT: '${p.name}' ordered→delivered in ${Math.round(ms/60000)}min — state fabrication detected`,
          amount: p.totalEst, evidence: { orderedAt: p.orderedAt, deliveredAt: p.deliveredAt } });
        quarantined({ entity: 'ProcurementItem', entityId: p.id, reason: 'FRAUD: Physically impossible fulfillment timeline', data: p });
      }
    }
    // PR-009: prePaidBySwarm false but status=ordered
    if (!p.prePaidBySwarm && p.status === 'ordered' && p.totalEst > 100) {
      addFinding({ type: 'not_prepaid', entity: 'ProcurementItem', entityId: p.id, severity: 'medium', rule: 'PR-009',
        description: `'${p.name}' ordered but prePaidBySwarm=false (violation of DDP procurement policy: $${p.totalEst})`,
        amount: p.totalEst });
    }
  }
  console.log(`  - ProcurementItems: ${items.length} | Delivered: ${items.filter(p=>p.status==='delivered').length} | Ordered: ${items.filter(p=>p.status==='ordered').length}`);
}
if (tables.includes('PurchaseOrder')) {
  const pos = db.prepare('SELECT * FROM PurchaseOrder').all();
  for (const po of pos) {
    if (po.status && !poStates.includes(po.status)) {
      addFinding({ type: 'po_bad_state', entity: 'PurchaseOrder', entityId: po.id, severity: 'medium', rule: 'PO-001',
        description: `PO ${po.poNumber} invalid state '${po.status}'` });
    }
    // SLA breach
    if (po.status === 'submitted' && po.ackStatus === 'SLA_BREACHED' && po.approvedBy === null) {
      addFinding({ type: 'po_sla_breach', entity: 'PurchaseOrder', entityId: po.id, severity: 'high', rule: 'PO-002',
        description: `PO ${po.poNumber} $${po.totalAmount} SLA BREACHED: ackStatus=SLA_BREACHED, escalations=${po.escalationCount} — supplier not acknowledging`,
        amount: po.totalAmount });
    }
  }
  console.log(`  - PurchaseOrders: ${pos.length} | Approved: ${pos.filter(p=>p.status==='approved'||p.status==='ordered'||p.status==='completed').length} | Rejected: ${pos.filter(p=>p.status==='rejected').length}`);
}
if (tables.includes('Shipment')) {
  const ships = db.prepare('SELECT * FROM Shipment').all();
  for (const s of ships) {
    if (s.status && !shipStates.includes(s.status)) {
      addFinding({ type: 'ship_bad_state', entity: 'Shipment', entityId: s.id, severity: 'medium', rule: 'SH-001',
        description: `Shipment ${s.shipmentNumber} invalid state '${s.status}'` });
    }
    // delivered without actualDelivery
    if (s.status === 'delivered' && !s.actualDelivery) {
      addFinding({ type: 'ship_delivered_no_ts', entity: 'Shipment', entityId: s.id, severity: 'high', rule: 'SH-002',
        description: `Shipment ${s.shipmentNumber} '${s.itemName}' delivered but actualDelivery NULL — no delivery timestamp` });
    }
    // trackingVerified=true but trackingNumber null
    if (s.trackingVerified && !s.trackingNumber) {
      addFinding({ type: 'ship_verified_no_track', entity: 'Shipment', entityId: s.id, severity: 'critical', rule: 'SH-003',
        description: `Shipment ${s.shipmentNumber} trackingVerified=true but NO trackingNumber — verification FALSIFIED` });
      quarantined({ entity: 'Shipment', entityId: s.id, reason: 'FRAUD: trackingVerified=true with no tracking number', data: s });
    }
  }
  console.log(`  - Shipments: ${ships.length} | Delivered: ${ships.filter(s=>s.status==='delivered').length} | In Transit: ${ships.filter(s=>s.status==='in_transit').length}`);
}

// ============================================
// 7. LEDGER RECONCILIATION BALANCE CHECK
// ============================================
console.log('\n>>> 7. LEDGER BALANCE RECONCILIATION');
let totalRev = 0, totalSet = 0, totalPending = 0, totalDisbursed = 0, totalReject = 0;
if (tables.includes('RevenueEvent')) {
  const r = db.prepare("SELECT status, SUM(amount) as s, COUNT(*) as c FROM RevenueEvent GROUP BY status").all();
  for (const row of r) {
    if (row.status === 'rejected') totalReject += row.s || 0;
    else totalRev += row.s || 0;
    if (row.status === 'pending') totalPending += row.s || 0;
  }
}
if (tables.includes('OwnerSettlement')) {
  const r = db.prepare("SELECT status, SUM(amount) as s FROM OwnerSettlement WHERE direction='inbound' GROUP BY status").all();
  for (const row of r) {
    if (row.status === 'completed') totalSet += row.s || 0;
    if (row.status === 'pending' || row.status === 'processing') totalPending += row.s || 0;
  }
}
if (tables.includes('PayoutBatch')) {
  totalDisbursed = db.prepare("SELECT COALESCE(SUM(totalAmount),0) as s FROM PayoutBatch WHERE status IN ('completed','submitted')").get().s;
}
const delta = Math.round((totalRev - totalSet - totalDisbursed - totalReject) * 100) / 100;
console.log(`  - Total Revenue (non-rejected): $${totalRev.toFixed(2)}`);
console.log(`  - Total Settled (owner inbound): $${totalSet.toFixed(2)}`);
console.log(`  - Total Disbursed (payouts submitted+completed): $${totalDisbursed.toFixed(2)}`);
console.log(`  - Total Rejected Revenue: $${totalReject.toFixed(2)}`);
console.log(`  - BALANCE DELTA (Revenue - Settled - Disbursed - Rejected): $${delta.toFixed(2)} — ${Math.abs(delta) < 0.01 ? '✅ BALANCED' : Math.abs(delta) < 100 ? '⚠️  MINOR IMBALANCE' : '❌ CRITICAL IMBALANCE'}`);
if (Math.abs(delta) >= 100) {
  addFinding({ type: 'balance_delta', entity: 'Reconciliation', entityId: 'BALANCE-LEDGER', severity: Math.abs(delta) > 1000 ? 'critical' : 'high', rule: 'RECON-001 (TRUTH-RECONCILE-001)',
    description: `LEDGER IMBALANCE: Delta $${delta.toFixed(2)} | Revenue=$${totalRev.toFixed(2)} Settled=$${totalSet.toFixed(2)} Disbursed=$${totalDisbursed.toFixed(2)} Rejected=$${totalReject.toFixed(2)}`,
    amount: Math.abs(delta),
    evidence: { totalRev, totalSet, totalDisbursed, totalReject, delta } });
}

// ============================================
// 8. WRITE FINAL REPORT
// ============================================
db.close();

const reportPath = resolve(REPORT_DIR, `deep-sqlite-audit-${Date.now()}.json`);
writeFileSync(reportPath, JSON.stringify(audit, null, 2));

// Markdown summary
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
md.push(`| 🛑 QUARANTINED (this run) | **${audit.summary.quarantined}** |`);
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
md.push('\n---\n## 🛑 QUARANTINED ENTITIES (Loss Recovery)\n');
if (audit.quarantined.length === 0) md.push('_None quarantined in deep run._\n');
else {
  md.push('| # | Entity | ID | Reason |');
  md.push('|---|---|---|---|');
  audit.quarantined.forEach((q, i) => {
    md.push(`| ${i+1} | ${q.entity} | ${String(q.entityId).slice(0,30)}${String(q.entityId).length>30?'...':''} | ${q.reason.slice(0,90)} |`);
  });
}
md.push('\n---\n## 📊 TABLES AUDITED\n');
for (const [t, c] of Object.entries(audit.tables)) {
  md.push(`- ${t}: ${c} rows`);
}
md.push(`\n📄 Full JSON: \`${reportPath}\``);
const mdPath = resolve(REPORT_DIR, `deep-sqlite-audit-summary-${Date.now()}.md`);
writeFileSync(mdPath, md.join('\n'));

// Final console output
console.log('\n' + '='.repeat(80));
console.log('  DEEP AUDIT COMPLETE');
console.log('='.repeat(80));
console.log(`\n🔴 CRITICAL: ${audit.summary.critical}  |  🟠 HIGH: ${audit.summary.high}  |  🟡 MEDIUM: ${audit.summary.medium}`);
console.log(`💰 TOTAL AT-RISK: $${audit.summary.totalSuspectAmount.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`);
console.log(`🛑 QUARANTINED: ${audit.summary.quarantined}`);
console.log(`\n📄 JSON:   ${reportPath}`);
console.log(`📑 MD:     ${mdPath}`);
console.log('='.repeat(80));
