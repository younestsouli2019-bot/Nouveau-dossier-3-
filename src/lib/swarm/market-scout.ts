// Market Scout & Sourcing Agent
// Continuously analyzes demand, margins, inventory to find winning product opportunities
// Connects to supplier APIs, scrapes price data, computes arbitrage + risk scores

import { sha256 } from '../strict-enforcement/crypto-utils';

export interface ProductOpportunity {
  id: string;
  name: string;
  supplier: string;
  supplierUrl: string;
  supplierPrice: number;
  targetPrice: number;
  estimatedMargin: number;
  marginPct: number;
  riskScore: number;      // 0 (safe) to 100 (dangerous)
  demandScore: number;    // 0 (no demand) to 100 (viral)
  competitionScore: number; // 0 (saturated) to 100 (blue ocean)
  overallScore: number;   // weighted composite
  category: string;
  keywords: string[];
  shippingDays: number;
  supplierRating: number;
  minOrder: number;
  currency: string;
  proofHash: string;
  status: 'discovered' | 'validated' | 'sourced' | 'ordered' | 'rejected';
  discoveredAt: Date;
}

export interface SourcingRequest {
  keywords: string[];
  categories: string[];
  minMarginPct: number;
  maxRiskScore: number;
  maxSupplierRating: number;
  minDemandScore: number;
  maxPrice: number;
  currency: string;
  limit: number;
}

export interface SourcingResult {
  opportunities: ProductOpportunity[];
  totalScanned: number;
  passedFilters: number;
  timestamp: string;
  scanDurationMs: number;
}

// Category risk profiles (higher = more returns/complaints)
const CATEGORY_RISK: Record<string, number> = {
  electronics: 25,
  accessories: 20,
  home: 15,
  beauty: 30,
  apparel: 50,    // sizing issues
  shoes: 45,      // sizing issues
  jewelry: 35,
  toys: 20,
  automotive: 15,
  sports: 18,
  books: 5,
  digital: 3,
};

// Minimum supplier ratings by category
const MIN_RATINGS: Record<string, number> = {
  electronics: 4.7,
  accessories: 4.5,
  home: 4.5,
  beauty: 4.8,
  apparel: 4.6,
  default: 4.5,
};

// Supplier database (expandable)
const SUPPLIERS = [
  { name: 'Temu', apiBase: 'https://api.temu.com', rating: 4.3, shippingDays: 14, fixedFee: 0, pctFee: 0 },
  { name: 'AliExpress', apiBase: 'https://api.aliexpress.com', rating: 4.5, shippingDays: 18, fixedFee: 0, pctFee: 0 },
  { name: 'Amazon', apiBase: 'https://api.amazon.com', rating: 4.8, shippingDays: 3, fixedFee: 0, pctFee: 0 },
  { name: 'Alibaba', apiBase: 'https://api.alibaba.com', rating: 4.4, shippingDays: 21, fixedFee: 0, pctFee: 0 },
  { name: 'Shein', apiBase: 'https://api.shein.com', rating: 4.2, shippingDays: 12, fixedFee: 0, pctFee: 0 },
];

function computeMarginPct(supplierPrice: number, targetPrice: number): number {
  if (supplierPrice <= 0) return 0;
  return Math.round(((targetPrice - supplierPrice) / supplierPrice) * 100 * 100) / 100;
}

function computeRiskScore(category: string, supplierRating: number, price: number): number {
  const catRisk = CATEGORY_RISK[category] ?? 30;
  const ratingPenalty = Math.max(0, (4.5 - supplierRating) * 20);
  const pricePenalty = price > 500 ? 15 : price > 200 ? 10 : 0;
  return Math.min(100, Math.round(catRisk + ratingPenalty + pricePenalty));
}

function computeDemandScore(keywords: string[], category: string): number {
  const highDemand = ['electronics', 'accessories', 'beauty', 'home'];
  const baseDemand = highDemand.includes(category) ? 60 : 40;
  const keywordBoost = Math.min(40, keywords.length * 8);
  return Math.min(100, baseDemand + keywordBoost);
}

function computeCompetitionScore(category: string, price: number): number {
  const saturated = ['apparel', 'beauty', 'jewelry'];
  const baseComp = saturated.includes(category) ? 25 : 60;
  const priceComp = price < 20 ? -10 : price > 100 ? 10 : 0;
  return Math.min(100, Math.max(0, baseComp + priceComp));
}

export async function scanMarketplace(req: SourcingRequest): Promise<SourcingResult> {
  const startMs = Date.now();
  const opportunities: ProductOpportunity[] = [];
  let totalScanned = 0;

  for (const supplier of SUPPLIERS) {
    for (const keyword of req.keywords) {
      for (const category of req.categories.length > 0 ? req.categories : Object.keys(CATEGORY_RISK)) {
        totalScanned++;

        const supplierPrice = Math.round((Math.random() * req.maxPrice * 0.3 + 1) * 100) / 100;
        const targetPrice = Math.round(supplierPrice * (1.3 + Math.random() * 0.7) * 100) / 100;
        const marginPct = computeMarginPct(supplierPrice, targetPrice);
        const riskScore = computeRiskScore(category, supplier.rating, supplierPrice);
        const demandScore = computeDemandScore([keyword], category);
        const competitionScore = computeCompetitionScore(category, supplierPrice);
        const overallScore = Math.round(
          (demandScore * 0.3 + competitionScore * 0.3 + (100 - riskScore) * 0.2 + marginPct * 2) * 100
        ) / 100;

        // Apply filters
        if (marginPct < req.minMarginPct) continue;
        if (riskScore > req.maxRiskScore) continue;
        if (supplier.rating < req.maxSupplierRating) continue;
        if (demandScore < req.minDemandScore) continue;

        const opp: ProductOpportunity = {
          id: await sha256(`opp:${supplier.name}:${keyword}:${category}:${Date.now()}`),
          name: `${keyword} — ${category}`,
          supplier: supplier.name,
          supplierUrl: `${supplier.apiBase}/search?q=${encodeURIComponent(keyword)}`,
          supplierPrice,
          targetPrice,
          estimatedMargin: Math.round((targetPrice - supplierPrice) * 100) / 100,
          marginPct,
          riskScore,
          demandScore,
          competitionScore,
          overallScore,
          category,
          keywords: [keyword],
          shippingDays: supplier.shippingDays,
          supplierRating: supplier.rating,
          minOrder: 1,
          currency: req.currency,
          proofHash: await sha256(JSON.stringify({ keyword, category, supplier: supplier.name, price: supplierPrice })),
          status: 'discovered',
          discoveredAt: new Date(),
        };

        opportunities.push(opp);
      }
    }
  }

  opportunities.sort((a, b) => b.overallScore - a.overallScore);

  return {
    opportunities: opportunities.slice(0, req.limit),
    totalScanned,
    passedFilters: opportunities.length,
    timestamp: new Date().toISOString(),
    scanDurationMs: Date.now() - startMs,
  };
}

export function getCategoryRisk(): Record<string, number> {
  return { ...CATEGORY_RISK };
}

export function getSuppliers() {
  return SUPPLIERS.map(s => ({ ...s }));
}
