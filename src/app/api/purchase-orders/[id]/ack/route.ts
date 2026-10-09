import { NextRequest, NextResponse } from 'next/server';
import { acknowledgePO } from '@/lib/sla-engine';
import { requireOpsAuth } from '@/lib/api-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireOpsAuth(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await request.json();
    const { acknowledgedBy } = body;

    if (!acknowledgedBy) {
      return NextResponse.json({ error: 'acknowledgedBy required' }, { status: 400 });
    }

    const actor = resolveOpsIdentity(request);

    const result = await acknowledgePO(id, actor || acknowledgedBy);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, poId: id, acknowledgedBy: actor || acknowledgedBy });
  } catch (err: unknown) {
    console.error('[PurchaseOrders/Ack] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function resolveOpsIdentity(request: NextRequest): string {
  const header = request.headers.get('x-ops-identity');
  if (header && header.trim().length >= 3) return header.trim().slice(0, 64);
  const opsSecret = request.headers.get('x-ops-secret');
  if (opsSecret) return 'ops-secret-authenticated';
  return 'same-origin-operator';
}
