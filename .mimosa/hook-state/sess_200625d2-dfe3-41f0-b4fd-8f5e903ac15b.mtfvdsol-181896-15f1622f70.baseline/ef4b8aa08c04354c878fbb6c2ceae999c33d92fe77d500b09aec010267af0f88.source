import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
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

    const updatedBatch = await db.payoutBatch.update({
      where: { id: batchId },
      data: { status: 'approved', approvedBy: 'System Admin' },
    });

    return NextResponse.json({ batch: updatedBatch });
  } catch (error) {
    console.error('Approve batch API error:', error);
    return NextResponse.json({ error: 'Failed to approve batch' }, { status: 500 });
  }
}