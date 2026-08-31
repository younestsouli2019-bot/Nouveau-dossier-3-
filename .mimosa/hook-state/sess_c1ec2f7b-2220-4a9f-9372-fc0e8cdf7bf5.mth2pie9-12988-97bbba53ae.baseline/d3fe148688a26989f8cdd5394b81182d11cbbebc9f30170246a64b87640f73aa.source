import { NextRequest, NextResponse } from 'next/server';
import { scanSLABreaches, autoEscalateBreached, getActiveSLAStatus, getSupplierScorecards } from '@/lib/sla-engine';

export async function GET() {
  try {
    const [active, scorecards] = await Promise.all([
      getActiveSLAStatus(),
      getSupplierScorecards(),
    ]);
    return NextResponse.json({ active, scorecards });
  } catch (err: unknown) {
    console.error('[SLA/Status] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'scan') {
      const breaches = await scanSLABreaches();
      return NextResponse.json({ breaches, count: breaches.length });
    }

    if (action === 'auto-escalate') {
      const result = await autoEscalateBreached();
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'action must be "scan" or "auto-escalate"' }, { status: 400 });
  } catch (err: unknown) {
    console.error('[SLA/Status] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
