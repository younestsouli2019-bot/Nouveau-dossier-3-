/**
 * /api/maintenance/run — HTTP trigger for the bounded reconciliation pass.
 *
 * Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`. A GitHub
 * Actions cron can also POST with ORCHESTRATOR_RUN_TOKEN. Fail-closed: with
 * neither configured the endpoint refuses rather than running unauthenticated.
 */
import { NextResponse } from 'next/server';
import { executePass } from '@/lib/orchestrator/run';

export const dynamic = 'force-dynamic';

export function runAuth(header: string | null, tokens: { run?: string; cron?: string }): number {
  const accepted = [tokens.run, tokens.cron].filter(Boolean) as string[];
  if (!accepted.length) return 503;
  const presented = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!presented || !accepted.includes(presented)) return 401;
  return 200;
}

async function handle(request: Request) {
  const code = runAuth(request.headers.get('authorization'), {
    run: process.env.ORCHESTRATOR_RUN_TOKEN,
    cron: process.env.CRON_SECRET,
  });
  if (code === 503) {
    return NextResponse.json(
      { error: 'run_endpoint_not_configured', detail: 'Set CRON_SECRET or ORCHESTRATOR_RUN_TOKEN.' },
      { status: 503 },
    );
  }
  if (code === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ua = request.headers.get('user-agent') ?? '';
  const trigger = /vercel-cron/i.test(ua) ? 'vercel-cron' : 'http';
  const record = await executePass({ trigger, apply: false });
  return NextResponse.json(record, { status: 200, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
