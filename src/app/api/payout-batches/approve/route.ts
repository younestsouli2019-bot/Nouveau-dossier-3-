import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request);
  if (denied) return denied;

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
      return NextResponse.json({ error: 'Only pending_approval batches can be approved' }, { status: 400 });
    }

    const actor = resolveOpsIdentity(request);

    const updatedBatch = await db.payoutBatch.update({
      where: { id: batchId },
      data: { status: 'approved', approvedBy: actor },
    });

    return NextResponse.json({ batch: updatedBatch, approvedBy: actor });
  } catch (error) {
    console.error('Approve batch API error:', error);
    return NextResponse.json({ error: 'Failed to approve batch' }, { status: 500 });
  }
}

function resolveOpsIdentity(request: NextRequest): string {
  const header = request.headers.get('x-ops-identity');
  if (header && header.trim().length >= 3) return header.trim().slice(0, 64);
  const opsSecret = request.headers.get('x-ops-secret');
  if (opsSecret) return 'ops-secret-authenticated';
  return 'same-origin-operator';
}