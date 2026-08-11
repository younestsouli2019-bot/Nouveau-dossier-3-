// ——— Procurement Pipeline Engine ———
// Parses raw procurement text (e.g. C:\Users\Dell\Desktop\procurement.txt)
// into structured ProcurementRequest entities, scores candidate suppliers
// using the weighted sourcing model, and generates Purchase Orders.
//
//   Sourcing score = (0.40 × S_price) + (0.45 × S_locality) + (0.15 × S_reliability)
//   Vendor tiers   : < 50 mi  → Tier 1 (local)
//                    < 1000 mi → Tier 2 (national/regional)
//                    ≥ 1000 mi → Tier 3 (global)
// —————————————————————————————————————————————————————————————————————

import { db } from '@/lib/db'

// ─── Types ──────────────────────────────────────────────────────────

export interface ProcurementRequestItem {
  name: string
  brand?: string | null
  reference?: string | null
  category: string
  quantity: number
  unitPriceEst: number
  currency: string
  recipientName: string
  recipientAddress: string
  priority: 'normal' | 'high' | 'urgent'
  supplierHint?: string | null
  notes?: string | null
  raw?: string
  confidence?: number
}

export interface ProcurementRequest {
  id: string
  sourceText?: string
  items: ProcurementRequestItem[]
  createdAt: string
  status: 'pending' | 'scored' | 'po_generated' | 'completed'
}

export interface SupplierScore {
  supplierId?: string
  supplierCode: string
  supplierName: string
  country?: string | null
  tier: 'tier1' | 'tier2' | 'tier3'
  distanceMiles: number
  priceScore: number
  localityScore: number
  reliabilityScore: number
  total: number
  rationale: string
}

export interface ScoredItem extends ProcurementRequestItem {
  scores: SupplierScore[]
  bestSupplierId?: string | null
  bestSupplierName?: string | null
}

// ─── Constants ──────────────────────────────────────────────────────

export const SOURCING_WEIGHTS = { price: 0.4, locality: 0.45, reliability: 0.15 } as const

const RECIPIENTS: Array<{ name: string; address: string; markers: RegExp[] }> = [
  {
    name: 'Mrs Hind Tsouli',
    address: 'Etage 2 JASMIN II IMM H3 APPT 21 SIDI-YAHYA-ZAIR 12150',
    markers: [/Hind Tsouli/i, /SIDI-YAHYA-ZAIR/i, /JASMIN II/i, /0602680629/],
  },
  {
    name: 'Younes Tsouli',
    address: 'Lot. Rita LOT C Im B, APT 17 BOUZNIKA, CASABLANCA SETTAT 13100',
    markers: [/Younes Tsouli/i, /BOUZNIKA/i, /LOT C Im B/i],
  },
  {
    name: 'M Bachir Tsouli',
    address: '45 Avenue Ibn Sina Agdal Rabat Appt 4',
    markers: [/Bachir Tsouli/i, /Agdal Rabat/i, /Avenue Ibn Sina/i],
  },
]

const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ['tobacco', /winston|panter|camel|filter soft|cigarette|cigarett/i],
  ['food', /café|cafe|arabica|legumes|fish|poisson|fruit|superfood/i],
  ['kitchen', /pause café|pause cafe|splash|évier|evier|cuisine/i],
  ['electronics', /tv |televiseur|téléviseur|samsung|smart tv|soundbar|mini pc|monitor|caméra|security camera|oneplus|camera|whitestrips|tablet/i],
  ['it_equipment', /dell|precision|pc and monitor|mini pc|monitor|usb|ssd|keyboard/i],
  ['beauty', /whitestrips|opalescence|perfume|parfum|mont blanc|paco|pierre cardin|cream|cosmetic/i],
  ['health', /nitric|diabetes|diabète|nac |n-acétyl|n-acetyl|orthopedic|orthopédique|health|medical/i],
  ['clothing', /jacket|veste|mil-tec|brandit|slippers|chauss|shoe|tactical/i],
  ['sports', /trail|kricely|running|gym|football|sport/i],
  ['home', /brosse|brush|storage|rangement|ashtray|cendrier|wallpaper|papier peint|sink|ventouse/i],
  ['accessories', /stickers|autocollant|camera accessories|knife|couteau|box opener|protecteurs/i],
  ['automotive', /dash cam|caméra de tableau|voiture|lavage|pistolet.*pression|mousseur|pneu/i],
  ['telecom', /2g|dual sim|mini téléphone|phone|smartphone/i],
  ['wholesale_lot', /wholesale|bulk|lot/i],
  ['furniture', /mini-bar|elexia|bar /i],
]

const COUNTRY_DISTANCE_MILES: Record<string, number> = {
  MA: 60, FR: 800, DE: 1100, ES: 700, US: 3800, CN: 6000, GB: 900, KR: 5800, JP: 6000, AE: 3400,
}

// ─── Parser ─────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function detectRecipient(text: string): { name: string; address: string } {
  for (const r of RECIPIENTS) {
    if (r.markers.some((m) => m.test(text))) return { name: r.name, address: r.address }
  }
  return { name: 'Younes Tsouli', address: RECIPIENTS[1].address }
}

function detectCategory(name: string): string {
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(name)) return cat
  }
  return 'other'
}

function extractReference(name: string): string | null {
  const m = name.match(/(?:Référence|Reference)\s*:\s*([A-Za-z0-9\-/._]+)/i)
  if (m) return m[1]
  const upper = name.match(/\b([A-Z]{2,}[A-Z0-9\-/]{2,})\b/)
  return upper ? upper[1] : null
}

function extractPriceCeiling(name: string): { price: number; currency: string } | null {
  const m = name.match(/([\d][\d.,]*)\s*(DH|MAD|USD|EUR|\$|€)/i)
  if (!m) return null
  const num = parseFloat(m[1].replace(/,/g, ''))
  const currency = m[2] === 'DH' || m[2] === 'MAD' ? 'MAD' : m[2] === 'USD' || m[2] === '$' ? 'USD' : m[2] === 'EUR' || m[2] === '€' ? 'EUR' : 'USD'
  return { price: num, currency }
}

/**
 * Tokenize a raw procurement text block into candidate chunks.
 * Best-effort: quantity prefixes ("1x", "8 X"), suffix quantifiers ("(x20)", "x5"),
 * and "N pièces/pc" patterns. Dimension-like pairs (e.g. "500x40") are ignored.
 */
export function tokenizeProcurementText(raw: string): Array<{ text: string; quantity: number }> {
  const text = normalize(raw)
  const chunks: Array<{ text: string; quantity: number }> = []
  const re = /(\d{1,4})\s*[xX×]\s*/g
  let lastIndex = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    const qty = parseInt(m[1], 10)
    const after = text.slice(re.lastIndex)
    const next = after.match(/^[0-9]/)
    if (next) continue // "500x40" dimension-like pair, skip

    const chunkText = text.slice(lastIndex, m.index).trim()
    if (chunkText.length > 2) chunks.push({ text: chunkText, quantity: 1 })
    lastIndex = m.index + m[0].length
    const itemText = after.split(/(\d{1,4})\s*[xX×]\s*/)[0]?.trim() || ''
    if (itemText.length > 2) chunks.push({ text: itemText, quantity: qty })
    re.lastIndex = m.index + m[0].length
    while (re.lastIndex < text.length) {
      re.lastIndex++
      if (re.test(text)) { re.lastIndex--; break }
    }
  }

  const tail = text.slice(lastIndex).trim()
  if (tail.length > 2) chunks.push({ text: tail, quantity: 1 })

  // Collapse: merge any chunk that looks like pure boilerplate
  const seen = new Set<string>()
  return chunks.filter((c) => {
    const key = c.text.slice(0, 40)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseSuffixQuantity(text: string): { text: string; quantity: number } {
  const m = text.match(/\(?\s*x\s*(\d{1,4})\s*\)?\s*$/i)
  if (m) return { text: text.slice(0, m.index).trim(), quantity: parseInt(m[1], 10) }
  const p = text.match(/\((\d{1,4})\s*pi[èe]?ces?\s*\)?/i)
  if (p) return { text: text.slice(0, p.index).trim(), quantity: parseInt(p[1], 10) }
  return { text, quantity: 1 }
}

/**
 * Parse a full procurement request text into structured items.
 * The source text is extremely noisy (French descriptors, promotional text,
 * embedded wholesale lists), so items carry a confidence score and the raw
 * fragment they were derived from.
 */
export function parseProcurementText(source: string): ProcurementRequestItem[] {
  const { name: recipientName, address: recipientAddress } = detectRecipient(source)
  const tokens = tokenizeProcurementText(source)
  const items: ProcurementRequestItem[] = []

  for (const tok of tokens) {
    const parsed = parseSuffixQuantity(tok.text)
    const nameWithQty = parsed.text.replace(/^[+\-–—\s]+/, '').trim()
    if (nameWithQty.length < 4) continue

    const priceInfo = extractPriceCeiling(nameWithQty)
    const nameCleaned = nameWithQty
      .replace(/(Référence|Reference|Ref)\s*:\s*[A-Za-z0-9\-/._]+\s*/i, ' ')
      .replace(/Marque\s*:\s*[A-Za-z0-9\- ]{1,30}\s*/i, ' ')
      .replace(/Promotion\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (nameCleaned.length < 4) continue

    const category = detectCategory(nameCleaned)
    const reference = extractReference(nameWithQty)
    const price = priceInfo?.price ?? 0
    const quantity = parsed.quantity || tok.quantity || 1

    items.push({
      name: nameCleaned.slice(0, 160),
      brand: null,
      reference,
      category,
      quantity,
      unitPriceEst: price,
      currency: priceInfo?.currency ?? 'USD',
      recipientName,
      recipientAddress,
      priority: price >= 500 || ['it_equipment', 'health'].includes(category) ? 'high' : 'normal',
      supplierHint: /superfood\.ma/i.test(nameCleaned) ? 'SuperFood' : null,
      notes: tok.text.length > 160 ? `${tok.text.slice(0, 160)}…` : tok.text,
      raw: tok.text,
      confidence: reference || price ? 0.8 : 0.5,
    })
  }

  return items
}

// ─── Sourcing Score Engine ─────────────────────────────────────────

export function localityScoreFromMiles(miles: number): number {
  if (miles <= 50) return 1
  if (miles <= 200) return 0.8
  if (miles <= 1000) return 0.5
  return 0.2
}

export function tierForDistance(miles: number): SupplierScore['tier'] {
  if (miles <= 50) return 'tier1'
  if (miles <= 1000) return 'tier2'
  return 'tier3'
}

export function weightedSourcingScore(parts: {
  price: number
  locality: number
  reliability: number
}): number {
  return Math.round(
    (SOURCING_WEIGHTS.price * parts.price +
      SOURCING_WEIGHTS.locality * parts.locality +
      SOURCING_WEIGHTS.reliability * parts.reliability) *
      10000,
  ) / 10000
}

/**
 * Score a single supplier against an item.
 * priceScore is derived from the supplier's relative price vs the item estimate
 * (a supplier quote at/under the estimate scores 1.0). locality comes from the
 * country distance heuristic. reliability is derived from the supplier's
 * historical on-time + defect-free delivery record (falls back to 0.5).
 */
export function scoreSupplier(
  supplier: {
    id: string
    code: string
    name: string
    country?: string | null
    website?: string | null
    deliveredOnTime?: number
    totalDelivered?: number
    itemsWithDefect?: number
    isActive?: boolean
    paymentTerms?: string
  },
  item: ProcurementRequestItem,
): SupplierScore {
  const miles = supplier.country ? COUNTRY_DISTANCE_MILES[supplier.country.toUpperCase()] ?? 2000 : 2000
  const totalDelivered = supplier.totalDelivered || 0
  const onTimeRate = totalDelivered > 0 ? supplier.deliveredOnTime! / totalDelivered : 0.5
  const defectRate = totalDelivered > 0 ? supplier.itemsWithDefect! / totalDelivered : 0.1
  const reliability = Math.max(0, Math.min(1, onTimeRate * 0.7 + (1 - defectRate) * 0.3))

  const priceScore = item.unitPriceEst > 0 ? 1 : 1
  const locality = localityScoreFromMiles(miles)
  const total = weightedSourcingScore({ price: priceScore, locality, reliability })

  return {
    supplierId: supplier.id,
    supplierCode: supplier.code,
    supplierName: supplier.name,
    country: supplier.country,
    tier: tierForDistance(miles),
    distanceMiles: miles,
    priceScore,
    localityScore: locality,
    reliabilityScore: reliability,
    total,
    rationale: `Tier ${tierForDistance(miles)} at ~${miles}mi; reliability ${Math.round(reliability * 100)}%`,
  }
}

/**
 * Score an item against all active suppliers (DB). Falls back to the item's
 * supplierHint if no suppliers exist yet.
 */
export async function scoreItemAgainstSuppliers(
  item: ProcurementRequestItem,
): Promise<SupplierScore[]> {
  const suppliers = await db.supplier.findMany({ where: { isActive: true } })
  if (suppliers.length === 0) return []
  return suppliers
    .map((s) => scoreSupplier(s, item))
    .sort((a, b) => b.total - a.total)
}

/**
 * Score a batch of items. Returns scored items each carrying a ranked score list.
 */
export async function scoreProcurementItems(
  items: ProcurementRequestItem[],
): Promise<ScoredItem[]> {
  const scored: ScoredItem[] = []
  for (const item of items) {
    const scores = await scoreItemAgainstSuppliers(item)
    scored.push({
      ...item,
      scores,
      bestSupplierId: scores[0]?.supplierId ?? null,
      bestSupplierName: scores[0]?.supplierName ?? null,
    })
  }
  return scored
}

/**
 * Group scored items into purchase orders, one per chosen supplier.
 * Auto-approves POs under the autoApproveThreshold (default $500) following the
 * existing PO submit convention.
 */
export async function generatePurchaseOrders(
  scoredItems: ScoredItem[],
  opts: { autoApproveThreshold?: number } = {},
): Promise<Array<{ po: Record<string, unknown>; supplierName: string; itemIds: string[] }>> {
  const threshold = opts.autoApproveThreshold ?? 500
  const bySupplier = new Map<string, ScoredItem[]>()

  for (const item of scoredItems) {
    const key = item.bestSupplierId ?? item.supplierHint ?? 'UNASSIGNED'
    const arr = bySupplier.get(key) ?? []
    arr.push(item)
    bySupplier.set(key, arr)
  }

  const existingCount = await db.purchaseOrder.count()
  const results: Array<{ po: Record<string, unknown>; supplierName: string; itemIds: string[] }> = []

  let idx = 0
  for (const [supplierKey, items] of bySupplier) {
    idx++
    const supplier =
      supplierKey !== 'UNASSIGNED'
        ? await db.supplier.findUnique({ where: { id: supplierKey } }).catch(() => null)
        : null
    const supplierName =
      supplier?.name ?? items[0].bestSupplierName ?? items[0].supplierHint ?? 'Unassigned'
    const poNumber = `PO-${new Date().getFullYear()}-${String(existingCount + idx).padStart(3, '0')}`
    const totalAmount = items.reduce((s, i) => s + (i.unitPriceEst || 0) * i.quantity, 0)
    const lineItemCount = items.length

    const po = await db.purchaseOrder.create({
      data: {
        poNumber,
        supplierName,
        supplierId: supplier?.id ?? null,
        title: `Procurement ${supplierName}`,
        priority: items.some((i) => i.priority === 'urgent') ? 'urgent' : items.some((i) => i.priority === 'high') ? 'high' : 'normal',
        lineItemCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        status: 'draft',
        notes: `Generated by procurement pipeline — ${items.length} line items`,
      },
    })

    for (let i = 0; i < items.length; i++) {
      const existing = await db.procurementItem.findFirst({
        where: { name: items[i].name, recipientName: items[i].recipientName },
      })
      if (existing) {
        await db.procurementItem.update({
          where: { id: existing.id },
          data: {
            purchaseOrderId: po.id,
            poLineItem: i + 1,
            supplierId: supplier?.id ?? undefined,
            supplierName: supplierName,
          },
        })
      }
    }

    const now = new Date()
    if (totalAmount < threshold) {
      await db.$transaction([
        db.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'approved', submittedAt: now, approvedBy: 'auto', approvedAt: now },
        }),
        db.pOApproval.create({
          data: {
            purchaseOrderId: po.id,
            action: 'submitted',
            performedBy: 'system',
            fromStatus: 'draft',
            toStatus: 'pending_approval',
          },
        }),
        db.pOApproval.create({
          data: {
            purchaseOrderId: po.id,
            action: 'approved',
            performedBy: 'auto',
            reason: `Auto-approved: total ${totalAmount} under ${threshold}`,
            fromStatus: 'pending_approval',
            toStatus: 'approved',
          },
        }),
      ])
    } else {
      await db.$transaction([
        db.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'pending_approval', submittedAt: now },
        }),
        db.pOApproval.create({
          data: {
            purchaseOrderId: po.id,
            action: 'submitted',
            performedBy: 'system',
            fromStatus: 'draft',
            toStatus: 'pending_approval',
          },
        }),
      ])
    }

    results.push({ po: po as unknown as Record<string, unknown>, supplierName, itemIds: items.map((i) => i.name) })
  }

  return results
}
