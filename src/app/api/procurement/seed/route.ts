import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedProcurement } from '@/lib/procurement/seed-data'

// POST /api/procurement/seed - Seed database with procurement items
export async function POST() {
  try {
    const { created, skipped, skippedItems } = await seedProcurement(db)

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
