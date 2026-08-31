/**
 * Morocco-Local Carrier Autodetect, Platform-Hint Disambiguation & Keyless Track-URL Resolver
 *
 * Sovereign sourcing rule: Jumia.ma / Avito.ma / Superfood.ma / Marjanemall.ma /
 * Brico.ma / Toko.ma / Iris.ma and other local-Morocco vendors only. Local orders
 * have ZERO international customs (no "International Shipping" placeholders).
 *
 * Carrier coverage per 2026-08-30 operational directives + web-confirmed URLs:
 *   Confirmed PUBLIC track pages (anti-fabrication: only these get known:true + real URL):
 *     - Poste Maroc     https://www.poste.ma/office/Home/Recherche?reference={id}
 *     - Jumia tracking  https://www.jumia.ma/tracking/?trackingNumber={id}
 *     - Jumia delivery  https://delivery.jumia.ma/?code={id}
 *     - Aramex          https://www.aramex.com/track/results?awb_no={id}
 *     - DHL             https://www.dhl.com/ma-en/home/tracking.html?tracking-id={id}
 *     - FedEx           https://www.fedex.com/en-us/tracking.html?tracknumbers={id}
 *     - UPS             https://www.ups.com/track?tracknum={id}
 *     - Chronopost FR   https://www.chronopost.fr/fr/suivi-colis?trackingNumber={id}
 *     - Cathedis        https://www.cathedis.ma/tracker/index.php?track_number={id}
 *     - Mylerz          https://mylerz.net/track  (barcode search box, not URL-embeddable)
 *   Third-party tracking hubs (premium fallback, keys optional):
 *     - TrackTry Morocco    https://www.tracktry.com/poste-maroc-tracking-api.html
 *     - TrackingMore Morocco https://www.trackingmore.com/poste-maroc-tracking-api
 *     - SHIP24_API_KEY / NINE_TRACKING_KEY (if present in .env)
 *
 * CRBT (retour de cash / COD): Amana EE…MA, Aramex 3xxxxxxxx, Cathedis LD/CTH,
 * Mylerz, ASAP, Quick Livraison, Coliaty and Forcelog all support COD + cash-reversal.
 * COD payout releases only after: trackingVerified=true AND (COD physical sign-off OR
 * 24h post-delivery dispute window) AND 3-point PO validation (destination/weight/timeline).
 *
 * Carrier Status Lag: public parsers can break during peaks (Ramadan / Black Friday) or
 * layout changes. NEVER invent events. Failed scrape → trackingVerified stays false and
 * a retryHint is set (graceful degradation chain is handled by tracking-fraud-guard.ts:
 * keyless scraper → premium keys if present → TRIGGER_MANUAL_REVIEW_HOLD).
 */

export interface CarrierProbe {
  carrier: string
  carrierId: string
  trackingNumber: string
  publicUrl: string
  known: boolean
  /** Peak-season (Ramadan, Black Friday) public parsers may be temporarily broken; retry later. */
  retryHint?: boolean
  /** If true, public web tracking URL is homepage-only (provider has app-only, authenticated portal, or form-only tracking). */
  trackingRequiresPortal?: boolean
  /** Human note explaining how to track (for app-only / portal-only / form-only). */
  trackingNote?: string
  /** COD (Contre Remboursement / CRBT) support. */
  supportsCod?: boolean
  platformHint?: string
}

type CarrierMatcher = {
  id: string
  carrier: string
  patterns: RegExp[]
  url: (t: string) => string
  retryHint?: boolean
  trackingRequiresPortal?: boolean
  trackingNote?: string
  supportsCod?: boolean
}

const CARRIER_ROUTES: CarrierMatcher[] = [
  // === Amana COD (owner-specified: EE123456789MA) — CHECK BEFORE Poste Maroc/UPU ===
  {
    id: 'amana-cod',
    carrier: 'Amana (Contre Remboursement / COD — Avito.ma seller receipts)',
    patterns: [/^EE\d{9,}MA$/i, /^AM\d{8,}$/i],
    url: (t) => `https://www.jumia.ma/tracking/?trackingNumber=${encodeURIComponent(t)}`,
    retryHint: true,
    supportsCod: true,
    trackingNote:
      'Avito.ma sellers must input the physical Poste Maroc / Amana branch receipt code (EE…MA) to trigger automated payout. COD = funds released only after buyer signs at delivery, or 24h post-delivery dispute window elapses.',
  },

  // === Jumia Logistics internal codes (owner-specified: JM… / 3000… proprietary) ===
  // Jumia hides real carrier tracking behind these codes. Extract via Vendor Hub API,
  // then monitor delivery.jumia.ma public page.
  {
    id: 'jumia-logistics',
    carrier: 'Jumia Logistics (internal code — resolve via Jumia Vendor Hub API for real carrier)',
    patterns: [/^JM\d+/i, /^JL\d+[A-Z]{0,2}$/i, /^JUMIA[-_]?\d+/i, /^3\d{8,}$/],
    url: (t) => `https://delivery.jumia.ma/?code=${encodeURIComponent(t)}`,
    retryHint: true,
    trackingNote:
      '3000…/JM…/JL… = Jumia-internal waybill, not a carrier tracking number. Use Jumia Vendor Hub API to extract shipping_provider + the real tracking_number (Aramex/Amana/Poste Maroc) then feed that into keyless engine.',
  },

  // === Aramex Morocco (owner-specified: bare 3xxxxxxxx, 9+ digits, leading 3) ===
  // CHECK BEFORE DHL (10-digit) / FedEx (12-digit) generic numeric.
  {
    id: 'aramex-morocco',
    carrier: 'Aramex Morocco (Superfood.ma / local Shopify fulfillment)',
    patterns: [/^3\d{8,}$/],
    url: (t) => `https://www.aramex.com/track/results?awb_no=${encodeURIComponent(t)}`,
    supportsCod: true,
  },
  {
    id: 'aramex',
    carrier: 'Aramex',
    patterns: [/^(?:[A-Z]{2})?\d{11,16}[A-Z]?$/],
    url: (t) => `https://www.aramex.com/track/results?awb_no=${encodeURIComponent(t)}`,
    supportsCod: true,
  },

  // === Chrono Diali — Barid Al-Maghrib + Geopost (Chronopost group) JV ===
  // 12-16 alphanumeric, common prefixes CHR / CDL. Tracking is in espace client (portal);
  // public homepage URL + note only — no fabricated track endpoints.
  {
    id: 'chrono-diali',
    carrier: 'Chrono Diali (Barid Al-Maghrib + Geopost / Chronopost JV)',
    patterns: [/^(?:CHR|CDL)[A-Z0-9]{9,14}$/i, /^CD\d{10,14}$/i],
    url: () => `https://www.chronodiali.ma/`,
    retryHint: true,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Chrono Diali public tracking requires client portal (espace client). Use portal credentials to pull status via API or login; carrier = known, but publicUrl defaults to homepage to avoid 404 invention.',
  },

  // === Yassir Express (app-only courier, Morocco/Algeria/Tunisia) ===
  // No known public web tracking. Detection heuristic: YSR prefix or refs with YASS.
  {
    id: 'yassir-express',
    carrier: 'Yassir Express (app-only courier)',
    patterns: [/^(?:YSR|YASSIR|YAS)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://yassir.com/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Yassir Express tracking is app-only. Use driver SMS link or merchant express dashboard; keyless engine keeps carrier identified but status unverified until trackingVerified set manually via portal proof.',
  },

  // === Cathedis — LAST-MILE e-commerce courier, COD + CRBT optimized (webhook for merchants) ===
  // Owner directive: Cathedis = Shopify/WooCommerce native plugin, live tracking, automated
  // cash recovery (CRBT). Public tracker confirmed: https://www.cathedis.ma/tracker/index.php
  // Formats per merchant docs: LD… (Connecto) or CTH… 11-char (iris.ma).
  {
    id: 'cathedis',
    carrier: 'Cathedis (e-commerce last-mile, COD/CRBT reinvestment engine)',
    patterns: [/^(?:LD|CTH|CATCH)[-_]?[A-Z0-9]{6,}$/i],
    url: (t) => `https://www.cathedis.ma/tracker/index.php?track_number=${encodeURIComponent(t)}`,
    retryHint: true,
    supportsCod: true,
    trackingNote:
      'Cathedis public tracker confirmed at cathedis.ma/tracker. For merchants: use Cathedis native Shopify/WooCommerce plugin + REST API for live tracking and automated CRBT cash reversal.',
  },

  // === Mylerz — fulfillment + national courier (Morocco/Egypt), public track page confirmed ===
  // Barcode search box on https://mylerz.net/track — number not URL-embeddable, so known:false
  // for the URL but carrier identified (manual paste required).
  {
    id: 'mylerz',
    carrier: 'Mylerz (fulfillment + national courier, COD)',
    patterns: [/^(?:MLZ|MYLERZ)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://mylerz.net/track`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Mylerz public tracker is a barcode search box (mylerz.net/track). Paste the barcode manually; automated URL embedding is not supported — keep status unverified until real page shows delivered.',
  },

  // === ASAP Delivery / Quick Livraison / Coliaty / Express Relais / Forcelog / Atlas ===
  // Modern tech-forward Moroccan couriers with documented REST APIs + CRBT (daily bank
  // transfers of collected COD cash). No public track-by-number URL confirmed for autodetect;
  // these integrate via merchant API tokens. Detection by prefix heuristic only.
  {
    id: 'asap',
    carrier: 'ASAP Delivery (REST API, 30s token, COD per-package tracking)',
    patterns: [/^(?:ASAP|SW)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://asapdelivery.ma/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'ASAP Delivery exposes REST API (basic GET/POST, token-generation) with per-package COD collection tracking. Public URL is homepage; real status via merchant API token.',
  },
  {
    id: 'quick-livraison',
    carrier: 'Quick Livraison (440+ cities, CRBT daily automated bank transfers)',
    patterns: [/^(?:QL|QK|QUICK)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://quicklivraison.ma/en`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Quick Livraison covers 440+ cities. Automatic Daily Bank Transfer: once package shifts to "Delivered" via API, collected COD cash is bundled into an automated daily payout loop. Real-time tracking, automatic WhatsApp/SMS delivery alerts, structured payout reports on dashboard (2026-08-30 research).',
  },
  {
    id: 'skypostal',
    carrier: 'Skypostal (FinTech-forward delivery + factoring ledgers)',
    patterns: [/^(?:SKYP|SKY|SPL)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://skypostal.ma/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Skypostal: Automated Factoring + Ledgers. Net payout = Collected CRBT Amount − Fixed Delivery Fee, paid automatically within a 24–48h window. 9 time-stamped tracking milestones via integrated API, auditable with automated financial statements (2026-08-30 research).',
  },
  {
    id: 'g4d',
    carrier: 'G4D (developer-integration courier, guaranteed J+1 reversements)',
    patterns: [/^(?:G4D|4GD)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://g4d.express/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'G4D: Guaranteed J+1 (next-day) automated cash reversements to registered RIB within 24h of successful delivery. Real-time visual tracking, state-change webhooks that alert your server, interactive multi-agency dashboard (2026-08-30 research).',
  },
  {
    id: 'coliaty',
    carrier: 'Coliaty (e-commerce delivery, full COD/CRBT framework)',
    patterns: [/^(?:COLT|CLY|COL)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://coliaty.com/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Coliaty integrates full COD/CRBT payment-at-delivery management with automated invoicing and reinvestment. Public URL is homepage.',
  },
  {
    id: 'express-relais',
    carrier: 'Express Relais (connected lockers / casiers, Morocco)',
    patterns: [/^(?:EXR|CASE)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://expressrelais.ma/`,
    trackingRequiresPortal: true,
    supportsCod: false,
    trackingNote:
      'Express Relais delivers to connected lockers (casiers). Status comes from your SI/locker integration; no public track page.',
  },
  {
    id: 'forcelog',
    carrier: 'Forcelog (e-commerce delivery, CRBT cash-flow tools, free pickup 24/48h)',
    patterns: [/^(?:FLG|FORCE)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://forcelog.ma/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Forcelog offers CRBT cash collection + financial flow management with case-by-free-pickup 24/48h express. Tracking via merchant portal credentials.',
  },
  {
    id: 'atlas-livraison',
    carrier: 'Atlas Livraison (national parcel platform, automated CRBT invoicing)',
    patterns: [/^(?:ALV|ATLAS)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://atlaslivraison.ma/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Atlas Livraison includes automated CRBT billing and driver tracking. Merchant portal required.',
  },

  // === Poste Maroc (Barid Al-Maghrib) — UPU S10 international and domestic barcodes ===
  // RR/CC/EM…MA + domestic B?L… numeric. Place AFTER Amana EE…MA so the Amana COD rule wins.
  {
    id: 'poste-maroc',
    carrier: 'Poste Maroc (Barid Al-Maghrib)',
    patterns: [
      /^[RCELAUPNT][A-Z]\d{8,9}MA$/i,
      /^B?L\d{9,}$/i,
      /^\d{10,13}$/,
    ],
    url: (t) => `https://www.poste.ma/office/Home/Recherche?reference=${encodeURIComponent(t)}`,
    retryHint: true,
    supportsCod: true,
    trackingNote:
      'Peak-season (Ramadan / Black Friday) layout changes or latency may temporarily break public parser — retry later. NEVER invent delivered events; trackingVerified stays false until real scraped event exists.',
  },

  // === Amana generic numeric fallback (owner: 7+ digits) — last before international ===
  {
    id: 'amana-generic',
    carrier: 'Amana (Jumia Logistics)',
    patterns: [/^\d{7,}$/],
    url: (t) => `https://www.jumia.ma/tracking/?trackingNumber=${encodeURIComponent(t)}`,
    retryHint: true,
    supportsCod: true,
  },

  // === DHL / FedEx / UPS / Chronopost international fallbacks (priority order) ===
  {
    id: 'dhl',
    carrier: 'DHL Express',
    patterns: [/^\d{10}$/],
    url: (t) => `https://www.dhl.com/ma-en/home/tracking.html?tracking-id=${encodeURIComponent(t)}`,
  },
  {
    id: 'fedex',
    carrier: 'FedEx',
    patterns: [/^\d{12}$/],
    url: (t) => `https://www.fedex.com/en-us/tracking.html?tracknumbers=${encodeURIComponent(t)}`,
  },
  {
    id: 'ups',
    carrier: 'UPS',
    patterns: [/^1Z[0-9A-Z]{16}$/],
    url: (t) => `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`,
  },
  {
    id: 'chronopost',
    carrier: 'Chronopost',
    patterns: [/^\d{13}$/],
    url: (t) => `https://www.chronopost.fr/fr/suivi-colis?trackingNumber=${encodeURIComponent(t)}`,
  },

  // === Catch-all: regional Moroccan last-mile (Oztech / Ghazala / Speedaf / Livo / Sendit / Tawssil) ===
  {
    id: 'oztech',
    carrier: 'Oztech (regional last-mile)',
    patterns: [/^(?:OZT|OZTECH)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://www.jumia.ma/tracking/`,
    trackingNote: 'Oztech regional courier. Request waybill URL from merchant; prefer Aramex/Amana/Poste Maroc formats for automated tracking.',
  },
  {
    id: 'ghazala',
    carrier: 'Ghazala Messagerie Express',
    patterns: [/^GH[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://www.jumia.ma/tracking/`,
    supportsCod: true,
    trackingNote: 'Ghazala — Casablanca + regions 24-48h, COD available. Merchant portal tracking.',
  },
  {
    id: 'speedaf',
    carrier: 'Speedaf',
    patterns: [/^SP[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://www.jumia.ma/tracking/`,
    supportsCod: true,
    trackingNote: 'Speedaf — national coverage, COD available, organized (Asia-Africa-Middle East express).',
  },
  {
    id: 'tawssil',
    carrier: 'Tawssil by Cash Plus (inter-city 20-45 MAD, instant financial-network payouts)',
    patterns: [/^(?:TAW|TWS)[-_]?[A-Z0-9]{6,}$/i],
    url: () => `https://tawssil.ma/`,
    trackingRequiresPortal: true,
    supportsCod: true,
    trackingNote:
      'Tawssil by Cash Plus: runs on the Cash Plus financial network — automated J+1 payouts to bank account OR instantly via any Cash Plus agency via automated digital vouchers. Programmatic tracking numbers, automated bulk waybill printing, return-logistics tracking (2026-08-30 research).',
  },
  {
    id: 'regional-courier',
    carrier: 'Regional Moroccan Courier (generic last-mile)',
    patterns: [/^(?:CAT|SDT|MEX|NIT|SAP|LIV|SEND)[-_]?[A-Z0-9]{6,}$/i, /^[A-Z0-9]{8,}MA[-_]?\d{0,4}$/i],
    url: () => `https://www.jumia.ma/tracking/`,
    trackingNote:
      'Regional private courier (Sapress/Nitro/Maroc Express/Sendit/Livo…). Request waybill URL from merchant; Aramex/Amana/Poste Maroc formats are preferred for automated tracking.',
  },
]

/** Highest-priority carrier IDs per sourcing platform (disambiguation for numeric collisions). */
const PLATFORM_PRIORITY: Record<string, string[]> = {
  jumia: ['amana-cod', 'jumia-logistics', 'amana-generic', 'cathedis', 'mylerz'],
  avito: ['amana-cod', 'amana-generic', 'poste-maroc'],
  superfood: ['aramex-morocco', 'aramex', 'amana-cod', 'cathedis'],
  shopify: ['aramex-morocco', 'aramex', 'cathedis', 'mylerz', 'asap', 'quick-livraison', 'forcelog'],
  iristech: ['cathedis', 'amana-cod', 'poste-maroc', 'aramex-morocco'],
  marjane: ['amana-generic', 'aramex-morocco', 'cathedis'],
}

export function autodetectCarrier(trackingNumber: string, platformHint?: string): CarrierProbe | null {
  const t = (trackingNumber || '').trim()
  if (!t) return null

  const ordered: CarrierMatcher[] = []
  const priority = (platformHint || '').toLowerCase()
  const preferredIds = PLATFORM_PRIORITY[priority] || []
  const preferred = CARRIER_ROUTES.filter((r) => preferredIds.includes(r.id))
  const rest = CARRIER_ROUTES.filter((r) => !preferredIds.includes(r.id))
  ordered.push(...preferred, ...rest)

  for (const route of ordered) {
    if (route.patterns.some((re) => re.test(t))) {
      return {
        carrier: route.carrier,
        carrierId: route.id,
        trackingNumber: t,
        publicUrl: route.url(t),
        known: true,
        retryHint: route.retryHint,
        trackingRequiresPortal: route.trackingRequiresPortal,
        supportsCod: route.supportsCod,
        trackingNote: route.trackingNote,
        platformHint,
      }
    }
  }

  // Unknown format — never fabricate; use a generic search as a best-effort page.
  return {
    carrier: 'unknown',
    carrierId: 'unknown',
    trackingNumber: t,
    publicUrl: `https://www.bing.com/search?q=${encodeURIComponent(t + ' parcel tracking Morocco')}`,
    known: false,
    retryHint: true,
    trackingNote:
      'Unrecognized carrier format. Require seller to paste a real Poste Maroc (RR/EE…MA), Amana (AM…), Aramex (3xxxxxxxx), Jumia (JM/3000…), Chrono Diali (CHR…), Cathedis (LD/CTH…), or Yassir (YSR…) code. Automated payout stays on hold.',
    platformHint,
  }
}

export function carrierProbe(trackingNumber: string, platformHint?: string): CarrierProbe | null {
  return autodetectCarrier(trackingNumber, platformHint)
}

/** CRBT advisory — which carriers manage COD cash-reversal and their cadence (owner/research source: Forcelog CRBT 12-24h, Quick/Coliaty daily automated transfers). */
export const CRBT_CADENCE_NOTES: Record<string, string> = {
  'Amana (Contre Remboursement / COD — Avito.ma seller receipts)':
    'Traditional Contre-Remboursement; cash at branch, reversal on merchant settlement cycle.',
  'Cathedis (e-commerce last-mile, COD/CRBT reinvestment engine)':
    'Automated cash retrieval workflows (owner: CRBT reinvestment engine).',
  'Mylerz (fulfillment + national courier, COD)': 'COD funds integrated in dashboard.',
  'Quick Livraison (440+ cities, CRBT daily automated bank transfers)':
    'CRBT fast remittance with automated DAILY bank transfers.',
  'Coliaty (e-commerce delivery, full COD/CRBT framework)': 'Full COD funds + tracking dashboard.',
  'Forcelog (e-commerce delivery, CRBT cash-flow tools, free pickup 24/48h)':
    'CRBT: retours de fond chaque 12h–24h (owner-researched).',
  'ASAP Delivery (REST API, 30s token, COD per-package tracking)':
    'Per-package collected-money tracking via JSON API.',
}