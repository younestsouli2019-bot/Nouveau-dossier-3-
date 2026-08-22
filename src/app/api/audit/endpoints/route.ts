import { NextResponse } from 'next/server'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-dynamic'

interface EndpointAuditReport {
  endpoint: string
  method: string
  hasExternalProof: boolean
  requiredTriggers: string[]
  status: 'PASSED' | 'KILLED_FABRICATION' | 'WARNING'
  category: string
}

const REQUIRED_EXTERNAL_TRIGGERS = [
  'verify_tx_hash',
  'blockchain_client',
  'bank_gateway',
  'ledger_proof',
  'externalRef',
  'proofType',
  'proofHash',
  'providerBatchId',
  'providerTxId',
  'settleStrict',
  'strictMarkAsSettled',
  'strictIngestRevenue',
  'submitPayoutToProvider',
  'confirmReceipt',
]

const FABRICATION_PATTERNS = [
  { pattern: /status\s*[=:]\s*['"]completed['"]/, label: 'direct_completed_status' },
  { pattern: /simulate.*payout|payout.*simulate/i, label: 'payout_simulation' },
  { pattern: /instant.*settle|settle.*instant/i, label: 'instant_settlement' },
  { pattern: /status\s*=\s*['"]completed['"]\s*(?:;|\)|})/, label: 'hardcoded_completed' },
]

function scanSourceForTriggers(source: string): string[] {
  return REQUIRED_EXTERNAL_TRIGGERS.filter(t => source.includes(t))
}

function detectFabricationPatterns(source: string): string[] {
  const matches: string[] = []
  for (const { pattern, label } of FABRICATION_PATTERNS) {
    if (pattern.test(source)) matches.push(label)
  }
  return matches
}

const ENDPOINT_CATEGORIES: Record<string, string> = {
  '/create': 'write',
  '/update': 'write',
  '/delete': 'write',
  '/submit': 'financial',
  '/settle': 'financial',
  '/payout': 'financial',
  '/approve': 'financial',
  '/receipt': 'procurement',
  '/reconcile': 'audit',
  '/verify': 'verification',
  '/seed': 'migration',
  '/fix': 'migration',
  '/resubmit': 'financial',
}

function categorizeEndpoint(path: string): string {
  for (const [pattern, category] of Object.entries(ENDPOINT_CATEGORIES)) {
    if (path.includes(pattern)) return category
  }
  return 'general'
}

export async function GET() {
  try {
    const report: EndpointAuditReport[] = []

    async function scanDirectory(dir: string): Promise<void> {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await scanDirectory(fullPath)
        } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
          try {
            const content = await readFile(fullPath, 'utf-8')

            const routePath = fullPath
              .replace(/.*src[\\/]app/, '')
              .replace(/[\\/]route\.[jt]s$/, '')
              .replace(/\\/g, '/')
              .replace(/\[([^\]]+)\]/g, ':$1')

            const triggers = scanSourceForTriggers(content)
            const fabPatterns = detectFabricationPatterns(content)
            const hasExternalProof = triggers.length >= 2
            const category = categorizeEndpoint(routePath)

            const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
              .filter(m => content.includes(`export async function ${m}`))

            for (const method of methods) {
              let status: EndpointAuditReport['status'] = 'PASSED'
              if (fabPatterns.length > 0 && !hasExternalProof) {
                status = 'KILLED_FABRICATION'
              } else if (fabPatterns.length > 0 && hasExternalProof) {
                status = 'WARNING'
              } else if (category === 'financial' && !hasExternalProof) {
                status = 'WARNING'
              }

              report.push({
                endpoint: routePath,
                method,
                hasExternalProof,
                requiredTriggers: triggers,
                status,
                category,
              })
            }
          } catch {
            continue
          }
        }
      }
    }

    const srcApiDir = join(process.cwd(), 'src', 'app', 'api')
    await scanDirectory(srcApiDir)

    const passed = report.filter(r => r.status === 'PASSED').length
    const killed = report.filter(r => r.status === 'KILLED_FABRICATION').length
    const warnings = report.filter(r => r.status === 'WARNING').length
    const financialNoProof = report.filter(
      r => r.category === 'financial' && !r.hasExternalProof
    )

    return NextResponse.json({
      success: true,
      summary: {
        totalEndpoints: report.length,
        passed,
        killedFabrications: killed,
        warnings,
        financialWithoutProof: financialNoProof.length,
      },
      fabricationEndpoints: report.filter(r => r.status === 'KILLED_FABRICATION'),
      financialWarnings: financialNoProof,
      allEndpoints: report,
      verdict: killed === 0 && financialNoProof.length === 0
        ? 'ALL_ENDPOINTS_COMPLIANT'
        : 'FABRICATION_DETECTED',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Audit/Endpoints]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
