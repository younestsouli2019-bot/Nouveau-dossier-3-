import { NextRequest, NextResponse } from 'next/server';
import { acknowledgePO } from '@/lib/sla-engine';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { acknowledgedBy } = body;

    if (!acknowledgedBy) {
      return NextResponse.json({ error: 'acknowledgedBy required' }, { status: 400 });
    }

    const result = await acknowledgePO(id, acknowledgedBy);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, poId: id, acknowledgedBy });
  } catch (err: unknown) {
    console.error('[PurchaseOrders/Ack] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
