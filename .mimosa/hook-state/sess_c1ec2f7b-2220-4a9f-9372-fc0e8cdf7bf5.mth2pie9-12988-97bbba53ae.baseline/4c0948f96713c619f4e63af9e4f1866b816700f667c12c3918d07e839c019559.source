import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const BACHIR_ADDRESS = '45 Avenue Ibn Sina Agdal Rabat Appt 4'
const YOUNES_ADDRESS = 'Lot. Rita LOT C Im B, APT 17 BOUZNIKA, CASABLANCA SETTAT 13100'

// Items that were wrongly assigned to Younes but belong to Bachir
const ITEMS_TO_REROUTE: { name: string; correctRecipient: string; correctAddress: string }[] = [
  {
    name: 'Nitric oxide natural stimulation pack',
    correctRecipient: 'M Bachir Tsouli',
    correctAddress: BACHIR_ADDRESS,
  },
  {
    name: 'Premium orthopedic slippers',
    correctRecipient: 'M Bachir Tsouli',
    correctAddress: BACHIR_ADDRESS,
  },
  {
    name: 'Paco Rabanne perfume',
    correctRecipient: 'M Bachir Tsouli',
    correctAddress: BACHIR_ADDRESS,
  },
  {
    name: 'Tablet CR 10.1" Android 16 2-in-1 GMS',
    correctRecipient: 'M Bachir Tsouli',
    correctAddress: BACHIR_ADDRESS,
  },
  {
    name: 'Diabetes pack',
    correctRecipient: 'M Bachir Tsouli',
    correctAddress: BACHIR_ADDRESS,
  },
  {
    name: 'Stylish cane',
    correctRecipient: 'M Bachir Tsouli',
    correctAddress: BACHIR_ADDRESS,
  },
]

// Duplicate entry that should NOT exist for Bachir (Opalescence belongs to Younes only)
const DUPLICATES_TO_REMOVE: { name: string; wrongRecipient: string }[] = [
  {
    name: 'Opalescence Go teeth whitening',
    wrongRecipient: 'M Bachir Tsouli',
  },
]

// POST /api/procurement/fix-recipients - Fix misrouted procurement items and rebuild shipments
export async function POST() {
  try {
    const results: { action: string; item: string; detail: string }[] = []

    // 1. Re-route misassigned items from Younes → Bachir
    for (const reroute of ITEMS_TO_REROUTE) {
      const wrongEntry = await db.procurementItem.findFirst({
        where: {
          name: reroute.name,
          recipientName: 'Younes Tsouli',
        },
      })

      if (wrongEntry) {
        // Check if correct entry already exists
        const correctEntry = await db.procurementItem.findFirst({
          where: {
            name: reroute.name,
            recipientName: reroute.correctRecipient,
          },
        })

        if (correctEntry) {
          // Delete the wrong duplicate
          await db.procurementItem.delete({ where: { id: wrongEntry.id } })
          results.push({
            action: 'deleted_duplicate',
            item: reroute.name,
            detail: `Removed wrong Younes entry, correct Bachir entry already exists`,
          })
        } else {
          // Update in-place
          await db.procurementItem.update({
            where: { id: wrongEntry.id },
            data: {
              recipientName: reroute.correctRecipient,
              recipientAddress: reroute.correctAddress,
              deliveryAddress: reroute.correctAddress,
            },
          })
          results.push({
            action: 'rerouted',
            item: reroute.name,
            detail: `Younes Tsouli → ${reroute.correctRecipient} (${reroute.correctAddress})`,
          })
        }
      } else {
        // Check if already correct
        const correctEntry = await db.procurementItem.findFirst({
          where: {
            name: reroute.name,
            recipientName: reroute.correctRecipient,
          },
        })
        if (correctEntry) {
          results.push({
            action: 'already_correct',
            item: reroute.name,
            detail: `Already assigned to ${reroute.correctRecipient}`,
          })
        } else {
          results.push({
            action: 'not_found',
            item: reroute.name,
            detail: `No procurement item found with this name`,
          })
        }
      }
    }

    // 2. Remove duplicate Opalescence for Bachir (belongs to Younes only)
    for (const dup of DUPLICATES_TO_REMOVE) {
      const duplicate = await db.procurementItem.findFirst({
        where: {
          name: dup.name,
          recipientName: dup.wrongRecipient,
        },
      })

      if (duplicate) {
        await db.procurementItem.delete({ where: { id: duplicate.id } })
        results.push({
          action: 'removed_duplicate',
          item: `${dup.name} (${dup.wrongRecipient})`,
          detail: `Duplicate removed — this item belongs to Younes Tsouli only`,
        })
      } else {
        results.push({
          action: 'no_duplicate',
          item: `${dup.name} (${dup.wrongRecipient})`,
          detail: `No duplicate found (already clean)`,
        })
      }
    }

    // 3. Delete ALL existing shipments so they get rebuilt from correct procurement data
    const deletedShipments = await db.shipment.deleteMany({})
    results.push({
      action: 'shipments_cleared',
      item: 'All shipments',
      detail: `${deletedShipments.count} shipments deleted for rebuild`,
    })

    return NextResponse.json({
      success: true,
      message: `Recipient routing fixed: ${results.length} operations performed. Re-seed supply chain to rebuild shipments.`,
      results,
    })
  } catch (error) {
    console.error('[POST /api/procurement/fix-recipients] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fix recipient routing' },
      { status: 500 }
    )
  }
}
