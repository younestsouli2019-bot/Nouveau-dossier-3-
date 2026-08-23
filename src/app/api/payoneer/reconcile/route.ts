import { NextRequest, NextResponse } from 'next/server';
import { reconcilePayoneer, resolveDiscrepancy, getPayoneerLinks } from '@/lib/payoneer-reconciliation';

export async function GET() {
  try {
    const report = await reconcilePayoneer();
    const links = getPayoneerLinks();
    return NextResponse.json({ report, links });
  } catch (err: unknown) {
    console.error('[Payoneer/Reconcile] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, bankName, notes } = body;

    if (action === 'resolve') {
      if (!bankName || !notes) {
        return NextResponse.json({ error: 'bankName and notes required' }, { status: 400 });
      }
      const result = await resolveDiscrepancy(bankName, notes);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'action must be "resolve"' }, { status: 400 });
  } catch (err: unknown) {
    console.error('[Payoneer/Reconcile] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
