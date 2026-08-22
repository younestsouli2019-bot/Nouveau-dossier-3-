import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const escalations = await db.paymentEscalation.findMany({
      orderBy: { escalatedAt: 'desc' },
    });

  // Summary stats
  const total = escalations.length;
  const totalAmount = escalations.reduce((s, e) => s + e.amount, 0);
  const open = escalations.filter(e => e.status === 'open').length;
  const investigating = escalations.filter(e => e.status === 'investigating').length;
  const resolved = escalations.filter(e => e.status === 'resolved').length;
  const byProvider: Record<string, { count: number; amount: number }> = {};
  const bySeverity: Record<string, number> = {};
  for (const e of escalations) {
    byProvider[e.provider] = byProvider[e.provider] || { count: 0, amount: 0 };
    byProvider[e.provider].count++;
    byProvider[e.provider].amount += e.amount;
    bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
  }

  return NextResponse.json({
    escalations,
    summary: { total, totalAmount, open, investigating, resolved, byProvider, bySeverity },
  });
  } catch (error) {
    console.error('Escalations API error:', error);
    return NextResponse.json(
      {
        escalations: [],
        summary: { total: 0, totalAmount: 0, open: 0, investigating: 0, resolved: 0, byProvider: {}, bySeverity: {} },
      },
      { status: 200 },
    );
  }
}