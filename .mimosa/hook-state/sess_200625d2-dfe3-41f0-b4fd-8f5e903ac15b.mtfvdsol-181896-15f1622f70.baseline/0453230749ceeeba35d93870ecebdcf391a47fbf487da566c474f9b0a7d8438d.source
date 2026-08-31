import { NextRequest, NextResponse } from 'next/server';
import {
  saveCheckpoint, loadCheckpoint, heartbeat, recoverOrphanedWorkflows,
  completeCheckpoint, failCheckpoint, deleteCheckpoint,
} from '@/lib/swarm/state-checkpoint';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'status';
    const workflowId = url.searchParams.get('workflowId') || '';

    switch (action) {
      case 'status':
        return NextResponse.json({ ok: true, module: 'state-checkpoint', timestamp: Date.now() });

      case 'load':
        if (!workflowId) return NextResponse.json({ error: 'workflowId required' }, { status: 400 });
        const state = await loadCheckpoint(workflowId);
        return NextResponse.json({ ok: true, found: !!state, state });

      case 'recover':
        const orphaned = await recoverOrphanedWorkflows();
        return NextResponse.json({ ok: true, orphanedCount: orphaned.length, workflowIds: orphaned });

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    console.error('[Swarm Checkpoint] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, workflowId, state } = body;

    if (!action || !workflowId) {
      return NextResponse.json({ error: 'action and workflowId required' }, { status: 400 });
    }

    switch (action) {
      case 'save': {
        if (!state) return NextResponse.json({ error: 'state required' }, { status: 400 });
        const result = await saveCheckpoint({ workflowId, state });
        return NextResponse.json({ ok: true, ...result });
      }

      case 'heartbeat': {
        const ok = await heartbeat(workflowId);
        return NextResponse.json({ ok });
      }

      case 'complete': {
        const ok = await completeCheckpoint(workflowId);
        return NextResponse.json({ ok });
      }

      case 'fail': {
        const ok = await failCheckpoint(workflowId, body.reason);
        return NextResponse.json({ ok });
      }

      case 'delete': {
        const ok = await deleteCheckpoint(workflowId);
        return NextResponse.json({ ok });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    console.error('[Swarm Checkpoint] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
