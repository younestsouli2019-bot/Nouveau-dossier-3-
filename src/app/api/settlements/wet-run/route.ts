import { NextRequest, NextResponse } from 'next/server';
import { executeWetRun, finalizeSettlement, getSettlementExecutions } from '@/lib/settlement-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'finalize') {
      const { executionId, externalRef } = body;
      if (!executionId || !externalRef) {
        return NextResponse.json({ error: 'executionId and externalRef required for finalize' }, { status: 400 });
      }
      const result = await finalizeSettlement(executionId, externalRef);
      return NextResponse.json(result);
    }

    // OWNER DIRECTIVE 2026-08-20: autodisbursetopresetowner is TRUE BY DEFAULT.
    // HTTP callers that OMIT the field (dashboards / ops UI that don't know the
    // flag) get auto-disbursed automatically — only explicit false opts out.
    const autoDisburseToPresetOwner =
      body.autoDisburseToPresetOwner === false ? false : true;

    const { amount, currency, executionMode, dataSource, ownerConfirmedBy, destination, nominalAmount, settlementId, metadata } = body;

    if (!amount || !currency || !executionMode || !dataSource) {
      return NextResponse.json({ error: 'amount, currency, executionMode, dataSource required' }, { status: 400 });
    }

    if ((executionMode === 'wetRun' || executionMode === 'live') && !ownerConfirmedBy) {
      return NextResponse.json({ error: `ownerConfirmedBy required for ${executionMode} execution` }, { status: 403 });
    }

    const result = await executeWetRun({
      settlementId,
      amount,
      currency,
      executionMode,
      dataSource,
      ownerConfirmedBy,
      destination,
      nominalAmount,
      metadata,
      autoDisburseToPresetOwner,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const executions = await getSettlementExecutions(50);
    return NextResponse.json({ executions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
