/**
 * Morocco Procurement Payment-Gateway Router + Payout-Release Gate (Fail-Closed)
 *
 * Operational directives 2026-08-30:
 *   - Local card gateways for B2B sourcing (restocking Superfood.ma, etc.):
 *       PayZone, YouCan Pay, CMI, or Stripe Atlas (Moroccan corporate + international entity).
 *     All provide REST APIs with webhook-driven payout release once trackingVerified=true.
 *   - Authorize-Only (hold) pattern (Stripe/CMI/Shopify Payments):
 *       Authorize the card first. Call the Capture API ONLY after keyless tracking
 *       detects "Delivered" + the 3-point PO fraud guard ALL PASS (destination/weight/timeline)
 *       + zip matches warehouse/drop-off point.
 *   - 3PL proxy (Cathedis, Chrono Diali, Yassir): deposit rolling cash balance with the
 *       local 3PL; the 3PL inspects contents at hub for empty-box scam, pays driver from
 *       balance, inputs tracking receipt into the system; settlement is 3PL internal.
 *   - COD (Amana Contre Remboursement): funds captured ONLY if buyer signs for contents
 *       at delivery; otherwise auto-delay payout 24h post actualDelivery to allow disputes.
 *
 * THIS MODULE IS FAIL-CLOSED:
 *   - If ANY gateway API key is missing → gateway reports available: false with reason.
 *   - If 3-point fraud guard ANY FLAG → payout release FAILS with clear code + reason,
 *     never silently releases.
 *   - If trackingVerified=false or (COD && dispute window not elapsed) → HOLD.
 */

import { verifyTrackingPayload } from '@/lib/procurement/tracking-fraud-guard'

export type GatewayName =
  | 'PayZone'
  | 'YouCan Pay'
  | 'CMI (Centre Monétique Interbancaire)'
  | 'Stripe Atlas (international only)'
  | 'Chari Pay (ChariBaaS)'
  | 'AmanPay'
  | '3PL Rolling Balance (Cathedis / Chrono Diali / Yassir)'

export interface GatewayConfig {
  name: GatewayName
  configured: boolean
  requiredEnvKeys: string[]
  presentEnvKeys: string[]
  available: boolean
  reason: string
  acceptsMoroccanCards: boolean
  acceptsInternationalCards: boolean
  supportsAuthorizeOnlyCapture: boolean
  supportsWebhooks: boolean
  docsUrl: string
  apyFeesNote: string
}

const GATEWAY_SPECS: Array<{
  name: GatewayName
  envKeys: string[]
  acceptsMoroccanCards: boolean
  acceptsInternationalCards: boolean
  supportsAuthorizeOnlyCapture: boolean
  supportsWebhooks: boolean
  docsUrl: string
  apyFeesNote: string
}> = [
  {
    name: 'PayZone',
    envKeys: ['PAYZONE_MERCHANT_ID', 'PAYZONE_API_KEY', 'PAYZONE_SECRET'],
    acceptsMoroccanCards: true,
    acceptsInternationalCards: true,
    supportsAuthorizeOnlyCapture: true,
    supportsWebhooks: true,
    docsUrl: 'https://payzone.ma/',
    apyFeesNote: '2.0%–3.5% per transaction + optional monthly 300–800 MAD. 1–3 week onboarding, good REST docs.',
  },
  {
    name: 'YouCan Pay',
    envKeys: ['YOUCANPAY_PUBLIC_KEY', 'YOUCANPAY_PRIVATE_KEY', 'YOUCANPAY_STORE_ID'],
    acceptsMoroccanCards: true,
    acceptsInternationalCards: false,
    supportsAuthorizeOnlyCapture: false,
    supportsWebhooks: true,
    docsUrl: 'https://youcanpay.com/',
    apyFeesNote: '3.9% + 2 MAD per successful Moroccan card transaction. 5 000 MAD/day cap default; volume tiers up to 100k/day.',
  },
  {
    name: 'CMI (Centre Monétique Interbancaire)',
    envKeys: ['CMI_MERCHANT_ID', 'CMI_STORE_KEY', 'CMI_CLIENT_ID', 'CMI_SECRET'],
    acceptsMoroccanCards: true,
    acceptsInternationalCards: true,
    supportsAuthorizeOnlyCapture: true,
    supportsWebhooks: false,
    docsUrl: 'https://www.cmi.co.ma/',
    apyFeesNote: '1.8%–3.5%. 20M+ Moroccan cards connected to all 19 banks. Onboarding 2–6 weeks.',
  },
  {
    name: 'Stripe Atlas (international only)',
    envKeys: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
    acceptsMoroccanCards: false,
    acceptsInternationalCards: true,
    supportsAuthorizeOnlyCapture: true,
    supportsWebhooks: true,
    docsUrl: 'https://stripe.com/atlas',
    apyFeesNote: '2.9% + $0.30 per international card. Requires US legal entity (Atlas ~$500 setup). CANNOT accept Moroccan bank cards natively; pair with CMI/PayZone for local.',
  },
  {
    name: 'Chari Pay (ChariBaaS)',
    envKeys: ['CHARIPAY_API_KEY', 'CHARIPAY_MERCHANT_ID', 'CHARIPAY_WEBHOOK_SECRET'],
    acceptsMoroccanCards: true,
    acceptsInternationalCards: true,
    supportsAuthorizeOnlyCapture: true,
    supportsWebhooks: true,
    docsUrl: 'https://www.baas.ma/',
    apyFeesNote: 'Modern REST/OpenAPI. Testing sandbox. 2–5 day onboarding. Maroc Pay QR + cards unified.',
  },
  {
    name: 'AmanPay',
    envKeys: ['AMANPAY_MERCHANT_ID', 'AMANPAY_API_KEY'],
    acceptsMoroccanCards: true,
    acceptsInternationalCards: false,
    supportsAuthorizeOnlyCapture: false,
    supportsWebhooks: true,
    docsUrl: 'https://amanpay.ma/',
    apyFeesNote: 'Simplicity for small merchants. Pair with CMI/PayZone for volume.',
  },
  {
    name: '3PL Rolling Balance (Cathedis / Chrono Diali / Yassir)',
    envKeys: ['THREE_PL_BALANCE_CURRENCY', 'THREE_PL_CONTACT_EMAIL'],
    acceptsMoroccanCards: false,
    acceptsInternationalCards: false,
    supportsAuthorizeOnlyCapture: false,
    supportsWebhooks: false,
    docsUrl: 'https://www.chronodiali.ma/ | https://yassir.com/',
    apyFeesNote: 'Deposit rolling cash balance with the 3PL partner. 3PL staff pays driver from balance upon hub inspection. Internal bookkeeping only; driver gets cash; bot sees 3PL receipt scanned.',
  },
]

export function gatewayHealthCheck(envOverride?: Record<string, string | undefined>): GatewayConfig[] {
  const env = envOverride ?? (typeof process !== 'undefined' ? process.env : {})
  return GATEWAY_SPECS.map((spec) => {
    const present = spec.envKeys.filter((k) => {
      const v = env[k]
      return typeof v === 'string' && v.trim().length > 0 && !/^(your|sk_test_xxx|pk_test_xxx|xxxx|place.?holder|changeme|none|null)$/i.test(v.trim())
    })
    const configured = present.length === spec.envKeys.length
    const missing = spec.envKeys.filter((k) => !present.includes(k))
    const available = configured
    let reason = available
      ? 'Configured. Keys present; webhook-driven payout release ready when trackingVerified=true + 3-point PO fraud guard passes.'
      : `FAIL-CLOSED: missing env keys [${missing.join(', ')}]. Populate these keys in .env or operator secrets; gateway unavailable until then.`
    if (!spec.acceptsMoroccanCards) reason += ' | NOTE: cannot accept native Moroccan CMI bank cards — pair with CMI/PayZone/YouCan Pay for local cards.'
    return {
      name: spec.name,
      configured,
      requiredEnvKeys: spec.envKeys,
      presentEnvKeys: present,
      available,
      reason,
      acceptsMoroccanCards: spec.acceptsMoroccanCards,
      acceptsInternationalCards: spec.acceptsInternationalCards,
      supportsAuthorizeOnlyCapture: spec.supportsAuthorizeOnlyCapture,
      supportsWebhooks: spec.supportsWebhooks,
      docsUrl: spec.docsUrl,
      apyFeesNote: spec.apyFeesNote,
    }
  })
}

export function firstAvailableGateway(envOverride?: Record<string, string | undefined>): GatewayConfig | null {
  return gatewayHealthCheck(envOverride).find((g) => g.available) ?? null
}

/* ======================================================================
 * 3-POINT PO FRAUD GUARD (owner-provided, translated)
 *
 * Verifies scraped carrier payload against the original purchase order.
 * Prevents sellers providing a real but mismatched tracking number.
 *
 *   1. Destination city  — must match the Moroccan hub/city on the PO.
 *   2. Weight anomaly    — prevents sending empty envelopes for heavy goods.
 *   3. Timeline check    — stops recycled/old tracking numbers (shipment
 *                          timestamp before PO placement = IMPOSSIBLE).
 * ====================================================================== */

export interface ScrapedTrackingPayload {
  destination_city?: string
  destination_postcode?: string
  weight_kg?: number
  shipped_at?: string | Date
  delivered_at?: string | Date
  raw?: Record<string, unknown>
}

export interface PurchaseOrderReference {
  id?: string
  delivery_city?: string
  delivery_postcode?: string
  expected_min_weight_kg?: number
  created_at: string | Date
  items_total_qty?: number
  hub_name?: string
}

export type FraudFlag =
  | 'FLAG_FRAUD_DESTINATION_MISMATCH'
  | 'FLAG_FRAUD_WEIGHT_ANOMALY'
  | 'FLAG_FRAUD_RECYCLED_TIMELINE'
  | 'FLAG_MANUAL_REVIEW_HOLD'

export interface FraudGuardResult {
  ok: boolean
  flags: FraudFlag[]
  reasons: string[]
  /** Non-fatal advisories from the canonical engine (e.g. weight_unavailable).
   *  Payout consumers MUST treat advisory != [] as HOLD — cannot rule out an
   *  empty-box scam when the carrier never reported a weight. */
  advisory: string[]
}

export function verifyTrackingPayloadAgainstPO(
  scraped: ScrapedTrackingPayload,
  po: PurchaseOrderReference,
): FraudGuardResult {
  // UNIFIED ENGINE (2026-08-30): this adapter delegates the 3 points to the
  // canonical strict guard in tracking-fraud-guard.ts (owner pseudocode).
  // There is exactly ONE fraud-policy implementation now; the previous
  // permissive reimplementation here (skip-when-missing, independent slack)
  // drifted from it. Settle-time flows pass timelineSlackMs = 2h (3PL may
  // physically book the shipment moments before the PO row persists).
  const flags: FraudFlag[] = []
  const reasons: string[] = []

  // Postcode check stays local (the canonical guard compares cities only).
  const scrapedPc = (scraped.destination_postcode || '').trim()
  const poPc = (po.delivery_postcode || '').trim()
  if (poPc && scrapedPc && scrapedPc !== poPc) {
    flags.push('FLAG_FRAUD_DESTINATION_MISMATCH')
    reasons.push(
      `POSTCODE MISMATCH: scraped carrier postcode="${scraped.destination_postcode}" but PO delivery_postcode="${po.delivery_postcode}". Require real postcode match to release.`,
    )
  }

  const verdict = verifyTrackingPayload(
    {
      scraped: {
        destinationCity: scraped.destination_city ?? null,
        weightKg: typeof scraped.weight_kg === 'number' ? scraped.weight_kg : null,
        shippedAt: scraped.shipped_at ?? null,
      },
      order: {
        deliveryCity: po.delivery_city ?? po.hub_name ?? null,
        expectedMinWeightKg: typeof po.expected_min_weight_kg === 'number' ? po.expected_min_weight_kg : null,
        orderCreatedAt: po.created_at,
      },
      timelineSlackMs: 2 * 60 * 60 * 1000,
    },
  )

  if (verdict.verdict === 'VERIFIED_OK') {
    return { ok: flags.length === 0 && (verdict.advisory?.length ?? 0) === 0, flags, reasons, advisory: verdict.advisory ?? [] }
  }
  if (verdict.verdict === 'FLAG_FRAUD') {
    const flag: FraudFlag =
      verdict.reason === 'Destination Mismatch' ? 'FLAG_FRAUD_DESTINATION_MISMATCH'
      : verdict.reason === 'Weight Anomaly' ? 'FLAG_FRAUD_WEIGHT_ANOMALY'
      : 'FLAG_FRAUD_RECYCLED_TIMELINE'
    return { ok: false, flags: [...flags, flag], reasons: [...reasons, `${verdict.reason.toUpperCase()}: ${verdict.details}`], advisory: verdict.advisory ?? [] }
  }
  return {
    ok: false,
    flags: [...flags, 'FLAG_MANUAL_REVIEW_HOLD'],
    reasons: [...reasons, `MANUAL REVIEW HOLD (${verdict.reason}): ${verdict.details} — payout stays HELD; resolve via the manual-review queue.`],
    advisory: verdict.advisory ?? [],
  }
}

/* ======================================================================
 * PAYOUT RELEASE GATE — the unified decision gate
 *
 * Combines:
 *   • 3-point fraud guard above
 *   • trackingVerified=true  (real public-carrier event, not synthetic)
 *   • COD dispute window      (24h default post actualDelivery for Amana
 *                             Contre Remboursement OR receiptConfirmed
 *                             sign-off bypasses)
 *   • zip/hub match           (enriched as part of destination_city)
 *   • optional manual receipt sign-off (receiptConfirmedBy a real human,
 *     not "system-auto")
 *
 * FAIL-CLOSED: UNLESS EVERY BOX TICKED → HOLD with detailed reason list.
 * ====================================================================== */

export interface ShipmentEvidence {
  trackingVerified: boolean
  trackingVerifiedAt?: string | Date
  actualDelivery?: string | Date
  status?: string
  carrier?: string
  trackingNumber?: string
}

export interface ReceiptEvidence {
  receiptConfirmedBy?: string
  receiptConfirmedAt?: string | Date
  receiptDeliveryProofHash?: string
  quantityReceived?: number
}

export type PayoutHoldReason =
  | 'HOLD_TRACKING_NOT_VERIFIED'
  | 'HOLD_COD_DISPUTE_WINDOW_NOT_ELAPSED'
  | 'HOLD_3POINT_FRAUD_GUARD_FAILED'
  | 'HOLD_3POINT_FRAUD_GUARD_INCOMPLETE'
  | 'HOLD_NO_RECEIPT_SIGN_OFF'
  | 'HOLD_QUANTITY_NOT_MATCHING'
  | 'HOLD_NO_GATEWAY_CONFIGURED'
  | 'HOLD_NO_REAL_DELIVERY_PROOF_HASH'

export interface PayoutReleaseGateResult {
  release: boolean
  releaseAt?: Date
  holdReasons: PayoutHoldReason[]
  holdDescriptions: string[]
  paymentMethodAdvice: string
  disputeWindowMs: number
  remainingMs?: number
}

export function isAmanaCOD(carrierName?: string): boolean {
  if (!carrierName) return false
  return /contre remboursement|COD|Amana|Avito/i.test(carrierName)
}

export function isSyntheticOracleHash(h: string | undefined | null): boolean {
  if (!h) return true
  const s = String(h).trim()
  if (s.length === 0) return true
  // Bare 64-char hex with no external anchor = locally-computed SHA, not a POD/scan ref.
  if (/^[a-f0-9]{64}$/i.test(s)) return true
  return false
}

export interface PayoutReleaseGateOpts {
  codDisputeWindowMs?: number
  requireHumanSignOff?: boolean
  requireQuantityMatch?: boolean
  totalOrderedQty?: number
}

const DEFAULT_COD_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

export function payoutReleaseGate(
  shipment: ShipmentEvidence,
  receipt: ReceiptEvidence,
  scraped: ScrapedTrackingPayload | null,
  po: PurchaseOrderReference | null,
  envOverride?: Record<string, string | undefined>,
  opts: PayoutReleaseGateOpts = {},
): PayoutReleaseGateResult {
  const holdReasons: PayoutHoldReason[] = []
  const holdDescriptions: string[] = []

  const cod = isAmanaCOD(shipment.carrier)
  const disputeWindowMs = opts.codDisputeWindowMs ?? (cod ? DEFAULT_COD_WINDOW_MS : 0)

  const now = Date.now()

  // 1. trackingVerified must be true (real carrier event detected; NEVER the oracle hash).
  if (!shipment.trackingVerified) {
    holdReasons.push('HOLD_TRACKING_NOT_VERIFIED')
    holdDescriptions.push(
      `trackingVerified=false. Public keyless carrier scraper has not yet detected "Delivered" for carrier="${shipment.carrier || '?'}" tracking="${shipment.trackingNumber || '?'}". Carrier Status Lag note: Poste Maroc/Amana parsers may be temporarily down in peaks — retry later. NEVER invent delivered events.`,
    )
  }

  // 2. COD 24h dispute window OR human buyer sign-off.
  let remainingMs: number | undefined
  if (cod) {
    const signedByReal =
      receipt.receiptConfirmedBy &&
      receipt.receiptConfirmedBy.trim().length >= 3 &&
      String(receipt.receiptConfirmedBy).toLowerCase() !== 'system-auto'
    if (signedByReal) {
      // Buyer physically signed off — COD dispute window bypassed per seller contract.
    } else if (shipment.actualDelivery) {
      const elapsed = now - new Date(shipment.actualDelivery).getTime()
      if (elapsed < disputeWindowMs) {
        remainingMs = disputeWindowMs - elapsed
        holdReasons.push('HOLD_COD_DISPUTE_WINDOW_NOT_ELAPSED')
        holdDescriptions.push(
          `Amana Contre Remboursement (COD) dispute window: ${(remainingMs / 3600000).toFixed(1)}h remaining of 24h. Release at ${new Date(now + remainingMs).toISOString()}. Alternatively: require buyer sign-off (receiptConfirmedBy=real human, not system-auto) to bypass.`,
        )
      }
    } else {
      holdReasons.push('HOLD_COD_DISPUTE_WINDOW_NOT_ELAPSED')
      holdDescriptions.push(
        'Amana COD selected but actualDelivery timestamp missing — cannot start 24h dispute window. Paste carrier actualDelivery date or use receiptConfirmedBy sign-off to release.',
      )
    }
  }

  // 3. 3-point fraud guard — NON-DECORATIVE (2026-08-30): the old clause SKIPPED the
  // guard entirely when scraped/po was null, so "(F) guard ALL PASS" was never actually
  // enforced. FAIL-CLOSED: settlement REQUIRES the guard to run and pass.
  if (!scraped || !po) {
    holdReasons.push('HOLD_3POINT_FRAUD_GUARD_INCOMPLETE')
    holdDescriptions.push(
      `3-point PO fraud guard could NOT run: ${!scraped && !po ? 'no scraped carrier payload AND no PO context' : !scraped ? 'no scraped carrier payload (carrier events + weight)' : 'no PO context (deliveryCity / expectedMinWeightKg / createdAt)'} — provide both before settlement. FAIL-CLOSED per sovereign ruling.`,
    )
  } else {
    const guard = verifyTrackingPayloadAgainstPO(scraped, po)
    if (!guard.ok) {
      holdReasons.push('HOLD_3POINT_FRAUD_GUARD_FAILED')
      guard.reasons.forEach((r) => holdDescriptions.push(r))
      if (guard.advisory?.includes('weight_unavailable')) {
        holdDescriptions.push(
          'weight_unavailable: carrier never reported a parcel weight while the PO has an expected_min_weight_kg — cannot rule out empty-box scam. Physical inspection / manual confirmation required before payout release.',
        )
      }
    }
  }

  // 4. (Optional) Human sign-off.
  if (opts.requireHumanSignOff ?? cod) {
    const real =
      receipt.receiptConfirmedBy &&
      receipt.receiptConfirmedBy.trim().length >= 3 &&
      String(receipt.receiptConfirmedBy).toLowerCase() !== 'system-auto' &&
      receipt.receiptConfirmedAt
    if (!real) {
      holdReasons.push('HOLD_NO_RECEIPT_SIGN_OFF')
      holdDescriptions.push(
        `Human buyer sign-off required (receiptConfirmedBy != system-auto, receiptConfirmedAt set). Current: by="${receipt.receiptConfirmedBy || ''}" at="${String(receipt.receiptConfirmedAt || '')}". For Amana COD, physical sign-off at delivery is the proof of no empty-box.`,
      )
    }
  }

  // 5. (Optional) Quantity match.
  if (opts.requireQuantityMatch && opts.totalOrderedQty != null) {
    const ok = typeof receipt.quantityReceived === 'number' && receipt.quantityReceived >= opts.totalOrderedQty
    if (!ok) {
      holdReasons.push('HOLD_QUANTITY_NOT_MATCHING')
      holdDescriptions.push(
        `qtyReceived=${String(receipt.quantityReceived)} but ordered=${opts.totalOrderedQty}. Quantity mismatch — short shipment or empty box suspected. HOLD.`,
      )
    }
  }

  // 6. Non-synthetic delivery proof hash.
  if (isSyntheticOracleHash(receipt.receiptDeliveryProofHash)) {
    holdReasons.push('HOLD_NO_REAL_DELIVERY_PROOF_HASH')
    holdDescriptions.push(
      `deliveryProofHash is bare 64-hex oracle hash (locally computed SHA-256 of transition JSON) or empty — that is SYNTHETIC, not real. REQUIRED: POD photo/scan hash with external anchor (prefix pod:/scan:/AMANA-/POSTE-/JUMIA- etc.) before release.`,
    )
  }

  // 7. At least one gateway must be configured.
  const gw = firstAvailableGateway(envOverride)
  if (!gw) {
    holdReasons.push('HOLD_NO_GATEWAY_CONFIGURED')
    holdDescriptions.push(
      'No payment gateway has API keys configured. Populate PayZone/YouCan Pay/CMI/Stripe/Chari Pay env keys, or fund 3PL rolling balance. Payout stays HELD (fail-closed) — no auto-capture attempted.',
    )
  }

  const release = holdReasons.length === 0
  const releaseAt = release
    ? new Date(now + (cod ? 0 : 0))
    : remainingMs != null
      ? new Date(now + remainingMs)
      : undefined

  const advice = (() => {
    if (cod)
      return 'Amana Contre Remboursement (COD) flow: capture funds via gateway/webhook ONLY AFTER buyer physical sign-off at delivery (or 24h post-actualDelivery with no dispute opened).'
    if (gw?.supportsAuthorizeOnlyCapture)
      return 'Authorize-Only + Capture flow: call Gateway.Authorize(amount) at PO placed; call Gateway.Capture() ONLY when this gate returns release=true AND 3-point fraud guard passes AND zip matches warehouse.'
    if (gw?.name === '3PL Rolling Balance (Cathedis / Chrono Diali / Yassir)')
      return '3PL proxy flow: 3PL hub staff inspects contents, pays driver from rolling balance, scans the receipt. System records receipt + 3PL internal ref as proof.'
    return 'Standard webhook payout release: gateway webhook + trackingVerified=true + fraud guard all green.'
  })()

  return {
    release,
    releaseAt,
    holdReasons,
    holdDescriptions,
    paymentMethodAdvice: advice,
    disputeWindowMs,
    remainingMs,
  }
}
