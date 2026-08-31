// ─── Token Optimizer ─────────────────────────────────────────────────
// Prompt pruning, context windowing, cost prediction, tokenizer encoding.
// Reduces token waste by stripping boilerplate, compressing verbose text,
// and selecting optimal context slices.
// ────────────────────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';

const CHARS_PER_TOKEN_ESTIMATE = 4;

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000,
  'openai/gpt-4-turbo': 128000,
  'anthropic/claude-3.5-sonnet': 200000,
  'anthropic/claude-3-haiku': 200000,
  'google/gemini-2.0-flash-001': 1048576,
  'google/gemini-2.0-pro': 2097152,
  'meta-llama/llama-3.1-8b-instruct': 131072,
  'deepseek/deepseek-chat': 65536,
  'qwen/qwen-2.5-72b-instruct': 32768,
};

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4-turbo': { input: 10.00, output: 30.00 },
  'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'google/gemini-2.0-pro': { input: 1.25, output: 10.00 },
  'meta-llama/llama-3.1-8b-instruct': { input: 0.20, output: 0.20 },
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'qwen/qwen-2.5-72b-instruct': { input: 0.90, output: 0.90 },
};

export type PromptMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OptimizationResult = {
  original: { tokenEstimate: number; charCount: number };
  optimized: { tokenEstimate: number; charCount: number };
  savingsPercent: number;
  messages: PromptMessage[];
  model: string;
  estimatedCostUsd: number;
  contextWindowUtilization: number;
};

const BOILERPLATE_PATTERNS: RegExp[] = [
  /\bPlease note that\b[\s\S]{0,100}\./gi,
  /\bIt is important to\b[\s\S]{0,100}\./gi,
  /\bAs an AI\b[\s\S]{0,100}\./gi,
  /\bI would like to\b[\s\S]{0,100}\./gi,
  /\bCould you please\b[\s\S]{0,100}\./gi,
  /\bI would appreciate it if\b[\s\S]{0,100}\./gi,
  /\bIn order to\b[\s\S]{0,100}\./gi,
  /\bFor the purpose of\b[\s\S]{0,100}\./gi,
  /\bWith regard to\b[\s\S]{0,100}\./gi,
  /\bAt this point in time\b/gi,
  /\bDue to the fact that\b/gi,
  /\bIn the event that\b/gi,
  /\bWith respect to\b/gi,
  /\bIn accordance with\b/gi,
  /\bIt should be noted that\b[\s\S]{0,100}\./gi,
];

const FILLER_WORDS = /\b(very|really|quite|actually|basically|essentially|literally|honestly|definitely|certainly|absolutely|totally|completely|entirely|obviously|clearly|undoubtedly)\b\s*/gi;

function stripBoilerplate(text: string): string {
  let result = text;
  for (const pattern of BOILERPLATE_PATTERNS) {
    result = result.replace(pattern, '');
  }
  result = result.replace(FILLER_WORDS, '');
  result = result.replace(/\s{2,}/g, ' ');
  return result.trim();
}

function compressWhitespace(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\t+/g, '  ')
    .trim();
}

function extractKeyFacts(text: string): string {
  const lines = text.split('\n');
  const keyLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\d+[.:]\s/.test(trimmed)) return true;
    if (/^[-*]\s/.test(trimmed)) return true;
    if (/^[A-Z][^a-z]+:/.test(trimmed)) return true;
    if (/\b(must|required|critical|important|key|essential)\b/i.test(trimmed)) return true;
    if (trimmed.length > 80 && trimmed.length < 500) return true;
    return false;
  });
  return keyLines.join('\n');
}

function slidingWindowContext(
  messages: PromptMessage[],
  maxTokens: number,
): PromptMessage[] {
  if (messages.length <= 2) return messages;

  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  const systemTokenEst = systemMessages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );

  const availableTokens = maxTokens - systemTokenEst - 500;

  if (availableTokens <= 0) return [...systemMessages, nonSystemMessages[nonSystemMessages.length - 1]];

  let totalTokens = 0;
  const keptMessages: PromptMessage[] = [];

  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(nonSystemMessages[i].content);
    if (totalTokens + msgTokens > availableTokens) break;
    totalTokens += msgTokens;
    keptMessages.unshift(nonSystemMessages[i]);
  }

  return [...systemMessages, ...keptMessages];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    const fallback = MODEL_PRICING['openai/gpt-4o-mini'];
    return (
      (inputTokens / 1_000_000) * fallback.input +
      (outputTokens / 1_000_000) * fallback.output
    );
  }
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

export function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 32768;
}

export function optimizeMessages(
  messages: PromptMessage[],
  model: string = 'openai/gpt-4o-mini',
  options: {
    prune?: boolean;
    window?: boolean;
    maxOutputTokens?: number;
  } = {},
): OptimizationResult {
  const { prune = true, window = true, maxOutputTokens = 2048 } = options;

  const originalCharCount = messages.reduce((sum, m) => sum + m.content.length, 0);
  const originalTokenEst = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  let optimized = messages.map(m => ({
    ...m,
    content: compressWhitespace(m.content),
  }));

  if (prune) {
    optimized = optimized.map(m => ({
      ...m,
      content:
        m.role === 'system'
          ? stripBoilerplate(m.content)
          : m.content.length > 200
            ? stripBoilerplate(m.content)
            : m.content,
    }));
  }

  if (window) {
    const contextWindow = getContextWindow(model);
    const availableForInput = contextWindow - maxOutputTokens;
    optimized = slidingWindowContext(optimized, availableForInput);
  }

  const optimizedCharCount = optimized.reduce((sum, m) => sum + m.content.length, 0);
  const optimizedTokenEst = optimized.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  const savingsPercent =
    originalTokenEst > 0
      ? Math.round(((originalTokenEst - optimizedTokenEst) / originalTokenEst) * 100)
      : 0;

  const contextWindow = getContextWindow(model);
  const estimatedCost = estimateCost(optimizedTokenEst, maxOutputTokens, model);

  return {
    original: { tokenEstimate: originalTokenEst, charCount: originalCharCount },
    optimized: { tokenEstimate: optimizedTokenEst, charCount: optimizedCharCount },
    savingsPercent,
    messages: optimized,
    model,
    estimatedCostUsd: Math.round(estimatedCost * 1_000_000) / 1_000_000,
    contextWindowUtilization: Math.round((optimizedTokenEst / contextWindow) * 100),
  };
}

export function selectOptimalModel(
  taskType: 'simple' | 'moderate' | 'complex' | 'coding' | 'reasoning',
): string {
  const taskModelMap: Record<string, string> = {
    simple: 'openai/gpt-4o-mini',
    moderate: 'google/gemini-2.0-flash-001',
    complex: 'openai/gpt-4o',
    coding: 'deepseek/deepseek-chat',
    reasoning: 'anthropic/claude-3.5-sonnet',
  };
  return taskModelMap[taskType] ?? 'openai/gpt-4o-mini';
}

export function estimateOutputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function chunkText(text: string, maxTokensPerChunk: number): string[] {
  const maxChars = maxTokensPerChunk * CHARS_PER_TOKEN_ESTIMATE;
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChars) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}
