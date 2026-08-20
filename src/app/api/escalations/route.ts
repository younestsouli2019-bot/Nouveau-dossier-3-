import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
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
}