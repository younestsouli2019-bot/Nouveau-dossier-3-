/**
 * Delivery-Experience Optimization (return-reduction directives, owner 2026-08-30)
 *
 * Moroccan e-commerce returns are reduced by treating delivery as an extension of the
 * brand, not an operations constraint. When the CRBT/payout stack decides to release or
 * hold, these best practices influence *how* we communicate and *which* carrier/re-delivery
 * options we pick for buyer (recipient: Hind / Younes / Bachir) orders.
 *
 * Recommended practices (source: owner advisory):
 *  1. Post-purchase communication — send SMS/email with the tracking number immediately
 *     at shipment. An informed buyer is reassured and far less likely to cancel/refuse at
 *     the door. (carrier notes: Quick Livraison auto-sends WhatsApp/SMS delivery alerts.)
 *  2. Flexible delivery slots — prefer carriers offering re-delivery or relay-point drop-off
 *     (points relais) to cut failed deliveries (returns + lost clients + admin cost).
 *     Good fits: Quick Livraison (440+ cities), Mylerz, Express Relais (connected lockers),
 *     Tawssil (inter-city + relay), Cathedis.
 *  3. Packaging — branded, protective unboxing reduces damage returns and is cheap
 *     loyalty/word-of-mouth (cosmetics / fashion / gifts). Note in package QA checks.
 *  4. Clear return policy — a simple, clearly-displayed return policy reassures pre-purchase
 *     and (paradoxically) reduces effective returns. Morocco return handling is still a
 *     weak point across e-commerce — document the policy on the storefront.
 *
 * This is advisory guidance; it does not override the fail-closed payout-release gate.
 */

export interface DeliveryExperienceAdvice {
  notifyBuyer: boolean
  notifyWhen?: 'on_shipment' // always on first real tracking number
  communicationChannels: Array<'sms' | 'email' | 'whatsapp'>
  preferCarriersAndReason: Array<{ carrierId: string; reason: string }>
  recommendRelayPoint: boolean
  packagingChecklist: string[]
  returnPolicyNote: string
}

export const DELIVERY_EXPERIENCE_DEFAULTS: DeliveryExperienceAdvice = {
  notifyBuyer: true,
  notifyWhen: 'on_shipment',
  communicationChannels: ['sms', 'email'],
  preferCarriersAndReason: [
    { carrierId: 'quick-livraison', reason: 'auto WhatsApp/SMS delivery alerts + daily CRBT reversements' },
    { carrierId: 'mylerz', reason: 'national fulfillment, COD, dashboard tracking' },
    { carrierId: 'express-relais', reason: 'connected lockers eliminate failed home delivery' },
    { carrierId: 'tawssil', reason: 'inter-city + relay points, J+1 Cash Plus vouchers' },
    { carrierId: 'cathedis', reason: 'SHOPIFY/Woo native, CRBT engine, live tracking' },
  ],
  recommendRelayPoint: true,
  packagingChecklist: [
    'protective wrapping for heavy goods (3-point weight guard reference stays valid)',
    'branded outbox for cosmetics/fashion/gifts',
    'QR/waybill visible and scannable for driver',
  ],
  returnPolicyNote:
    'Display a simple, clear return policy on storefront pages (7-14 days Moroccan practice). A clear policy reassures pre-purchase and reduces effective returns.',
}