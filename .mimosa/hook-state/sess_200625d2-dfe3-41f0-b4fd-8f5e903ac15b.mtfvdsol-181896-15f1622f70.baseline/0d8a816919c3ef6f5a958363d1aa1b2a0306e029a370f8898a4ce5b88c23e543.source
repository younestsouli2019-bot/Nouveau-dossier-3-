import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const logs = await db.payoutAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Audit log error:', error);
    return NextResponse.json({ error: 'Failed to load audit log' }, { status: 500 });
  }
}