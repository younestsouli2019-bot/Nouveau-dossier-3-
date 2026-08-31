import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    timestamp: Date.now(),
    uptime: process.uptime(),
    version: '3.0.0',
    status: 'healthy',
  });
}
