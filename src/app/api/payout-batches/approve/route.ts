import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * POST /api/payout-batches/approve
 *
 * 🚧 LAYER 1 (transport): requireOpsAuth — same-origin xor x-ops-secret, 401 sinon.
 * 🚧 LAYER 2 (rôle MIG3 payout_writer): PAYOUT_WRITER_SECRET header match,
 *    403 sinon (séparation des rôles: ops n'a pas droit payout writer).
 * ✅ Seulement les 2 layers passent → approvedBy identité vérifiée.
 *
 * (Référence: MIG3 REVOKE ALL 14 payout/owner tables sur sales_writer + marketing_agent;
 *  payout_writer role DB: full write sur tables PayoutBatch/PayoutItem seulement.)
 */
export async function POST(request: NextRequest) {
  // LAYER 1 — ops cross-origin gate
  const denied = requireOpsAuth(request)
  if (denied) return denied

  // LAYER 2 — payout_writer rôle gate (MIG3 séparation stricte)
  const payoutWriterSecret = process.env.PAYOUT_WRITER_SECRET
  const headerPayout = request.headers.get('x-payout-writer-secret')
  if (!payoutWriterSecret || !headerPayout) {
    return NextResponse.json(
      { ok: false, error: 'PAYOUT_WRITER_SECRET not configured or x-payout-writer-secret header missing (fail-closed MIG3 role gate).' },
      { status: 403 }
    )
  }
  const expectedBuf = Buffer.from(payoutWriterSecret, 'utf8')
  const gotBuf = Buffer.from(headerPayout, 'utf8')
  let payoutGateOk = false
  try {
    payoutGateOk = expectedBuf.length === gotBuf.length && timingSafeEqual(expectedBuf, gotBuf)
  } catch {
    payoutGateOk = false
  }
  if (!payoutGateOk) {
    return NextResponse.json(
      { ok: false, error: 'MIG3 payout_writer gate: secret mismatch (403)' },
      { status: 403 }
    )
  }

  const actor = resolveOpsIdentity(request)

  try {
    const { batchId } = await request.json();

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const batch = await db.payoutBatch.findUnique({ where: { id: batchId } });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    if (batch.status !== 'pending_approval') {
      return NextResponse.json(
        { error: 'Only pending_approval batches can be approved' },
        { status: 400 }
      );
    }

    const updatedBatch = await db.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: 'approved',
        approvedBy: actor,       // identité vérifiée (plus 'System Admin' littéral)
        approvedAt: new Date(),
      },
    });

    return NextResponse.json({ batch: updatedBatch, approvedBy: actor });
  } catch (error) {
    console.error('Approve batch API error:', error);
    return NextResponse.json({ error: 'Failed to approve batch' }, { status: 500 });
  }
}

function resolveOpsIdentity(request: NextRequest): string {
  const header = request.headers.get('x-ops-identity')
  if (header && header.trim().length >= 3) return header.trim().slice(0, 64)
  return 'payout-writer-secret-authenticated'
}
