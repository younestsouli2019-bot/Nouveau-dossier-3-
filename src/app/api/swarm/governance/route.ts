// POST /api/swarm/governance
// Oversight committees + model refresh + memory isolation + self-correction mesh
import { NextRequest, NextResponse } from 'next/server';
import { reviewDecision, generatePerformanceReport, getCommittees, getDecisionLog } from '@/lib/swarm/oversight-committee';
import { initializeModels, checkStaleness, refreshModel, getModels, getRefreshLog } from '@/lib/swarm/model-refresh';
import { createNamespace, writeEntry, readEntry, verifyIsolation, getNamespaces } from '@/lib/swarm/memory-isolation';
import { initializeMesh, detectAndCorrect, hydrateNode, getMeshNodes, getMeshHealth, getCorrectionLog, getCheckpoints } from '@/lib/swarm/self-correction-mesh';

// Initialize on first request
let meshInitialized = false;
let modelsInitialized = false;

function ensureInit() {
  if (!meshInitialized) {
    initializeMesh([
      { id: 'sourcing', type: 'market_scout' },
      { id: 'browser', type: 'browser_swarm' },
      { id: 'accounts', type: 'account_management' },
      { id: 'payments', type: 'payment_infrastructure' },
      { id: 'ledger', type: 'financial_ledger' },
      { id: 'settlement', type: 'settlement_engine' },
    ]);
    meshInitialized = true;
  }
  if (!modelsInitialized) {
    initializeModels();
    modelsInitialized = true;
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureInit();
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'review': {
        const decision = await reviewDecision(
          body.committeeType || 'financial',
          body.entityType || 'settlement',
          body.entityId || `entity-${Date.now()}`,
          body.action || 'default',
          body.context || {},
        );
        return NextResponse.json(decision);
      }

      case 'performance_report': {
        const report = generatePerformanceReport(
          body.committeeType || 'financial',
          body.period || 'current',
        );
        return NextResponse.json(report);
      }

      case 'check_staleness': {
        const results = checkStaleness();
        return NextResponse.json({ models: results, refreshLog: getRefreshLog(10) });
      }

      case 'refresh_model': {
        const model = await refreshModel(
          body.modelType || 'pricing',
          body.newVersion || '2.0.0',
          body.dataPoints || 1000,
        );
        return NextResponse.json(model);
      }

      case 'mesh_health': {
        return NextResponse.json({
          health: getMeshHealth(),
          nodes: getMeshNodes(),
          recentCorrections: getCorrectionLog(10),
        });
      }

      case 'correct': {
        const event = await detectAndCorrect(
          body.nodeId || 'mesh-sourcing',
          body.type || 'state_drift',
          body.severity || 'medium',
          body.beforeState || {},
          body.correctionAction || 'Auto-corrected state drift',
          body.afterState || {},
        );
        return NextResponse.json(event);
      }

      case 'hydrate': {
        const checkpoint = await hydrateNode(
          body.nodeId || 'mesh-sourcing',
          body.stateData || {},
        );
        return NextResponse.json(checkpoint);
      }

      case 'checkpoints': {
        return NextResponse.json({ checkpoints: getCheckpoints(body.nodeId) });
      }

      case 'verify_isolation': {
        const result = await verifyIsolation();
        return NextResponse.json(result);
      }

      case 'create_namespace': {
        const ns = createNamespace(body.systemId || `sys-${Date.now()}`, body.systemType || 'general');
        return NextResponse.json(ns);
      }

      case 'write_memory': {
        const result = await writeEntry(body.namespaceId, body.key, body.value || {});
        return NextResponse.json(result);
      }

      case 'read_memory': {
        const result = await readEntry(body.namespaceId, body.key);
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  ensureInit();
  return NextResponse.json({
    module: 'Swarm Governance',
    actions: ['review', 'performance_report', 'check_staleness', 'refresh_model', 'mesh_health', 'correct', 'hydrate', 'checkpoints', 'verify_isolation', 'create_namespace', 'write_memory', 'read_memory'],
    committees: getCommittees(),
    models: getModels(),
    namespaces: getNamespaces(),
    meshHealth: getMeshHealth(),
    decisionLog: getDecisionLog(5),
  });
}
