import { db } from '@/lib/db';

export interface CheckpointData {
  workflowId: string;
  state: Record<string, unknown>;
  status?: 'running' | 'completed' | 'failed' | 'orphaned';
}

export interface CheckpointResult {
  saved: boolean;
  version: number;
  checkpointId: string;
}

export async function saveCheckpoint(data: CheckpointData): Promise<CheckpointResult> {
  const existing = await db.stateCheckpoint.findUnique({
    where: { workflowId: data.workflowId },
  });

  if (existing) {
    const nextVersion = existing.version + 1;
    const updated = await db.stateCheckpoint.update({
      where: { workflowId: data.workflowId },
      data: {
        state: JSON.stringify(data.state),
        version: nextVersion,
        status: data.status || 'running',
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      },
    });
    return { saved: true, version: nextVersion, checkpointId: updated.id };
  }

  const created = await db.stateCheckpoint.create({
    data: {
      workflowId: data.workflowId,
      state: JSON.stringify(data.state),
      version: 1,
      status: data.status || 'running',
      lastHeartbeat: new Date(),
    },
  });

  return { saved: true, version: 1, checkpointId: created.id };
}

export async function loadCheckpoint(workflowId: string): Promise<Record<string, unknown> | null> {
  const checkpoint = await db.stateCheckpoint.findUnique({
    where: { workflowId },
  });

  if (!checkpoint) return null;
  if (checkpoint.status === 'failed' || checkpoint.status === 'orphaned') return null;

  try {
    return JSON.parse(checkpoint.state) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function deleteCheckpoint(workflowId: string): Promise<boolean> {
  try {
    await db.stateCheckpoint.delete({ where: { workflowId } });
    return true;
  } catch {
    return false;
  }
}

export async function heartbeat(workflowId: string): Promise<boolean> {
  try {
    await db.stateCheckpoint.update({
      where: { workflowId },
      data: { lastHeartbeat: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

export async function recoverOrphanedWorkflows(): Promise<string[]> {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

  const orphaned = await db.stateCheckpoint.updateMany({
    where: {
      status: 'running',
      lastHeartbeat: { lt: staleThreshold },
    },
    data: {
      status: 'orphaned',
    },
  });

  const workflows = await db.stateCheckpoint.findMany({
    where: { status: 'orphaned' },
    select: { workflowId: true },
  });

  return workflows.map((w) => w.workflowId);
}

export async function completeCheckpoint(workflowId: string): Promise<boolean> {
  try {
    await db.stateCheckpoint.update({
      where: { workflowId },
      data: { status: 'completed', lastHeartbeat: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

export async function failCheckpoint(workflowId: string, reason?: string): Promise<boolean> {
  try {
    await db.stateCheckpoint.update({
      where: { workflowId },
      data: {
        status: 'failed',
        lastHeartbeat: new Date(),
        state: JSON.stringify({ error: reason || 'unknown failure' }),
      },
    });
    return true;
  } catch {
    return false;
  }
}
