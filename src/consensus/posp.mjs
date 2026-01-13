import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function collectReceipts(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json'));
  for (const f of files) {
    const p = path.join(dir, f);
    const j = readJsonSafe(p);
    if (!j) continue;
    out.push({ file: p, data: j });
  }
  return out;
}

function withinWindow(tsIso, days) {
  if (!tsIso) return false;
  const ts = Date.parse(tsIso);
  if (Number.isNaN(ts)) return false;
  const now = Date.now();
  const delta = now - ts;
  return delta <= days * 24 * 60 * 60 * 1000;
}

export function calculatePosp({ agentId = 'local', windowDays = 30, minReceiptAmount = 1 } = {}) {
  const receiptsDir = path.resolve('settlements/payoneer/receipts');
  const receipts = collectReceipts(receiptsDir)
    .map(r => r.data)
    .filter(r => withinWindow(r?.created_at, windowDays))
    .filter(r => Number(r?.amount_total_usd || 0) >= minReceiptAmount);

  const txCount = receipts.reduce((s, r) => s + Number(r?.count || 0), 0);
  const revenueTotal = receipts.reduce((s, r) => s + Number(r?.amount_total_usd || 0), 0);
  const uniquePayers = new Set(
    receipts
      .map(r => String(r?.payer?.email || '').trim().toLowerCase())
      .filter(e => !!e)
  );

  const score = Math.round(txCount + revenueTotal / 100 + uniquePayers.size * 2);

  const basis = {
    agent_id: agentId,
    window_days: windowDays,
    tx_count: txCount,
    revenue_total_usd: Number(revenueTotal.toFixed(2)),
    unique_payers_count: uniquePayers.size,
    payer_emails_sample: Array.from(uniquePayers).slice(0, 5),
    receipts_sample: receipts.slice(0, 5).map(r => ({
      batch_id: r.batch_id,
      amount_total_usd: r.amount_total_usd,
      created_at: r.created_at,
      status: r.status
    }))
  };

  const hash = crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex');

  const proof = {
    type: 'posp.proof',
    created_at: new Date().toISOString(),
    agent_id: agentId,
    score,
    basis,
    proof_hash: hash
  };

  return proof;
}

export function enforcePosp(proof, { minScore = 5, minTx = 1 } = {}) {
  const ok = (proof?.score || 0) >= minScore && (proof?.basis?.tx_count || 0) >= minTx;
  return { ok, minScore, minTx, score: proof?.score || 0, txCount: proof?.basis?.tx_count || 0 };
}

export function writePospProof(proof, { dir = 'exports/posp-proofs' } = {}) {
  const outDir = path.resolve(dir);
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `posp_proof_${proof.agent_id}_${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(proof, null, 2));
  return filePath;
}

