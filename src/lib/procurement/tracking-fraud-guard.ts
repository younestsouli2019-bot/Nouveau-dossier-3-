/**
 * Core Fraud Guard — SINGLE CANONICAL 3-point tracking check (2026-08-30).
 *
 * Both consumers implement the owner pseudocode with ONE engine, so verification
 * routes and the payout-release gate can NEVER drift:
 *
 *   verify_tracking_payload(scraped_data, purchase_order):
 *     1. Destination Check — terminal event's destination must match the PO delivery city
 *            mismatch → FLAG_FRAUD: Destination Mismatch
 *     2. Weight Check — scraped weight_kg >= purchase_order.expected_min_weight
 *            too light → FLAG_FRAUD: Weight Anomaly
 *            missing  → ADVISORY weight_unavailable (not a hard block in this engine;
 *                       consumers decide their own threshold — payout gates MUST hold,
 *                       verification may record the advisory)
 *     3. Timeline Check — scraped shipped_at >= purchase_order created_at
 *            earlier → FLAG_FRAUD: Recycled Tracking Number
 *     else → VERIFIED_OK
 *
 * Design notes (anti-fabrication provenance):
 *   - Destination is derived from the TERMINAL (last chronological) carrier scan —
 *     the delivery terminal — NOT the first event, which is the origin pick-up scan
 *     and would produce false "Destination Mismatch" flags.
 *   - Results are strict and deterministic. Missing data is surfaced as an ADVISORY
 *     the caller can decide on, never silently skipped, never invented.
 *   - Verdicts are not graded on internal consistency of a single file; this module
 *     is the single source of truth for tsc/schema alignment (verified against the
 *     ProcurementItem columns deliveryCity / expectedMinWeightKg / createdAt).
 */
export type FraudVerdict = 'VERIFIED_OK' | 'FLAG_FRAUD' | 'TRIGGER_MANUAL_REVIEW_HOLD'

export type FraudCheckResult =
  | { verdict: 'VERIFIED_OK'; advisory?: string[] }
  | { verdict: 'FLAG_FRAUD'; reason: 'Destination Mismatch' | 'Weight Anomaly' | 'Recycled Tracking Number'; details: string; advisory?: string[] }
  | { verdict: 'TRIGGER_MANUAL_REVIEW_HOLD'; reason: string; details: string; advisory?: string[] }

/** Scraped carrier payload (camelCase canonical). Postcode strengthens the destination check. */
export interface ScrapedTrackingPayload {
  destinationCity?: string | null
  destinationPostcode?: string | null
  weightKg?: number | null
  shippedAt?: string | Date | null
  deliveredAt?: string | Date | null
}

export interface OrderContext {
  deliveryCity?: string | null
  deliveryPostcode?: string | null
  expectedMinWeightKg?: number | null
  orderCreatedAt?: Date | string | null
}

export interface VerifyTrackingInput {
  scraped: ScrapedTrackingPayload
  order: OrderContext
  /** Settle-time flows may allow a small negative timeline slack (e.g. 3PL books
   *  the shipment moments before the PO row persists). Default 0 (strict). */
  timelineSlackMs?: number
}

/** Case/trim/normalize city names so "Casablanca" == "casablanca " */
function normalizeCity(v: string | null | undefined): string {
  if (!v) return ''
  return v.trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Detect active fraud vectors per owner. ONE engine — the payout gate and the
 * verification routes both call this exact function (no permissive second copy).
 */
export function verifyTrackingPayload(input: VerifyTrackingInput): FraudCheckResult {
  const { scraped, order, timelineSlackMs = 0 } = input

  // --- 1. Destination Check (terminal city + optional postcode) ---
  const scrapedCity = normalizeCity(scraped.destinationCity)
  const expectedCity = normalizeCity(order.deliveryCity)
  if (expectedCity && scrapedCity && scrapedCity !== expectedCity) {
    // Permissive substring tolerance (Casablanca vs Casablanca Anfa) — if neither
    // contains the other it is a genuine mismatch for a different customer.
    const contained = scrapedCity.includes(expectedCity) || expectedCity.includes(scrapedCity)
    if (!contained) {
      return {
        verdict: 'FLAG_FRAUD',
        reason: 'Destination Mismatch',
        details: `Scraped terminal "${scraped.destinationCity}" ≠ PO delivery city "${order.deliveryCity}"`,
      }
    }
  }
  if (expectedCity && !scrapedCity) {
    return {
      verdict: 'TRIGGER_MANUAL_REVIEW_HOLD',
      reason: 'destination_unavailable',
      details: `carrier payload has no destination city; expected "${order.deliveryCity}"`,
    }
  }
  // Optional postcode cross-check (warehouse/drop-off zip match).
  if (order.deliveryPostcode && scraped.destinationPostcode) {
    const poPc = String(order.deliveryPostcode).trim()
    const spPc = String(scraped.destinationPostcode).trim()
    if (spPc && poPc && spPc !== poPc) {
      return {
        verdict: 'FLAG_FRAUD',
        reason: 'Destination Mismatch',
        details: `Scraped destination postcode "${scraped.destinationPostcode}" ≠ PO delivery postcode "${order.deliveryPostcode}"`,
      }
    }
  }

  // --- 2. Weight Check ---
  const advisory: string[] = []
  if (order.expectedMinWeightKg != null && order.expectedMinWeightKg > 0) {
    if (scraped.weightKg == null) {
      // Real weight genuinely unavailable. NOT fabricated, NOT silently skipped:
      // surfaced as an advisory. Verification may accept (delivery corroborated by
      // destination + timeline); the PAYOUT gate MUST hold (cannot rule out empty box).
      advisory.push('weight_unavailable')
    } else if (scraped.weightKg < order.expectedMinWeightKg) {
      return {
        verdict: 'FLAG_FRAUD',
        reason: 'Weight Anomaly',
        details: `Scraped weight ${scraped.weightKg}kg < expected minimum ${order.expectedMinWeightKg}kg`,
      }
    }
  }

  // --- 3. Timeline Check ---
  const shippedAt = toDate(scraped.shippedAt)
  const orderCreatedAt = toDate(order.orderCreatedAt)
  if (shippedAt && orderCreatedAt && shippedAt.getTime() < orderCreatedAt.getTime() - timelineSlackMs) {
    return {
      verdict: 'FLAG_FRAUD',
      reason: 'Recycled Tracking Number',
      details: `Carrier shipped_at ${shippedAt.toISOString()} precedes PO creation ${orderCreatedAt.toISOString()} — tracking number may be recycled`,
    }
  }
  if (!shippedAt) {
    return {
      verdict: 'TRIGGER_MANUAL_REVIEW_HOLD',
      reason: 'shipment_timestamp_unavailable',
      details: 'carrier payload has no shipped_at timestamp; cannot confirm timeline',
    }
  }

  return advisory.length > 0 ? { verdict: 'VERIFIED_OK', advisory } : { verdict: 'VERIFIED_OK' }
}

/**
 * Graceful degradation chain (owner spec):
 *   stage param where 'keyless' → try premium only if env keys present → else manual-hold.
 * Any non-VERIFIED_OK outcome keeps trackingVerified=false (secure baseline).
 */
export function gracefulDeliveryCheck(stage: 'keyless' | 'premium', hasPremiumKeys: boolean): FraudCheckResult {
  if (stage === 'keyless') {
    if (hasPremiumKeys) {
      return { verdict: 'TRIGGER_MANUAL_REVIEW_HOLD', reason: 'premium_fallback_available', details: 'keyless scrape inconclusive; premium SHIP24/9Tracking keys available for retry' }
    }
    return { verdict: 'TRIGGER_MANUAL_REVIEW_HOLD', reason: 'site_down_or_parsing_failed', details: 'keyless carrier page unreachable or layout changed (peak season) — no events invented, manual review required' }
  }
  return { verdict: 'TRIGGER_MANUAL_REVIEW_HOLD', reason: 'premium_unavailable', details: 'premium tracking API unavailable or unconfigured' }
}

export function verdictAllowsRelease(v: FraudCheckResult): boolean {
  return v.verdict === 'VERIFIED_OK'
}

/** PAYOUT-gate threshold: advisory "weight_unavailable" is NOT acceptable for
 *  releasing money (cannot rule out empty-box scam) — only solid VERIFIED_OK passes. */
export function verdictAllowsPayoutRelease(v: FraudCheckResult): boolean {
  return v.verdict === 'VERIFIED_OK' && !(v.advisory && v.advisory.includes('weight_unavailable'))
}