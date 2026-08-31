import { NextRequest, NextResponse } from 'next/server';
import { getActiveSLAStatus, getSupplierScorecards } from '@/lib/sla-engine';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const supplierId = searchParams.get('supplierId');

    const [active, scorecards] = await Promise.all([
      getActiveSLAStatus(),
      getSupplierScorecards(),
    ]);

    const filtered = supplierId ? active.filter(a => {
      const match = scorecards.find(s => s.supplierId === supplierId);
      return match && match.supplierName === a.supplierName;
    }) : active;

    const supplierPOs = supplierId
      ? await prisma.purchaseOrder.findMany({
          where: { supplierId },
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];

    return NextResponse.json({ active: filtered, scorecards, supplierPOs });
  } catch (err: unknown) {
    console.error('[SupplierPortal] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
