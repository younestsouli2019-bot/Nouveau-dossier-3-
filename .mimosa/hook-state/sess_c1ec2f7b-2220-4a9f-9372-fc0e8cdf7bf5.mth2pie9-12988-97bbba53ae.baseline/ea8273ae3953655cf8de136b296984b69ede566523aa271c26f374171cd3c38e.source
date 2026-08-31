import { describe, it, expect } from 'vitest'
import {
  verifyTrackingPayload,
  gracefulDeliveryCheck,
  verdictAllowsRelease,
  verdictAllowsPayoutRelease,
} from './tracking-fraud-guard'
import type {
  ScrapedTrackingPayload,
  OrderContext,
  FraudCheckResult,
} from './tracking-fraud-guard'

const BASE_SCRAPED: ScrapedTrackingPayload = {
  destinationCity: 'Casablanca',
  destinationPostcode: '20000',
  weightKg: 5,
  shippedAt: new Date('2026-08-20T10:00:00Z'),
}

const BASE_ORDER: OrderContext = {
  deliveryCity: 'Casablanca',
  deliveryPostcode: '20000',
  expectedMinWeightKg: 4,
  orderCreatedAt: new Date('2026-08-19T10:00:00Z'),
}

describe('verifyTrackingPayload', () => {
  it('returns VERIFIED_OK when destination matches, weight is sufficient, and timeline is valid', () => {
    const result = verifyTrackingPayload({ scraped: BASE_SCRAPED, order: BASE_ORDER })
    expect(result.verdict).toBe('VERIFIED_OK')
    expect(('advisory' in result ? result.advisory : undefined)).toBeUndefined()
  })

  it('returns VERIFIED_OK even when advisory fields are absent from scraped payload but no fraud vector exists', () => {
    const result = verifyTrackingPayload({
      scraped: { destinationCity: 'Rabat', weightKg: 5, shippedAt: new Date('2026-08-20T10:00:00Z') },
      order: { deliveryCity: 'Rabat', expectedMinWeightKg: 4, orderCreatedAt: new Date('2026-08-19T10:00:00Z') },
    })
    expect(result).toEqual({ verdict: 'VERIFIED_OK' })
  })

  it('flags Destination Mismatch when scraped terminal city differs from PO delivery city', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, destinationCity: 'Marrakech' },
      order: BASE_ORDER,
    })
    expect(result).toEqual({ verdict: 'FLAG_FRAUD', reason: 'Destination Mismatch', details: expect.any(String) })
  })

  it('flags Destination Mismatch when postcode differs even if city matches', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, destinationPostcode: '99999' },
      order: BASE_ORDER,
    })
    expect(result).toEqual({ verdict: 'FLAG_FRAUD', reason: 'Destination Mismatch', details: expect.any(String) })
  })

  it('triggers manual-review hold when destination city is missing but expected', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, destinationCity: null },
      order: BASE_ORDER,
    })
    expect(result).toEqual({ verdict: 'TRIGGER_MANUAL_REVIEW_HOLD', reason: 'destination_unavailable', details: expect.any(String) })
  })

  it('flags Weight Anomaly when scraped weight is below the expected minimum', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, weightKg: 1 },
      order: BASE_ORDER,
    })
    expect(result).toEqual({ verdict: 'FLAG_FRAUD', reason: 'Weight Anomaly', details: expect.any(String) })
  })

  it('surfaces weight_unavailable as an advisory with VERIFIED_OK when weight is missing', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, weightKg: null },
      order: BASE_ORDER,
    })
    expect(result.verdict).toBe('VERIFIED_OK')
    expect((result as { advisory?: string[] }).advisory).toEqual(['weight_unavailable'])
  })

  it('advisory weight_unavailable blocks payout release but allows general release', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, weightKg: null },
      order: BASE_ORDER,
    }) as FraudCheckResult
    expect(verdictAllowsRelease(result)).toBe(true)
    expect(verdictAllowsPayoutRelease(result)).toBe(false)
  })

  it('flags Recycled Tracking Number when shippedAt precedes PO creation beyond slack', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, shippedAt: new Date('2026-08-10T10:00:00Z') },
      order: BASE_ORDER,
    })
    expect(result).toEqual({ verdict: 'FLAG_FRAUD', reason: 'Recycled Tracking Number', details: expect.any(String) })
  })

  it('allows shippedAt slightly before orderCreatedAt within timeline slack', () => {
    const result = verifyTrackingPayload({
      scraped: {
        ...BASE_SCRAPED,
        shippedAt: new Date('2026-08-19T09:59:00Z'),
      },
      order: BASE_ORDER,
      timelineSlackMs: 2 * 60 * 1000,
    })
    expect(result.verdict).toBe('VERIFIED_OK')
  })

  it('triggers manual-review hold when shippedAt timestamp is missing', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, shippedAt: null },
      order: BASE_ORDER,
    })
    expect(result).toEqual({ verdict: 'TRIGGER_MANUAL_REVIEW_HOLD', reason: 'shipment_timestamp_unavailable', details: expect.any(String) })
  })

  it('skips weight check without crashing when expectedMinWeightKg is null', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, weightKg: 0 },
      order: { ...BASE_ORDER, expectedMinWeightKg: null },
    })
    expect(result.verdict).toBe('VERIFIED_OK')
  })

  it('skips weight check without crashing when expectedMinWeightKg is 0', () => {
    const result = verifyTrackingPayload({
      scraped: { ...BASE_SCRAPED, weightKg: 0 },
      order: { ...BASE_ORDER, expectedMinWeightKg: 0 },
    })
    expect(result.verdict).toBe('VERIFIED_OK')
  })
})

describe('gracefulDeliveryCheck', () => {
  it('holds for keyless stage with premium keys available', () => {
    expect(gracefulDeliveryCheck('keyless', true)).toEqual({
      verdict: 'TRIGGER_MANUAL_REVIEW_HOLD',
      reason: 'premium_fallback_available',
      details: expect.any(String),
    })
  })

  it('holds for keyless stage without premium keys', () => {
    expect(gracefulDeliveryCheck('keyless', false)).toEqual({
      verdict: 'TRIGGER_MANUAL_REVIEW_HOLD',
      reason: 'site_down_or_parsing_failed',
      details: expect.any(String),
    })
  })

  it('holds for premium stage when unavailable', () => {
    expect(gracefulDeliveryCheck('premium', false)).toEqual({
      verdict: 'TRIGGER_MANUAL_REVIEW_HOLD',
      reason: 'premium_unavailable',
      details: expect.any(String),
    })
  })
})
