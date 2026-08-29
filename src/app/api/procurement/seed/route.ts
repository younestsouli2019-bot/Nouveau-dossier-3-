import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const HIND_ADDRESS = 'Etage 2 JASMIN II IMM H3 APPT 21 SIDI-YAHYA-ZAIR 12150'
const YOUNES_ADDRESS = 'Lot. Rita LOT C Im B, APT 17 BOUZNIKA, CASABLANCA SETTAT 13100'
const BACHIR_ADDRESS = '45 Avenue Ibn Sina Agdal Rabat Appt 4'

interface SeedItem {
  name: string
  brand?: string | null
  reference?: string | null
  category: string
  quantity: number
  unitPriceEst: number
  recipientName: string
  recipientAddress: string
  priority: string
  supplier?: string | null
  notes?: string | null
}

const SEED_DATA: SeedItem[] = [
  // === Mrs Hind Tsouli ===
  {
    name: 'TV SAMSUNG UHD SMART 43\"',
    brand: 'SAMSUNG',
    reference: 'UA43U8000FUXM',
    category: 'electronics',
    quantity: 1,
    unitPriceEst: 350,
    recipientName: 'Mrs Hind Tsouli',
    recipientAddress: HIND_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'BARRE DE SON SAMSUNG 2.0',
    brand: 'SAMSUNG',
    reference: 'HW-B400F/MV',
    category: 'electronics',
    quantity: 1,
    unitPriceEst: 100,
    recipientName: 'Mrs Hind Tsouli',
    recipientAddress: HIND_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Dash Cam TOTNG 1080P/720P dual camera 170° wide angle',
    brand: 'TOTNG',
    category: 'automotive',
    quantity: 1,
    unitPriceEst: 45,
    recipientName: 'Mrs Hind Tsouli',
    recipientAddress: HIND_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Brosse Electrique Rotative 5-en-1 USB rechargeable',
    category: 'home',
    quantity: 1,
    unitPriceEst: 35,
    recipientName: 'Mrs Hind Tsouli',
    recipientAddress: HIND_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Pistolet Mousseur Haute Pression with long handle',
    category: 'home',
    quantity: 1,
    unitPriceEst: 25,
    recipientName: 'Mrs Hind Tsouli',
    recipientAddress: HIND_ADDRESS,
    priority: 'normal',
  },

  // === Younes Tsouli ===
  {
    name: 'Dell Precision 3541 with 4TB mounted',
    brand: 'Dell',
    category: 'it_equipment',
    quantity: 2,
    unitPriceEst: 2500,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'high',
  },
  {
    name: 'Winston Filter Soft',
    category: 'tobacco',
    quantity: 20,
    unitPriceEst: 5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Panter Mignon',
    category: 'tobacco',
    quantity: 5,
    unitPriceEst: 5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Panter CAFE CREME ORIGINAL',
    category: 'tobacco',
    quantity: 5,
    unitPriceEst: 6,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Camel Yellow Soft Filters',
    category: 'tobacco',
    quantity: 5,
    unitPriceEst: 6,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'CAFE PUR ARABICA 1KG BALI',
    category: 'food',
    quantity: 3,
    unitPriceEst: 15,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Mini-Bar ELEXIA',
    reference: 'RM004',
    category: 'furniture',
    quantity: 1,
    unitPriceEst: 60,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
    notes: '48x52x41cm',
  },
  {
    name: 'Televiseur SAMSUNG SMART TV UHD 65\"',
    brand: 'SAMSUNG',
    category: 'electronics',
    quantity: 1,
    unitPriceEst: 550,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'high',
  },
  {
    name: 'Kit Pause Café Gold',
    category: 'kitchen',
    quantity: 1,
    unitPriceEst: 170,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Good value mini PC and monitor',
    category: 'it_equipment',
    quantity: 1,
    unitPriceEst: 300,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'high',
  },
  {
    name: 'Security cameras for shop pack',
    category: 'electronics',
    quantity: 1,
    unitPriceEst: 200,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Pack Legumes Frais Maroc + fresh fish pack 5kg',
    category: 'food',
    quantity: 1,
    unitPriceEst: 30,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Kricely trail shoes EU 49 / US 13 Yellow & camouflage',
    brand: 'Kricely',
    category: 'sports',
    quantity: 2,
    unitPriceEst: 60,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Brandit M-65 Giant Jacket Olive 2XL',
    brand: 'Brandit',
    category: 'clothing',
    quantity: 1,
    unitPriceEst: 90,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Mil-Tec US Tactical Flight Jacket Black 2XL',
    brand: 'Mil-Tec',
    category: 'clothing',
    quantity: 1,
    unitPriceEst: 80,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Kitchen sink splash protectors',
    category: 'kitchen',
    quantity: 8,
    unitPriceEst: 8,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Football player stickers',
    category: 'accessories',
    quantity: 54,
    unitPriceEst: 0.5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Football theme stickers pack 1',
    category: 'accessories',
    quantity: 50,
    unitPriceEst: 0.5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Football theme stickers pack 2',
    category: 'accessories',
    quantity: 50,
    unitPriceEst: 0.5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Creative wall storage box no-drill',
    category: 'home',
    quantity: 4,
    unitPriceEst: 15,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Creative wall storage box set 2',
    category: 'home',
    quantity: 4,
    unitPriceEst: 15,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Creative ashtray',
    category: 'home',
    quantity: 1,
    unitPriceEst: 10,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Camera accessories multipack 110pcs',
    category: 'accessories',
    quantity: 2,
    unitPriceEst: 15,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Mini Phone 2G Dual SIM',
    category: 'telecom',
    quantity: 1,
    unitPriceEst: 20,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Pocket knife foldable',
    category: 'accessories',
    quantity: 1,
    unitPriceEst: 10,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: '3D printed box opener',
    category: 'accessories',
    quantity: 2,
    unitPriceEst: 5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Marble wallpaper roll 500x40cm',
    category: 'home',
    quantity: 3,
    unitPriceEst: 12,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'OnePlus 15 5G',
    brand: 'OnePlus',
    category: 'electronics',
    quantity: 1,
    unitPriceEst: 900,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'high',
  },
  {
    name: 'Natural NAC alternatives',
    category: 'health',
    quantity: 1,
    unitPriceEst: 25,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'high',
  },
  {
    name: 'Crest 3D Whitestrips Professional Effects',
    brand: 'Crest',
    category: 'beauty',
    quantity: 1,
    unitPriceEst: 40,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Opalescence Go teeth whitening',
    brand: 'Opalescence',
    category: 'beauty',
    quantity: 1,
    unitPriceEst: 35,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Wholesale electronics lot ($10 or less items)',
    category: 'wholesale_lot',
    quantity: 50,
    unitPriceEst: 10,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'USB sticks 16GB bulk',
    category: 'wholesale_lot',
    quantity: 20,
    unitPriceEst: 5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Wireless mouse bulk',
    category: 'wholesale_lot',
    quantity: 20,
    unitPriceEst: 5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Bluetooth earbuds bulk',
    category: 'wholesale_lot',
    quantity: 20,
    unitPriceEst: 8,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Portable power banks bulk',
    category: 'wholesale_lot',
    quantity: 15,
    unitPriceEst: 7,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'USB-C cables bulk',
    category: 'wholesale_lot',
    quantity: 30,
    unitPriceEst: 3,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Wireless charging pads bulk',
    category: 'wholesale_lot',
    quantity: 15,
    unitPriceEst: 6,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Bluetooth speakers mini bulk',
    category: 'wholesale_lot',
    quantity: 15,
    unitPriceEst: 7,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'LED light strips bulk',
    category: 'wholesale_lot',
    quantity: 20,
    unitPriceEst: 5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Laptop cooling pads bulk',
    category: 'wholesale_lot',
    quantity: 10,
    unitPriceEst: 6,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Car phone holders bulk',
    category: 'wholesale_lot',
    quantity: 20,
    unitPriceEst: 4,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'USB hub adapters bulk',
    category: 'wholesale_lot',
    quantity: 15,
    unitPriceEst: 5,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Tablet CR 10.1\" Android 16 2-in-1 GMS',
    brand: 'CR',
    category: 'electronics',
    quantity: 1,
    unitPriceEst: 120,
    recipientName: 'M Bachir Tsouli',
    recipientAddress: BACHIR_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Paco Rabanne perfume',
    brand: 'Paco Rabanne',
    category: 'beauty',
    quantity: 1,
    unitPriceEst: 80,
    recipientName: 'M Bachir Tsouli',
    recipientAddress: BACHIR_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Mont Blanc Legend perfume',
    brand: 'Mont Blanc',
    category: 'beauty',
    quantity: 1,
    unitPriceEst: 70,
    recipientName: 'Younes Tsouli',
    recipientAddress: YOUNES_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Stylish cane',
    category: 'accessories',
    quantity: 1,
    unitPriceEst: 30,
    recipientName: 'M Bachir Tsouli',
    recipientAddress: BACHIR_ADDRESS,
    priority: 'normal',
  },
  {
    name: 'Premium orthopedic slippers',
    category: 'clothing',
    quantity: 1,
    unitPriceEst: 45,
    recipientName: 'M Bachir Tsouli',
    recipientAddress: BACHIR_ADDRESS,
    priority: 'normal',
  },

  // === M Bachir Tsouli ===
  // (Items for M Bachir Tsouli are listed above with correct routing)

  // === Health items (recipient: M Bachir Tsouli) ===
  {
    name: 'Nitric oxide natural stimulation pack',
    category: 'health',
    quantity: 1,
    unitPriceEst: 40,
    recipientName: 'M Bachir Tsouli',
    recipientAddress: BACHIR_ADDRESS,
    priority: 'high',
    supplier: 'https://superfood.ma/',
  },
  {
    name: 'Diabetes pack',
    category: 'health',
    quantity: 1,
    unitPriceEst: 50,
    recipientName: 'M Bachir Tsouli',
    recipientAddress: BACHIR_ADDRESS,
    priority: 'high',
    supplier: 'https://superfood.ma/',
  },
]

// POST /api/procurement/seed - Seed database with procurement items
export async function POST() {
  try {
    let created = 0
    let skipped = 0
    const skippedItems: string[] = []

    for (const item of SEED_DATA) {
      // Check if item already exists by name + recipient
      const existing = await db.procurementItem.findFirst({
        where: {
          name: item.name,
          recipientName: item.recipientName,
        },
      })

      if (existing) {
        skipped++
        skippedItems.push(`${item.name} (${item.recipientName})`)
        continue
      }

      await db.procurementItem.create({
        data: {
          name: item.name,
          brand: item.brand || null,
          reference: item.reference || null,
          category: item.category,
          quantity: item.quantity,
          unitPriceEst: item.unitPriceEst,
          totalEst: item.quantity * item.unitPriceEst,
          currency: 'USD',
          recipientName: item.recipientName,
          recipientAddress: item.recipientAddress,
          deliveryAddress: item.recipientAddress,
          prePaidBySwarm: true,
          ownerInitiated: true,
          status: 'pending',
          priority: item.priority,
          supplierName: item.supplier || null,
          notes: item.notes || null,
        },
      })
      created++
    }

    return NextResponse.json({
      success: true,
      message: `Seed complete: ${created} created, ${skipped} skipped (already exist)`,
      created,
      skipped,
      skippedItems: skippedItems.length > 0 ? skippedItems : undefined,
    })
  } catch (error) {
    console.error('[POST /api/procurement/seed] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to seed procurement items' },
      { status: 500 }
    )
  }
}
