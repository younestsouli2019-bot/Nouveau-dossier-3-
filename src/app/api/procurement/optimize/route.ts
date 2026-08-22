// ——— Procurement Optimization API ———
// POST /api/procurement/optimize
//
// Runs the full optimization pipeline:
//   1. Dedup duplicate items
//   2. Local sourcing alternatives
//   3. Bulk discounts
//   4. PO recalculation
//   5. Cancel empty POs
//
// idempotent — safe to re-run
// ——————————————————————————————————————————

import { NextResponse } from 'next/server'
import { runOptimization } from '@/lib/procurement'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const report = await runOptimization()

    return NextResponse.json({
      success: true,
      ...report,
    })
  } catch (error) {
    console.error('[Procurement Optimize]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Optimization failed' },
      { status: 500 }
    )
  }
}
