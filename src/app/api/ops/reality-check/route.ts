import { NextResponse } from 'next/server'
import { runRealityScan, autoFixFindings } from '@/lib/reality-scanner'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const scan = await runRealityScan()
    return NextResponse.json({ success: true, scan })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Scan failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { autoFix?: boolean }
    const scan = await runRealityScan()

    if (body.autoFix) {
      const result = await autoFixFindings(scan.findings)
      return NextResponse.json({ success: true, scan, fixed: result.fixed, reverts: result.reverts })
    }

    return NextResponse.json({ success: true, scan, fixed: null, message: 'Send {"autoFix": true} to auto-fix critical fabrications' })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Auto-fix failed' }, { status: 500 })
  }
}
