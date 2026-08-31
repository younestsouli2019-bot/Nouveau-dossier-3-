import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      timestamp: Date.now(),
      db: 'connected',
      uptime: process.uptime(),
    });
  } catch (e: any) {
    console.error('[Heartbeat] Error:', e);
    return NextResponse.json({
      ok: false,
      timestamp: Date.now(),
      db: 'disconnected',
      error: 'Internal server error',
    }, { status: 503 });
  }
}
