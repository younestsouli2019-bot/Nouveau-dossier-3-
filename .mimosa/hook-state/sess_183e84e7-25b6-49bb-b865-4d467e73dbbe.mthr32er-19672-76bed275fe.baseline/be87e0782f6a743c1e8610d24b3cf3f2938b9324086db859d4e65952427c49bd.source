// Atomic Simulation Pipeline (Pre-Flight Validation)
// Validates settlement/routing BEFORE execution — negative-slippage + unprofitable arbitrage detection
// Attack vector: Settlement Certainty — negative-slippage or unprofitable arbitrage executions
// Prevention: Atomic Simulation Pipeline (Hard-coded gas + fee thresholds) → 100% aborts before execution

import { sha256 } from './strict-enforcement/crypto-utils';

export type PipelineAction = 'settlement' | 'routing' | 'conversion' | 'escrow_release';

export interface SimulationRequest {
  action: PipelineAction;
  amount: number;
  currency: string;
  sourceChannel: string;
  destinationChannel: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export interface SimulationResult {
  approved: boolean;
  action: PipelineAction;
  estimatedFee: number;
  estimatedNet: number;
  slippageBps: number;
  gasEstimateUsd: number;
  profitabilityScore: number;
  rejectionReason?: string;
  proofHash: string;
}

// Hard-coded thresholds — NEVER bypass these
const FEE_THRESHOLDS: Record<PipelineAction, { maxFeePct: number; maxGasUsd: number }> = {
  settlement: { maxFeePct: 5.0, maxGasUsd: 50.00 },
  routing: { maxFeePct: 3.0, maxGasUsd: 25.00 },
  conversion: { maxFeePct: 2.0, maxGasUsd: 15.00 },
  escrow_release: { maxFeePct: 1.0, maxGasUsd: 10.00 },
};

// Known fee schedules per provider
const PROVIDER_FEES: Record<string, { fixedFee: number; pctFee: number; gasUsd: number }> = {
  paypal: { fixedFee: 0.30, pctFee: 2.9, gasUsd: 0 },
  bank_wire: { fixedFee: 15.00, pctFee: 0, gasUsd: 0 },
  crypto_usdc_arbitrum: { fixedFee: 0.10, pctFee: 0, gasUsd: 0.50 },
  crypto_usdc_optimism: { fixedFee: 0.05, pctFee: 0, gasUsd: 0.30 },
  crypto_bep20: { fixedFee: 0.01, pctFee: 0, gasUsd: 0.10 },
  payoneer: { fixedFee: 1.00, pctFee: 2.0, gasUsd: 0 },
  attijari: { fixedFee: 5.00, pctFee: 0.5, gasUsd: 0 },
  banking_circle: { fixedFee: 10.00, pctFee: 0, gasUsd: 0 },
};

// Negative profitability patterns
const UNPROFITABLE_PATTERNS = [
  { description: 'Fee exceeds 50% of amount', check: (fee: number, amount: number) => amount > 0 && (fee / amount) > 0.5 },
  { description: 'Net amount below $0.01', check: (_fee: number, amount: number, net: number) => net < 0.01 },
  { description: 'Gas exceeds amount', check: (fee: number, amount: number, _net: number, gas: number) => gas > amount },
];

export async function simulatePipeline(req: SimulationRequest): Promise<SimulationResult> {
  const threshold = FEE_THRESHOLDS[req.action];
  const providerFee = req.provider ? PROVIDER_FEES[req.provider] : null;

  // Calculate estimated fees
  let estimatedFee = 0;
  let gasEstimateUsd = 0;

  if (providerFee) {
    estimatedFee = providerFee.fixedFee + (req.amount * providerFee.pctFee / 100);
    gasEstimateUsd = providerFee.gasUsd;
  } else {
    // Conservative default: 3% + $1 fixed + $5 gas
    estimatedFee = 1.00 + (req.amount * 0.03);
    gasEstimateUsd = 5.00;
  }

  const estimatedNet = req.amount - estimatedFee - gasEstimateUsd;
  const slippageBps = req.amount > 0
    ? Math.round(((estimatedFee + gasEstimateUsd) / req.amount) * 10000)
    : 0;

  // Profitability score: 0 (terrible) to 100 (perfect)
  const profitabilityScore = Math.max(0, Math.min(100,
    100 - (slippageBps / 100) - (gasEstimateUsd / req.amount * 1000)
  ));

  let rejectionReason: string | undefined;

  // Check 1: Fee threshold
  const feePct = req.amount > 0 ? (estimatedFee / req.amount) * 100 : 100;
  if (feePct > threshold.maxFeePct) {
    rejectionReason = `Fee ${feePct.toFixed(2)}% exceeds ${threshold.maxFeePct}% threshold for ${req.action}`;
  }

  // Check 2: Gas threshold
  if (gasEstimateUsd > threshold.maxGasUsd) {
    rejectionReason = rejectionReason || `Gas $${gasEstimateUsd.toFixed(2)} exceeds $${threshold.maxGasUsd} threshold`;
  }

  // Check 3: Negative profitability patterns
  if (!rejectionReason) {
    for (const pattern of UNPROFITABLE_PATTERNS) {
      if (pattern.check(estimatedFee, req.amount, estimatedNet, gasEstimateUsd)) {
        rejectionReason = pattern.description;
        break;
      }
    }
  }

  // Check 4: Negative slippage (receiving less than sent)
  if (!rejectionReason && estimatedNet < 0) {
    rejectionReason = `Negative net: -$${Math.abs(estimatedNet).toFixed(2)} (would lose money)`;
  }

  // Check 5: Amount sanity
  if (req.amount <= 0) {
    rejectionReason = 'Amount must be positive';
  }

  if (req.amount > 1_000_000) {
    rejectionReason = rejectionReason || 'Amount exceeds $1M safety limit — requires manual approval';
  }

  const proofHash = await sha256(JSON.stringify({
    ...req,
    estimatedFee,
    estimatedNet,
    slippageBps,
    gasEstimateUsd,
    profitabilityScore,
    approved: !rejectionReason,
    ts: Date.now(),
  }));

  return {
    approved: !rejectionReason,
    action: req.action,
    estimatedFee: Math.round(estimatedFee * 100) / 100,
    estimatedNet: Math.round(estimatedNet * 100) / 100,
    slippageBps,
    gasEstimateUsd: Math.round(gasEstimateUsd * 100) / 100,
    profitabilityScore: Math.round(profitabilityScore * 10) / 10,
    rejectionReason,
    proofHash,
  };
}

export async function simulateSettlementChain(
  requests: SimulationRequest[],
): Promise<{ allApproved: boolean; results: SimulationResult[]; totalNet: number }> {
  const results: SimulationResult[] = [];
  let totalNet = 0;

  for (const req of requests) {
    const result = await simulatePipeline(req);
    results.push(result);
    totalNet += result.estimatedNet;

    // Abort chain if any step fails
    if (!result.approved) {
      return { allApproved: false, results, totalNet };
    }
  }

  return { allApproved: true, results, totalNet: Math.round(totalNet * 100) / 100 };
}

export function getFeeThresholds(): Record<PipelineAction, { maxFeePct: number; maxGasUsd: number }> {
  return { ...FEE_THRESHOLDS };
}

export function getProviderFees(): Record<string, { fixedFee: number; pctFee: number; gasUsd: number }> {
  return { ...PROVIDER_FEES };
}
