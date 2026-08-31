import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Supplier definitions
const SUPPLIER_DEFS = [
  {
    code: 'VEN-TEMU',
    name: 'TEMU',
    website: 'https://www.temu.com',
    country: 'China',
    paymentTerms: 'prepaid',
  },
  {
    code: 'VEN-AMAZON',
    name: 'Amazon',
    website: 'https://www.amazon.com',
    country: 'USA',
    paymentTerms: 'prepaid',
  },
  {
    code: 'VEN-ALIEXPRESS',
    name: 'AliExpress',
    website: 'https://www.aliexpress.com',
    country: 'China',
    paymentTerms: 'prepaid',
  },
  {
    code: 'VEN-SUPERFOOD',
    name: 'SuperFood',
    website: 'https://superfood.ma/',
    country: 'Morocco',
    contactEmail: 'contact@superfood.ma',
    paymentTerms: 'cod',
  },
  {
    code: 'VEN-LOCAL-ELEC',
    name: 'Local Electronics',
    country: 'Morocco',
    paymentTerms: 'cod',
  },
]

// Items that should be sourced from TEMU (low-cost, accessories, wholesale lots, home)
const TEMU_ITEM_PATTERNS = [
  'Winston Filter', 'Panter Mignon', 'Panter CAFE', 'Camel Yellow',
  'Brosse Electrique', 'Pistolet Mousseur', 'Mini-Bar ELEXIA',
  'Kit Pause Café', 'Kitchen sink splash', 'Football player stickers',
  'Football theme stickers', 'Creative wall storage', 'Creative ashtray',
  'Camera accessories', 'Mini Phone 2G', 'Pocket knife',
  '3D printed box opener', 'Marble wallpaper', 'USB sticks 16GB',
  'Wireless mouse bulk', 'Bluetooth earbuds bulk', 'Portable power banks',
  'USB-C cables bulk', 'Wireless charging pads', 'Bluetooth speakers mini',
  'LED light strips', 'Laptop cooling pads', 'Car phone holders',
  'USB hub adapters', 'Wholesale electronics lot',
  'Kricely trail shoes', 'Brandit M-65', 'Mil-Tec US Tactical',
]

// Items that should be from Amazon (high-value, branded electronics)
const AMAZON_ITEM_PATTERNS = [
  'Dell Precision', 'Televiseur SAMSUNG SMART TV UHD 65',
  'OnePlus 15', 'Security cameras', 'Good value mini PC',
  'BARRE DE SON SAMSUNG', 'TV SAMSUNG UHD SMART 43',
]

// Items that should be from AliExpress (mid-range, some electronics)
const ALIEXPRESS_ITEM_PATTERNS = [
  'Dash Cam TOTNG', 'Crest 3D Whitestrips', 'Opalescence Go',
  'Tablet CR 10.1', 'Paco Rabanne', 'Mont Blanc Legend',
  'Stylish cane', 'Premium orthopedic slippers',
  'Natural NAC', 'CAFE PUR ARABICA',
]

function classifySupplier(itemName: string): string | null {
  const name = itemName.toLowerCase()
  for (const p of TEMU_ITEM_PATTERNS) {
    if (name.includes(p.toLowerCase())) return 'TEMU'
  }
  for (const p of AMAZON_ITEM_PATTERNS) {
    if (name.includes(p.toLowerCase())) return 'Amazon'
  }
  for (const p of ALIEXPRESS_ITEM_PATTERNS) {
    if (name.includes(p.toLowerCase())) return 'AliExpress'
  }
  // Items with superfood.ma as supplierName
  if (name.includes('superfood')) return 'SuperFood'
  // Health items go to SuperFood
  if (name.includes('diabetes') || name.includes('nitric oxide')) return 'SuperFood'
  return null
}

export async function POST() {
  try {
    // === Check if POs already exist (idempotency) ===
    const existingPO = await db.purchaseOrder.findFirst()
    if (existingPO) {
      const poCount = await db.purchaseOrder.count()
      const supplierCount = await db.supplier.count()
      return NextResponse.json({
        success: true,
        message: `Already seeded: ${supplierCount} suppliers, ${poCount} POs exist. Skipping.`,
        suppliers: supplierCount,
        purchaseOrders: poCount,
        skipped: true,
      })
    }

    // === Step 1: Create Suppliers ===
    const suppliers: Record<string, { id: string; name: string }> = {}
    for (const def of SUPPLIER_DEFS) {
      const supplier = await db.supplier.upsert({
        where: { code: def.code },
        update: {},
        create: def,
      })
      suppliers[supplier.name] = { id: supplier.id, name: supplier.name }
    }

    // === Step 2: Assign supplierName to items that don't have one ===
    const allItems = await db.procurementItem.findMany({
      where: { purchaseOrderId: null },
    })

    for (const item of allItems) {
      const assigned = classifySupplier(item.name)
      if (assigned && !item.supplierName) {
        await db.procurementItem.update({
          where: { id: item.id },
          data: {
            supplierName: assigned,
            supplierId: suppliers[assigned]?.id || null,
          },
        })
      } else if (item.supplierName && item.supplierName.includes('superfood')) {
        // Fix existing superfood items
        await db.procurementItem.update({
          where: { id: item.id },
          data: {
            supplierName: 'SuperFood',
            supplierId: suppliers['SuperFood']?.id || null,
          },
        })
      }
    }

    // === Step 3: Re-fetch items with updated supplierName ===
    const items = await db.procurementItem.findMany()

    // === Step 4: Group items into POs ===

    // PO-2026-001: All TEMU items
    const temuItems = items.filter(
      (i) => i.supplierName && /temu/i.test(i.supplierName)
    )

    // PO-2026-002: Electronics/IT items for Younes Tsouli (not Temu)
    const younesElecItems = items.filter(
      (i) =>
        i.recipientName === 'Younes Tsouli' &&
        !/temu/i.test(i.supplierName || '') &&
        (i.category === 'electronics' || i.category === 'it_equipment' || i.category === 'wholesale_lot')
    )

    // PO-2026-003: Items for Mrs Hind Tsouli
    const hindItems = items.filter(
      (i) => i.recipientName === 'Mrs Hind Tsouli'
    )

    // PO-2026-004: Health + food items
    const healthFoodItems = items.filter(
      (i) => i.category === 'health' || i.category === 'food'
    )

    // Build PO definitions
    const poDefs = [
      {
        poNumber: 'PO-2026-001',
        title: 'TEMU Bulk & Accessories Order',
        supplierName: 'TEMU',
        supplierId: suppliers['TEMU']?.id || null,
        status: 'approved',
        approvedBy: 'Younes Tsouli',
        items: temuItems,
      },
      {
        poNumber: 'PO-2026-002',
        title: 'Electronics & IT Equipment for Younes',
        supplierName: 'Amazon',
        supplierId: suppliers['Amazon']?.id || null,
        status: 'pending_approval',
        approvedBy: null,
        items: younesElecItems,
      },
      {
        poNumber: 'PO-2026-003',
        title: 'Mrs Hind Tsouli Personal Items',
        supplierName: 'Amazon',
        supplierId: suppliers['Amazon']?.id || null,
        status: 'approved',
        approvedBy: 'Younes Tsouli',
        items: hindItems,
      },
      {
        poNumber: 'PO-2026-004',
        title: 'Health & Food Supplies',
        supplierName: 'SuperFood',
        supplierId: suppliers['SuperFood']?.id || null,
        status: 'draft',
        approvedBy: null,
        items: healthFoodItems,
      },
    ]

    const createdPOs: string[] = []
    const linkedItemCount: number[] = []

    for (const poDef of poDefs) {
      const totalAmount = poDef.items.reduce(
        (sum, i) => sum + (i.totalEst || 0),
        0
      )

      const po = await db.purchaseOrder.create({
        data: {
          poNumber: poDef.poNumber,
          title: poDef.title,
          supplierName: poDef.supplierName,
          supplierId: poDef.supplierId,
          status: poDef.status,
          priority: poDef.items.some((i) => i.priority === 'high') ? 'high' : 'normal',
          currency: 'USD',
          lineItemCount: poDef.items.length,
          totalAmount: Math.round(totalAmount * 100) / 100,
          approvedBy: poDef.approvedBy,
          approvedAt: poDef.approvedBy ? new Date() : null,
          submittedAt: poDef.status !== 'draft' ? new Date() : null,
        },
      })

      createdPOs.push(poDef.poNumber)

      // Link items to PO
      for (let idx = 0; idx < poDef.items.length; idx++) {
        const item = poDef.items[idx]
        await db.procurementItem.update({
          where: { id: item.id },
          data: {
            purchaseOrderId: po.id,
            poLineItem: idx + 1,
            supplierId: poDef.supplierId || undefined,
          },
        })
      }
      linkedItemCount.push(poDef.items.length)

      // === Step 5: Create POApproval record ===
      if (poDef.status === 'approved' && poDef.approvedBy) {
        await db.pOApproval.create({
          data: {
            purchaseOrderId: po.id,
            action: 'approved',
            performedBy: poDef.approvedBy,
            fromStatus: 'pending_approval',
            toStatus: 'approved',
            reason: 'Auto-approved during workflow seed',
          },
        })
      } else if (poDef.status === 'pending_approval') {
        await db.pOApproval.create({
          data: {
            purchaseOrderId: po.id,
            action: 'submitted',
            performedBy: 'Younes Tsouli',
            fromStatus: 'draft',
            toStatus: 'pending_approval',
            reason: 'Submitted for approval during workflow seed',
          },
        })
      }
    }

    // Update supplier stats
    for (const def of SUPPLIER_DEFS) {
      const supplierItems = await db.procurementItem.findMany({
        where: { supplierId: suppliers[def.name]?.id },
      })
      const supplierPOs = await db.purchaseOrder.findMany({
        where: { supplierId: suppliers[def.name]?.id },
      })
      await db.supplier.update({
        where: { code: def.code },
        data: {
          totalOrders: supplierPOs.length,
          totalSpend: supplierPOs.reduce((s, p) => s + (p.totalAmount || 0), 0),
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Workflow seed complete',
      suppliers: Object.keys(suppliers).length,
      purchaseOrders: createdPOs.length,
      poDetails: createdPOs.map((po, i) => ({
        poNumber: po,
        items: linkedItemCount[i],
      })),
    })
  } catch (error) {
    console.error('[POST /api/procurement/seed-workflow] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to seed workflow' },
      { status: 500 }
    )
  }
}
