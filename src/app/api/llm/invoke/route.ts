import { NextRequest, NextResponse } from 'next/server';
import { optimizeMessages, type PromptMessage } from '@/lib/token-optimizer';
import { invokeWithRouting, getRoutePreview, getModelCatalog, type ModelTier } from '@/lib/dynamic-router';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, model, taskType, preferTier, maxOutputTokens, temperature, dryRun } = body as {
      messages: PromptMessage[];
      model?: string;
      taskType?: string;
      preferTier?: ModelTier;
      maxOutputTokens?: number;
      temperature?: number;
      dryRun?: boolean;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'messages array is required and must not be empty' },
        { status: 400 },
      );
    }

    const optimized = optimizeMessages(messages, model ?? 'openai/gpt-4o-mini', {
      prune: true,
      window: true,
      maxOutputTokens: maxOutputTokens ?? 2048,
    });

    if (dryRun) {
      const preview = getRoutePreview(optimized.messages, preferTier);
      return NextResponse.json({
        success: true,
        dryRun: true,
        optimization: {
          originalTokens: optimized.original.tokenEstimate,
          optimizedTokens: optimized.optimized.tokenEstimate,
          savingsPercent: optimized.savingsPercent,
          contextWindowUtilization: optimized.contextWindowUtilization,
        },
        route: {
          selectedModel: preview.selectedModel.id,
          tier: preview.selectedModel.tier,
          reason: preview.reason,
          estimatedCostUsd: preview.estimatedCostUsd,
          alternatives: preview.alternatives.map(m => ({ id: m.id, tier: m.tier })),
        },
      });
    }

    const result = await invokeWithRouting(optimized.messages, {
      preferTier,
      maxOutputTokens: maxOutputTokens ?? 2048,
      temperature: temperature ?? 0.7,
    });

    return NextResponse.json({
      success: true,
      content: result.content,
      meta: {
        model: result.model,
        tokens: result.tokens,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        attempt: result.attempt,
        fallbacksUsed: result.fallbacksUsed,
        optimization: {
          originalTokens: optimized.original.tokenEstimate,
          optimizedTokens: optimized.optimized.tokenEstimate,
          savingsPercent: optimized.savingsPercent,
        },
      },
    });
  } catch (error) {
    console.error('[LLM/Invoke]', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    models: getModelCatalog(),
    tiers: ['free', 'budget', 'standard', 'premium', 'enterprise'],
  });
}
