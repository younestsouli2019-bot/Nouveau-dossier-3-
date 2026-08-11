import { NextResponse } from 'next/server'
import { getAgenticStatus } from '@/lib/agentic'
import { inspectEnvironment, generateDotenvExample } from '@/lib/agentic/self-configurator'
import { discoverProviderConnectivity } from '@/lib/agentic/self-connector'
import { getPsd2Health } from '@/lib/psd2'

/**
 * GET /api/ops/agentic/status
 * Returns provider connectivity, PSD2 bank health, last agentic runs,
 * config manifest, and a generated .env.example template (safe, no secrets).
 */
export async function GET() {
  try {
    const [status, connectivity, manifest, psd2] = await Promise.all([
      getAgenticStatus(),
      discoverProviderConnectivity(),
      inspectEnvironment(),
      getPsd2Health(),
    ])

    return NextResponse.json({
      success: true,
      providers: connectivity,
      psd2: psd2,
      config: manifest,
      envExample: generateDotenvExample(manifest),
      lastRuns: status.lastRuns,
      latestSnapshot: status.latestSnapshot,
      memory: status.memory,
    })
  } catch (error) {
    console.error('Error reading agentic status:', error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
