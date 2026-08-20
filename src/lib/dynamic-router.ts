// ─── Dynamic Model Router ────────────────────────────────────────────
// Tier-based model selection with fallback loops via OpenRouter.
// Routes requests to the cheapest capable model, with automatic
// retry/escalation on failures.
// ────────────────────────────────────────────────────────────────────────────

import { estimateTokens, estimateCost, getContextWindow, type PromptMessage } from './token-optimizer';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export type ModelTier = 'free' | 'budget' | 'standard' | 'premium' | 'enterprise';

export type ModelConfig = {
  id: string;
  name: string;
  tier: ModelTier;
  contextWindow: number;
  maxOutput: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  latencyMs: number;
  reliability: number;
};

export type RouteDecision = {
  selectedModel: ModelConfig;
  reason: string;
  alternatives: ModelConfig[];
  estimatedCostUsd: number;
  fallbackChain: string[];
};

export type RouterResponse = {
  content: string;
  model: string;
  tokens: { input: number; output: number };
  costUsd: number;
  latencyMs: number;
  attempt: number;
  fallbacksUsed: string[];
};

const MODEL_CATALOG: ModelConfig[] = [
  { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', tier: 'free', contextWindow: 131072, maxOutput: 4096, inputCostPer1M: 0.05, outputCostPer1M: 0.10, supportsTools: false, supportsStreaming: true, latencyMs: 800, reliability: 0.85 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', tier: 'budget', contextWindow: 128000, maxOutput: 16384, inputCostPer1M: 0.15, outputCostPer1M: 0.60, supportsTools: true, supportsStreaming: true, latencyMs: 600, reliability: 0.97 },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', tier: 'budget', contextWindow: 1048576, maxOutput: 8192, inputCostPer1M: 0.10, outputCostPer1M: 0.40, supportsTools: true, supportsStreaming: true, latencyMs: 500, reliability: 0.95 },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', tier: 'standard', contextWindow: 65536, maxOutput: 8192, inputCostPer1M: 0.14, outputCostPer1M: 0.28, supportsTools: true, supportsStreaming: true, latencyMs: 700, reliability: 0.93 },
  { id: 'openai/gpt-4o', name: 'GPT-4o', tier: 'premium', contextWindow: 128000, maxOutput: 16384, inputCostPer1M: 2.50, outputCostPer1M: 10.00, supportsTools: true, supportsStreaming: true, latencyMs: 900, reliability: 0.99 },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', tier: 'premium', contextWindow: 200000, maxOutput: 8192, inputCostPer1M: 3.00, outputCostPer1M: 15.00, supportsTools: true, supportsStreaming: true, latencyMs: 1100, reliability: 0.98 },
];

const TIER_ORDER: ModelTier[] = ['free', 'budget', 'standard', 'premium', 'enterprise'];

function getModelsByTier(tier: ModelTier): ModelConfig[] {
  return MODEL_CATALOG.filter(m => m.tier === tier);
}

function estimateInputTokens(messages: PromptMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

function selectBestModel(
  inputTokens: number,
  maxOutputTokens: number,
  preferTier?: ModelTier,
  requireTools: boolean = false,
): RouteDecision {
  const suitableModels = MODEL_CATALOG.filter(m => {
    const fitsContext = m.contextWindow >= inputTokens + maxOutputTokens;
    const fitsOutput = m.maxOutput >= maxOutputTokens;
    const toolsOk = !requireTools || m.supportsTools;
    return fitsContext && fitsOutput && toolsOk;
  });

  if (suitableModels.length === 0) {
    const fallback = MODEL_CATALOG[MODEL_CATALOG.length - 1];
    return {
      selectedModel: fallback,
      reason: 'No suitable model found, using largest available',
      alternatives: [],
      estimatedCostUsd: estimateCost(inputTokens, maxOutputTokens, fallback.id),
      fallbackChain: [fallback.id],
    };
  }

  if (preferTier) {
    const tierModels = suitableModels.filter(m => m.tier === preferTier);
    if (tierModels.length > 0) {
      const best = tierModels.reduce((a, b) =>
        a.inputCostPer1M < b.inputCostPer1M ? a : b,
      );
      return {
        selectedModel: best,
        reason: `Selected from preferred tier: ${preferTier}`,
        alternatives: suitableModels.filter(m => m.id !== best.id).slice(0, 3),
        estimatedCostUsd: estimateCost(inputTokens, maxOutputTokens, best.id),
        fallbackChain: suitableModels.map(m => m.id),
      };
    }
  }

  const sorted = [...suitableModels].sort((a, b) => {
    const costA = estimateCost(inputTokens, maxOutputTokens, a.id);
    const costB = estimateCost(inputTokens, maxOutputTokens, b.id);
    if (Math.abs(costA - costB) < 0.0001) {
      return a.reliability - b.reliability;
    }
    return costA - costB;
  });

  const best = sorted[0];
  return {
    selectedModel: best,
    reason: 'Lowest cost with sufficient reliability',
    alternatives: sorted.slice(1, 4),
    estimatedCostUsd: estimateCost(inputTokens, maxOutputTokens, best.id),
    fallbackChain: sorted.map(m => m.id),
  };
}

async function callOpenRouter(
  model: string,
  messages: PromptMessage[],
  maxTokens: number,
  temperature: number = 0.7,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://khwarizmian-swarm.com',
      'X-Title': 'Khwarizmian Swarm',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${model} failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error(`OpenRouter ${model} returned empty response`);
  }

  return {
    content: choice.message.content,
    inputTokens: data.usage?.prompt_tokens ?? estimateInputTokens(messages),
    outputTokens: data.usage?.completion_tokens ?? estimateTokens(choice.message.content),
  };
}

export async function invokeWithRouting(
  messages: PromptMessage[],
  options: {
    preferTier?: ModelTier;
    maxOutputTokens?: number;
    temperature?: number;
    requireTools?: boolean;
    maxRetries?: number;
    budgetCapUsd?: number;
  } = {},
): Promise<RouterResponse> {
  const {
    preferTier,
    maxOutputTokens = 2048,
    temperature = 0.7,
    requireTools = false,
    maxRetries = 3,
    budgetCapUsd = 0.50,
  } = options;

  const inputTokens = estimateInputTokens(messages);
  const route = selectBestModel(inputTokens, maxOutputTokens, preferTier, requireTools);

  const fallbacks = route.fallbackChain;
  const usedFallbacks: string[] = [];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < Math.min(maxRetries, fallbacks.length); attempt++) {
    const modelId = fallbacks[attempt];
    const model = MODEL_CATALOG.find(m => m.id === modelId);
    if (!model) continue;

    const estCost = estimateCost(inputTokens, maxOutputTokens, modelId);
    if (estCost > budgetCapUsd) {
      usedFallbacks.push(`${modelId} (over budget: $${estCost.toFixed(4)} > $${budgetCapUsd})`);
      continue;
    }

    const start = Date.now();
    try {
      const result = await callOpenRouter(modelId, messages, maxOutputTokens, temperature);
      const latencyMs = Date.now() - start;
      const actualCost = estimateCost(result.inputTokens, result.outputTokens, modelId);

      console.log(
        `[DynamicRouter] ${modelId} succeeded: ${result.inputTokens}in/${result.outputTokens}out tokens, $${actualCost.toFixed(6)}, ${latencyMs}ms, attempt ${attempt + 1}`,
      );

      return {
        content: result.content,
        model: modelId,
        tokens: { input: result.inputTokens, output: result.outputTokens },
        costUsd: actualCost,
        latencyMs,
        attempt: attempt + 1,
        fallbacksUsed: usedFallbacks,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      usedFallbacks.push(modelId);
      console.warn(
        `[DynamicRouter] ${modelId} failed (attempt ${attempt + 1}): ${lastError.message}`,
      );
    }
  }

  throw new Error(
    `All models failed after ${usedFallbacks.length} attempts: ${usedFallbacks.join(' -> ')}. Last error: ${lastError?.message}`,
  );
}

export function getModelCatalog(): ModelConfig[] {
  return MODEL_CATALOG;
}

export function getRoutePreview(
  messages: PromptMessage[],
  preferTier?: ModelTier,
  requireTools: boolean = false,
): RouteDecision {
  const inputTokens = estimateInputTokens(messages);
  return selectBestModel(inputTokens, 2048, preferTier, requireTools);
}

export function getModelById(id: string): ModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}
