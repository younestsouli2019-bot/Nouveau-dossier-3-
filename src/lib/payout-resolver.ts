// Payout Route Resolver — "All roads lead to Mecca."
// OWNER DIRECTIVE: any payout must resolve to ANY available pre-set owner
// account — the one with the least fees, easiest currency conversion, and
// headroom under its velocity limit — instead of hard-failing when a single
// OWNER_PAYOUT_RAIL env var is missing or mismatched.
//
// Source of truth for the myriad of accounts = the DB OwnerAccount table
// (Banking Circle, PayPal Business, USDC on Arbitrum, Payoneer, Attijari
// RIB 372, ...). If the DB is unreachable the resolver falls back to the
// env OWNER_PAYOUT_* preset so diagnostic/legacy paths never hang.
// Fail-closed ONLY when literally zero usable routes exist.

import { prisma } from './db';
import { tryGetPresetPayoutDestination, type PayoutRail, type PresetPayoutDestination } from './owner-config';

export interface RailCost {
  feeBps: number; // per-transfer fee in basis points (0.01% units)
  fixedFeeCents: number; // fixed per-transfer fee
  fxSpreadBps: number; // extra cost only when currency conversion is required
  monthlyVelocityCapUsd: number; // proxy limit; measured against totalSent
}

// Default rail economics. Values are env-overridable per rail:
//   OWNER_RAIL_FEE_BPS_<RAIL>, OWNER_RAIL_FX_BPS_<RAIL>, OWNER_RAIL_CAP_<RAIL>
const DEFAULT_RAIL_COST: Record<string, RailCost> = {
  l2_crypto: { feeBps: 15, fixedFeeCents: 0, fxSpreadBps: 0, monthlyVelocityCapUsd: 200000 },
  bank_wire: { feeBps: 35, fixedFeeCents: 0, fxSpreadBps: 150, monthlyVelocityCapUsd: 100000 },
  sepa: { feeBps: 25, fixedFeeCents: 0, fxSpreadBps: 150, monthlyVelocityCapUsd: 100000 },
  iban: { feeBps: 25, fixedFeeCents: 0, fxSpreadBps: 150, monthlyVelocityCapUsd: 100000 },
  ach: { feeBps: 60, fixedFeeCents: 0, fxSpreadBps: 0, monthlyVelocityCapUsd: 75000 },
  wise: { feeBps: 70, fixedFeeCents: 60, fxSpreadBps: 120, monthlyVelocityCapUsd: 80000 },
  paypal: { feeBps: 290, fixedFeeCents: 30, fxSpreadBps: 380, monthlyVelocityCapUsd: 60000 },
  payoneer: { feeBps: 200, fixedFeeCents: 0, fxSpreadBps: 250, monthlyVelocityCapUsd: 50000 },
  card_token: { feeBps: 280, fixedFeeCents: 30, fxSpreadBps: 0, monthlyVelocityCapUsd: 30000 },
  crypto: { feeBps: 15, fixedFeeCents: 0, fxSpreadBps: 0, monthlyVelocityCapUsd: 200000 },
  internal_pool: { feeBps: 0, fixedFeeCents: 0, fxSpreadBps: 0, monthlyVelocityCapUsd: Infinity },
};

export interface ResolvedRoute {
  ownerAccountId?: string;
  envPreset?: PresetPayoutDestination;
  label: string;
  rail: string; // normalized rail key (see OWNER_RAIL_COST keys)
  currency: string;
  identifier: string; // masked last-N for receipts/UI
  feeBps: number;
  fixedFeeCents: number;
  fxSpreadBps: number;
  requiresFxConversion: boolean;
  limitPressurePct: number; // totalSent/cap, 0..~100+ (>=100 = at limit)
  usableByIdentity: boolean; // has concrete account number/address/email
  score: number; // higher = better route
}

export interface ResolveResult {
  best: ResolvedRoute | null;
  ranked: ResolvedRoute[];
  reason: string;
  source: 'db' | 'env' | 'none';
}

function tryEnv(name: string): string | null {
  const v = process.env[name];
  if (!v || v.trim() === '') return null;
  return v.trim();
}

function railCost(rail: string): RailCost {
  const def = DEFAULT_RAIL_COST[rail] ?? DEFAULT_RAIL_COST.bank_wire;
  const envRail = rail.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const num = (key: 'FEE_BPS' | 'FX_BPS' | 'CAP', defVal: number): number => {
    const raw = tryEnv(`OWNER_RAIL_${envRail}_${key}`);
    if (raw === null) return defVal;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : defVal;
  };
  return {
    feeBps: num('FEE_BPS', def.feeBps),
    fxSpreadBps: num('FX_BPS', def.fxSpreadBps),
    monthlyVelocityCapUsd: num('CAP', def.monthlyVelocityCapUsd),
    fixedFeeCents: def.fixedFeeCents,
  };
}

function mask(id: string): string {
  if (!id) return '';
  const s = String(id);
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

/** Normalize an OwnerAccount.accountType (or rail) into a rail-cost key. */
function normalizeRail(input: string): string {
  const i = (input || '').toLowerCase();
  const map: Record<string, string> = {
    bank_wire: 'bank_wire',
    bank: 'bank_wire',
    sepa: 'sepa',
    iban: 'iban',
    ach: 'ach',
    l2_crypto: 'l2_crypto',
    crypto: 'crypto',
    paypal: 'paypal',
    wise: 'wise',
    payoneer: 'payoneer',
    card_token: 'card_token',
    internal_pool: 'internal_pool',
  };
  return map[i] || 'bank_wire';
}

function scoreRoute(r: {
  rail: string;
  currency: string;
  matchesCurrency: boolean;
  limitPressurePct: number;
  usableByIdentity: boolean;
  isPrimary?: boolean;
}): number {
  const cost = railCost(r.rail);
  // Heuristics per OWNER directive: least fees, easiest currency conversion,
  // headroom under limits, identity-completeness, then primary-account bonus.
  let score = 10_000;
  score -= cost.feeBps; // lower fees ⇒ higher score
  score -= cost.fixedFeeCents * 5;
  if (r.matchesCurrency) {
    score += 2_000; // no FX conversion at all is the cheapest path
  } else {
    score -= cost.fxSpreadBps; // penalty proportional to FX cost
  }
  score -= Math.min(3_000, r.limitPressurePct * 30); // pressure toward cap
  if (r.usableByIdentity) score += 500;
  if (r.isPrimary) score += 250;
  return score;
}

/** Build routes from the env OWNER_PAYOUT_* preset (legacy single-rail path). */
function envRoutes(reqCurrency: string): ResolvedRoute[] {
  const preset = tryGetPresetPayoutDestination();
  if (!preset) return [];
  const cost = railCost(preset.rail);
  const matches = preset.currency.toUpperCase() === reqCurrency.toUpperCase();
  const limitPressurePct = 0; // env preset has no cumulative usage ledger
  return [
    {
      envPreset: preset,
      label: 'Env preset',
      rail: normalizeRail(preset.rail),
      currency: preset.currency,
      identifier: mask(preset.identifier),
      feeBps: cost.feeBps,
      fixedFeeCents: cost.fixedFeeCents,
      fxSpreadBps: cost.fxSpreadBps,
      requiresFxConversion: !matches,
      limitPressurePct,
      usableByIdentity: !!preset.identifier,
      score: scoreRoute({
        rail: normalizeRail(preset.rail),
        currency: preset.currency,
        matchesCurrency: matches,
        limitPressurePct,
        usableByIdentity: !!preset.identifier,
      }),
    },
  ];
}

/** Build routes from the DB OwnerAccount table (the myriad of pre-set accounts). */
async function dbRoutes(reqCurrency: string): Promise<ResolvedRoute[]> {
  const accounts = await prisma.ownerAccount.findMany({
    where: { isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  });
  const reqCur = reqCurrency.toUpperCase();
  const out: ResolvedRoute[] = [];
  for (const a of accounts) {
    const identity =
      a.accountNumber ||
      a.walletAddress ||
      a.paypalEmail ||
      a.wiseEmail ||
      a.payoneerId ||
      a.accountNumberLast ||
      a.walletAddressShort;
    const rail = normalizeRail(a.accountType);
    const cost = railCost(rail);
    const matches = a.currency.toUpperCase() === reqCur;
    const pressure = cost.monthlyVelocityCapUsd === Infinity ? 0 : (a.totalSent / cost.monthlyVelocityCapUsd) * 100;
    out.push({
      ownerAccountId: a.id,
      label: a.label,
      rail,
      currency: a.currency,
      identifier: mask(identity || a.id),
      feeBps: cost.feeBps,
      fixedFeeCents: cost.fixedFeeCents,
      fxSpreadBps: cost.fxSpreadBps,
      requiresFxConversion: !matches,
      limitPressurePct: Math.round(pressure * 100) / 100,
      usableByIdentity: !!identity && !identity.startsWith('0x0'),
      score: scoreRoute({
        rail,
        currency: a.currency,
        matchesCurrency: matches,
        limitPressurePct: pressure,
        usableByIdentity: !!identity && !identity.startsWith('0x0'),
        isPrimary: a.isPrimary,
      }),
    });
  }
  return out;
}

/**
 * Resolve the best available payout route for `reqCurrency`.
 * Priority (OWNER "all roads lead to Mecca" directive):
 *   1. Every active, identity-complete pre-set account from the DB
 *   2. The env OWNER_PAYOUT_* preset as a fallback candidate
 *   3. Best = cheapest (fee + FX penalty) and least pressure toward its cap
 * Returns { best, ranked } and NEVER throws when the DB is unreachable
 * (falls back to env preset; if even that is absent, best === null).
 */
export async function resolveBestPayoutRoute(reqCurrency: string): Promise<ResolveResult> {
  let db: ResolvedRoute[] = [];
  let source: ResolveResult['source'] = 'none';
  try {
    db = await dbRoutes(reqCurrency);
    if (db.length > 0) {
      source = 'db';
    } else {
      const env = envRoutes(reqCurrency);
      if (env.length > 0) {
        db = env;
        source = 'env';
      }
    }
  } catch {
    const env = envRoutes(reqCurrency);
    if (env.length > 0) {
      db = env;
      source = 'env';
    }
  }

  if (db.length === 0) {
    return {
      best: null,
      ranked: [],
      reason: 'No active pre-set owner route available (DB empty AND OWNER_PAYOUT_* env preset missing).',
      source,
    };
  }

  const ranked = [...db].sort((x, y) => y.score - x.score);
  return {
    best: ranked[0],
    ranked,
    reason: `Resolved best route=${ranked[0].label} rail=${ranked[0].rail} currency=${ranked[0].currency} ` +
      `feeBps=${ranked[0].feeBps} fx=${
        ranked[0].requiresFxConversion ? 'needed(+' + ranked[0].fxSpreadBps + 'bps)' : 'none'
      } limitPressure=${ranked[0].limitPressurePct}%`,
    source,
  };
}

/** Map a rail name to the OWNER_PAYOUT_RAIL vocabulary used elsewhere. */
export function routeToPayoutRail(rail: string): PayoutRail {
  const r = rail.toLowerCase();
  if (r === 'sepa' || r === 'iban' || r === 'ach' || r === 'card_token' || r === 'crypto') return r as PayoutRail;
  if (r === 'l2_crypto') return 'crypto';
  if (r === 'bank_wire') return 'iban';
  return 'iban';
}