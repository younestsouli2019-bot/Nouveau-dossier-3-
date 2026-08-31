import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedProcurement, getDestinationInfo } from '@/lib/procurement/seed-data'

const CARRIERS = [
  'DHL Express',
  'FedEx',
  'UPS',
  'Aramex',
  'Colissimo (France)',
  'Chronopost',
  'Amazon Logistics',
  'AliExpress Standard Shipping',
  'Yanwen',
  '4PX',
]

const ORIGINS = [
  { country: 'China', city: 'Shenzhen' },
  { country: 'China', city: 'Guangzhou' },
  { country: 'France', city: 'Paris' },
  { country: 'USA', city: 'Dallas' },
  { country: 'USA', city: 'New York' },
  { country: 'Germany', city: 'Frankfurt' },
  { country: 'South Korea', city: 'Seoul' },
  { country: 'UK', city: 'London' },
]

function generateTrackingNumber(carrier: string, idx: number): string {
  const seq = String(idx).padStart(12, '0')
  switch (carrier) {
    case 'DHL Express':
      return `JD0146000${seq}`
    case 'FedEx':
      return `79464479${String(idx).padStart(5, '0')}`
    case 'UPS':
      return `1Z999AA1${String(idx).padStart(10, '0')}`.slice(0, 18)
    case 'Aramex':
      return `SGK${String(idx).padStart(9, '0')}`
    case 'Colissimo (France)':
      return `FR${String(idx).padStart(8, '0')}ES`
    case 'Chronopost':
      return `CS${String(idx).padStart(10, '0')}FR`
    case 'Amazon Logistics':
      return `TBA${String(idx).padStart(10, '0')}`
    case 'AliExpress Standard Shipping':
      return `AE${String(idx).padStart(12, '0')}CN`
    case 'Yanwen':
      return `YW${String(idx).padStart(12, '0')}CN`
    case '4PX':
      return `4PX${String(idx).padStart(10, '0')}`
    default:
      return `TRK${String(idx).padStart(14, '0')}`
  }
}

function getPurpose(itemName: string): string {
  const lower = itemName.toLowerCase()
  if (lower.includes('tv') || lower.includes('barre de son') || lower.includes('soundbar')) return 'Home entertainment setup'
  if (lower.includes('dash cam')) return 'Vehicle safety - commuting'
  if (lower.includes('brosse') || lower.includes('pistolet') || lower.includes('foam') || lower.includes('storage') || lower.includes('ashtray') || lower.includes('wall') || lower.includes('marble') || lower.includes('sink')) return 'Household improvement'
  if (lower.includes('dell') || lower.includes('precision') || lower.includes('laptop')) return 'Development workstations'
  if (lower.includes('mini pc') || lower.includes('monitor')) return 'Office IT equipment'
  if (lower.includes('security camera') || lower.includes('camera accessories')) return 'Shop surveillance system'
  if (lower.includes('65') && lower.includes('tv')) return 'Home entertainment + content creation'
  if (lower.includes('wholesale') || lower.includes('bulk') || lower.includes('lot')) return 'Resale inventory - online shop'
  if (lower.includes('health') || lower.includes('nitric') || lower.includes('diabetes') || lower.includes('nac') || lower.includes('natural')) return 'Personal health supplements'
  if (lower.includes('crest') || lower.includes('opalescence') || lower.includes('whiten')) {
    // Check recipient context — we assign per item in the mapping below
    return 'Personal care'
  }
  if (lower.includes('perfume') || lower.includes('paco') || lower.includes('mont blanc')) return 'Personal care'
  if (lower.includes('jacket') || lower.includes('slipper') || lower.includes('clothing')) return 'Personal wardrobe'
  if (lower.includes('shoes') || lower.includes('trail') || lower.includes('krice')) return 'Outdoor activities'
  if (lower.includes('winston') || lower.includes('panter') || lower.includes('camel') || lower.includes('filter soft') || lower.includes('tobacco')) return 'Personal supplies'
  if (lower.includes('cafe') || lower.includes('food') || lower.includes('vegetable') || lower.includes('fish') || lower.includes('arabica') || lower.includes('legume')) return 'Household provisions'
  if (lower.includes('kitchen') || lower.includes('pause') || lower.includes('kit pause')) return 'Kitchen equipment'
  if (lower.includes('sticker') || lower.includes('cane') || lower.includes('knife') || lower.includes('box opener') || lower.includes('accessories')) return 'Mixed household items'
  if (lower.includes('mini-bar') || lower.includes('elexia') || lower.includes('furniture')) return 'Home furnishing'
  if (lower.includes('tablet')) return 'Mobile workstation'
  if (lower.includes('phone') || lower.includes('telecom')) return 'Emergency communications'
  if (lower.includes('oneplus')) return 'Personal mobile device'
  return 'General procurement'
}

function generateEvents(status: string, originCity: string, originCountry: string, destinationCity: string): string {
  const events: { date: string; status: string; location: string; description: string }[] = []
  const baseDate = new Date('2026-08-01T10:00:00Z')
  const cityCode = originCountry === 'China' ? 'CN' : originCountry === 'France' ? 'FR' : originCountry === 'USA' ? 'US' : originCountry === 'Germany' ? 'DE' : originCountry === 'South Korea' ? 'KR' : 'UK'

  events.push({
    date: '2026-08-01T10:00:00Z',
    status: 'label_created',
    location: `${originCity}, ${cityCode}`,
    description: 'Shipping label created',
  })
  events.push({
    date: '2026-08-02T08:00:00Z',
    status: 'picked_up',
    location: `${originCity}, ${cityCode}`,
    description: 'Package picked up by carrier',
  })

  if (['in_transit', 'customs', 'out_for_delivery', 'delivered'].includes(status)) {
    events.push({
      date: '2026-08-04T14:00:00Z',
      status: 'in_transit',
      location: 'In transit',
      description: 'Package in transit to destination country',
    })
  }

  if (['customs', 'out_for_delivery', 'delivered'].includes(status)) {
    events.push({
      date: '2026-08-08T09:00:00Z',
      status: 'customs',
      location: `${destinationCity}, MA`,
      description: 'Package arrived at customs - awaiting clearance',
    })
  }

  if (['out_for_delivery', 'delivered'].includes(status)) {
    events.push({
      date: '2026-08-10T07:00:00Z',
      status: 'out_for_delivery',
      location: `${destinationCity}, MA`,
      description: 'Package out for delivery',
    })
  }

  if (status === 'delivered') {
    events.push({
      date: '2026-08-11T14:30:00Z',
      status: 'delivered',
      location: `${destinationCity}, MA`,
      description: 'Package delivered - signed by recipient',
    })
  }

  return JSON.stringify(events)
}

const STATUSES = ['pending', 'label_created', 'in_transit', 'customs', 'delivered']

function pickStatus(idx: number): string {
  // Distribute statuses: ~10% pending, ~15% label_created, ~30% in_transit, ~25% customs, ~20% delivered
  const r = idx % 20
  if (r < 2) return 'pending'
  if (r < 5) return 'label_created'
  if (r < 11) return 'in_transit'
  if (r < 16) return 'customs'
  return 'delivered'
}

function getEstimatedDelivery(status: string, idx: number): Date | null {
  if (status === 'delivered') {
    // Past delivery dates
    const daysAgo = 5 + (idx % 30)
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    return d
  }
  if (status === 'pending' || status === 'label_created') {
    // 2-4 weeks from now
    const d = new Date()
    d.setDate(d.getDate() + 14 + (idx % 14))
    return d
  }
  // in_transit, customs - 3-10 days from now
  const d = new Date()
  d.setDate(d.getDate() + 3 + (idx % 8))
  return d
}

function estimateWeight(itemName: string, quantity: number): number {
  const lower = itemName.toLowerCase()
  if (lower.includes('tv') && lower.includes('65')) return 22 * quantity
  if (lower.includes('tv') && lower.includes('43')) return 12 * quantity
  if (lower.includes('dell') || lower.includes('precision')) return 3.5 * quantity
  if (lower.includes('mini pc')) return 1.5 * quantity
  if (lower.includes('mini-bar') || lower.includes('elexia')) return 18
  if (lower.includes('security camera')) return 3.2
  if (lower.includes('tablet')) return 0.6
  if (lower.includes('oneplus')) return 0.22
  if (lower.includes('kit pause')) return 4.5
  if (lower.includes('wholesale') || lower.includes('bulk') || lower.includes('lot')) return Math.max(2, quantity * 0.3)
  if (lower.includes('coffee') || lower.includes('cafe') || lower.includes('arabica')) return 1.2 * quantity
  if (lower.includes('winston') || lower.includes('panter') || lower.includes('camel')) return 0.3 * quantity
  if (lower.includes('jacket')) return 1.2 * quantity
  if (lower.includes('shoes') || lower.includes('trail')) return 0.9 * quantity
  if (lower.includes('slipper')) return 0.5
  if (lower.includes('perfume') || lower.includes('paco') || lower.includes('mont blanc')) return 0.35 * quantity
  if (lower.includes('sticker')) return 0.15 * quantity
  if (lower.includes('cane')) return 0.4
  if (lower.includes('knife')) return 0.12
  if (lower.includes('health') || lower.includes('nitric') || lower.includes('diabetes')) return 0.5 * quantity
  if (lower.includes('crest') || lower.includes('opalescence')) return 0.15 * quantity
  return 1.0
}

function estimateDimensions(itemName: string): string {
  const lower = itemName.toLowerCase()
  if (lower.includes('tv') && lower.includes('65')) return '150x90x12cm'
  if (lower.includes('tv') && lower.includes('43')) return '105x62x8cm'
  if (lower.includes('dell') || lower.includes('precision')) return '45x35x10cm'
  if (lower.includes('mini pc')) return '25x20x8cm'
  if (lower.includes('mini-bar') || lower.includes('elexia')) return '55x45x45cm'
  if (lower.includes('security camera')) return '40x30x20cm'
  if (lower.includes('tablet')) return '28x20x3cm'
  if (lower.includes('oneplus')) return '18x10x8cm'
  if (lower.includes('kit pause')) return '35x25x15cm'
  if (lower.includes('wholesale') || lower.includes('bulk') || lower.includes('lot')) return '50x40x30cm'
  if (lower.includes('jacket')) return '45x35x12cm'
  if (lower.includes('shoes') || lower.includes('trail')) return '35x25x15cm'
  return '30x20x15cm'
}

// Special purpose overrides for items that need context-dependent purposes
const PURPOSE_OVERRIDES: Record<string, string> = {
  'Opalescence Go teeth whitening': 'Personal care',
  'Crest 3D Whitestrips Professional Effects': 'Personal care',
}

function getPurposeForItem(itemName: string, recipientName: string): string {
  return getPurpose(itemName)
}

// POST /api/supply-chain/seed
export async function POST() {
  try {
    // Guard: check if data already exists
    const existingItems = await db.procurementItem.count()
    if (existingItems > 0) {
      return NextResponse.json({
        success: false,
        error: `Database already has ${existingItems} procurement items. Re-seeding will destroy all status progress. Use the UI confirmation dialog to proceed.`,
        existingItems,
      }, { status: 409 })
    }

    // Step 1: Seed procurement items in-process (avoids self-referential HTTP
    // fetch which fails on serverless/deployed environments where localhost is
    // not the app itself).
    let procurementResult: { created: number; skipped: number } = { created: 0, skipped: 0 }
    const seedResult = await seedProcurement(db)
    procurementResult = {
      created: seedResult.created,
      skipped: seedResult.skipped,
    }

    // Step 2: Fetch all procurement items
    const procurementItems = await db.procurementItem.findMany({
      orderBy: { createdAt: 'asc' },
    })

    // Step 3: Create shipments for every procurement item
    let shipmentsCreated = 0
    let shipmentsSkipped = 0

    for (let i = 0; i < procurementItems.length; i++) {
      const item = procurementItems[i]
      const shipmentNumber = `SHP-2026-${String(i + 1).padStart(3, '0')}`
      const carrier = CARRIERS[i % CARRIERS.length]
      const origin = ORIGINS[i % ORIGINS.length]
      const dest = getDestinationInfo(item.recipientName)
      const status = pickStatus(i)
      const totalValue = item.totalEst

      // Check for duplicate
      const existing = await db.shipment.findUnique({
        where: { shipmentNumber },
      })
      if (existing) {
        shipmentsSkipped++
        continue
      }

      const weightKg = estimateWeight(item.name, item.quantity)
      const dimensions = estimateDimensions(item.name)
      const shippingCost = Math.round((15 + Math.random() * 105) * 100) / 100
      const customsDutyPct = 0.2 + Math.random() * 0.1 // 20-30%
      const customsDutyEst = Math.round(totalValue * customsDutyPct * 100) / 100

      const estDelivery = getEstimatedDelivery(status, i)
      const actualDelivery = status === 'delivered' ? estDelivery : null

      await db.shipment.create({
        data: {
          shipmentNumber,
          procurementItemId: item.id,
          itemName: item.name,
          quantity: item.quantity,
          carrier,
          trackingNumber: generateTrackingNumber(carrier, i + 1),
          trackingVerified: false,
          originCountry: origin.country,
          originCity: origin.city,
          destinationName: item.recipientName,
          destinationAddress: dest.address,
          destinationCountry: 'Morocco',
          destinationCity: dest.city,
          purpose: getPurposeForItem(item.name, item.recipientName),
          status,
          estimatedDelivery: estDelivery,
          actualDelivery,
          weightKg,
          dimensions,
          shippingCost,
          currency: 'USD',
          insuranceValue: totalValue,
          customsDutyEst,
          events: generateEvents(status, origin.city, origin.country, dest.city),
        },
      })
      shipmentsCreated++
    }

    // Step 4: Create 4 stuck MT103 payment records
    const mt103Payments = [
      {
        configLabel: 'Debts',
        amount: 2850.0,
        sourceTxRef: 'MT103-2026-BATCH-001',
        status: 'stuck_in_transition',
        destinationType: 'banking_circle',
        destinationLabel: 'Banking Circle - MT103 Pending',
        ribNumber: '007810000448200061321372',
        failureReason: 'MT103 SWIFT transfer stuck in Banking Circle transition pool - RIB routing not configured for Attijariwafa Compte sur Carnet',
      },
      {
        configLabel: 'Debts',
        amount: 1520.0,
        sourceTxRef: 'MT103-2026-BATCH-002',
        status: 'stuck_in_transition',
        destinationType: 'banking_circle',
        destinationLabel: 'Banking Circle - MT103 Pending',
        ribNumber: '007810000448200061321372',
        failureReason: 'MT103 SWIFT transfer stuck in Banking Circle - intermediary bank returned funds',
      },
      {
        configLabel: 'Debts',
        amount: 940.0,
        sourceTxRef: 'MT103-2026-BATCH-003',
        status: 'stuck_in_transition',
        destinationType: 'banking_circle',
        destinationLabel: 'Banking Circle - MT103 Pending',
        ribNumber: '007810000448200061321372',
        failureReason: 'MT103 SWIFT transfer stuck - recipient bank (BCMAMAMC) not responding to compliance query',
      },
      {
        configLabel: 'Debts',
        amount: 3210.0,
        sourceTxRef: 'MT103-2026-BATCH-004',
        status: 'stuck_in_transition',
        destinationType: 'banking_circle',
        destinationLabel: 'Banking Circle - MT103 Pending',
        ribNumber: '007810000448200061321372',
        failureReason: 'MT103 SWIFT transfer stuck in Banking Circle - AML flag triggered, awaiting manual review',
      },
    ]

    let mt103Created = 0
    let mt103Skipped = 0

    for (const mt of mt103Payments) {
      const existing = await db.ownerPayment.findFirst({
        where: { sourceTxRef: mt.sourceTxRef },
      })
      if (existing) {
        mt103Skipped++
        continue
      }

      // Get the config
      const config = await db.ownerPaymentConfig.findUnique({
        where: { label: mt.configLabel },
      })

      await db.ownerPayment.create({
        data: {
          configId: config?.id || null,
          configLabel: mt.configLabel,
          amount: mt.amount,
          currency: 'USD',
          sourceTxRef: mt.sourceTxRef,
          status: mt.status,
          destinationType: mt.destinationType,
          destinationLabel: mt.destinationLabel,
          ribNumber: mt.ribNumber,
          failureReason: mt.failureReason,
          recovered: false,
        },
      })
      mt103Created++
    }

    return NextResponse.json({
      success: true,
      message: 'Supply chain seed complete',
      procurement: procurementResult,
      shipments: {
        created: shipmentsCreated,
        skipped: shipmentsSkipped,
        total: procurementItems.length,
      },
      mt103Payments: {
        created: mt103Created,
        skipped: mt103Skipped,
      },
    })
  } catch (error) {
    console.error('[POST /api/supply-chain/seed] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to seed supply chain data' },
      { status: 500 }
    )
  }
}
