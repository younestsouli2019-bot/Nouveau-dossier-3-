/**
 * Morocco-Local Carrier Autodetect & Keyless Track-URL Resolver
 *
 * The mandatory procurement rule sources locally in Morocco only
 * (jumia.ma, avito.ma, toko.ma, iris.ma, superfood.ma, marjanemall.ma,
 * brico.ma ...). Those vendors ship via local couriers whose public
 * track-by-reference pages need NO API key:
 *   - Amana / Poste Maroc (Barid Al-Maghrib) — poste.ma
 *   - Jumia tracking (uses Amana)
 *   - Aramex, DHL, FedEx, UPS, Chronopost international fallback
 *
 * This module:
 *  1. autodetectCarrier()  — infers carrier + a public tracking URL from a
 *                            tracking number WITHOUT any secret.
 *  2. carrierProbe()       — returns the track URL + whether it is a known
 *                            public page. Never fabricates events; unknown
 *                            numbers stay `pending` with no invented status.
 */

export interface CarrierProbe {
  carrier: string
  trackingNumber: string
  publicUrl: string
  known: boolean
}

type CarrierMatcher = {
  carrier: string
  patterns: RegExp[]
  url: (t: string) => string
}

const CARRIER_ROUTES: CarrierMatcher[] = [
  {
    carrier: 'Poste Maroc (Barid Al-Maghrib)',
    patterns: [/^B?L\d{9,}$/i, /^[A-Z]{2}\d{9,}[A-Z]{2}(M)$/i, /^\d{10,13}$/],
    url: (t) => `https://www.poste.ma/office/Home/Recherche?reference=${encodeURIComponent(t)}`,
  },
  {
    carrier: 'Amana (Jumia Logistics)',
    patterns: [/^AM\d{8,}$/i, /^\d{7,}$/],
    url: (t) => `https://www.jumia.ma/tracking/?trackingNumber=${encodeURIComponent(t)}`,
  },
  {
    carrier: 'Aramex',
    patterns: [/^(?:[A-Z]{2})?\d{11,16}[A-Z]?$/],
    url: (t) => `https://www.aramex.com/track/results?awb_no=${encodeURIComponent(t)}`,
  },
  {
    carrier: 'DHL Express',
    patterns: [/^\d{10}$/],
    url: (t) => `https://www.dhl.com/ma-en/home/tracking.html?tracking-id=${encodeURIComponent(t)}`,
  },
  {
    carrier: 'FedEx',
    patterns: [/^\d{12}$/],
    url: (t) => `https://www.fedex.com/en-us/tracking.html?tracknumbers=${encodeURIComponent(t)}`,
  },
  {
    carrier: 'UPS',
    patterns: [/^1Z[0-9A-Z]{16}$/],
    url: (t) => `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`,
  },
  {
    carrier: 'Chronopost',
    patterns: [/^\d{13}$/],
    url: (t) => `https://www.chronopost.fr/fr/suivi-colis?trackingNumber=${encodeURIComponent(t)}`,
  },
]

export function autodetectCarrier(trackingNumber: string): CarrierProbe | null {
  const t = (trackingNumber || '').trim()
  if (!t) return null

  for (const route of CARRIER_ROUTES) {
    if (route.patterns.some((re) => re.test(t))) {
      return { carrier: route.carrier, trackingNumber: t, publicUrl: route.url(t), known: true }
    }
  }

  // Unknown format — never fabricate; use a generic search as a best-effort page.
  return {
    carrier: 'unknown',
    trackingNumber: t,
    publicUrl: `https://www.bing.com/search?q=${encodeURIComponent(t + ' parcel tracking')}`,
    known: false,
  }
}

export function carrierProbe(trackingNumber: string): CarrierProbe | null {
  return autodetectCarrier(trackingNumber)
}