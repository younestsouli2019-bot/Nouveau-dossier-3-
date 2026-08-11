// ——— Self-Connector ———
// Discovers payment providers and the supplier network, validates their
// configuration, and establishes live/sandbox connections. The connector
// never moves funds — it only verifies that real rails exist and are reachable.

import { db } from '@/lib/db'
import { healthCheckAll } from '@/lib/payment-providers'
import { getProviderConfig } from '@/lib/payment-providers'
import { getAttijariConfig } from '@/lib/payment-providers/attijari'
import { runPsd2Connectivity } from '@/lib/psd2'
import type { AgentRun, AgentStepResult, ProviderConnectivity } from './types'

const PROVIDERS = ['paypal', 'payoneer', 'bank_transfer', 'attijari'] as const

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now()
  const result = await fn()
  return { result, durationMs: Date.now() - start }
}

export async function discoverProviderConnectivity(): Promise<ProviderConnectivity[]> {
  const health = await healthCheckAll()

  const connectivity: ProviderConnectivity[] = []

  for (const provider of PROVIDERS) {
    const config = getProviderConfig(provider)
    const sandbox = (config as { sandbox?: boolean } | null)?.sandbox ?? true
    const enabled = (config as { enabled?: boolean } | null)?.enabled ?? false
    const h = health[provider as 'paypal' | 'payoneer' | 'bank_transfer' | 'attijari']

    connectivity.push({
      provider,
      configured: config !== null,
      enabled,
      connected: h.available,
      mode: !config ? 'unconfigured' : h.available ? (sandbox ? 'sandbox' : 'live') : 'unreachable',
      latencyMs: h.latencyMs,
      details: h.details,
      error: h.error,
    })
  }

  return connectivity
}

export async function runConnector(): Promise<AgentRun> {
  const start = Date.now()
  const steps: AgentStepResult[] = []

  const connectivityStep = await time(discoverProviderConnectivity)
  const liveCount = connectivityStep.result.filter((c) => c.mode === 'live').length
  const sandboxCount = connectivityStep.result.filter((c) => c.mode === 'sandbox').length
  const unconfigured = connectivityStep.result.filter((c) => c.mode === 'unconfigured').map((c) => c.provider)
  steps.push({
    step: 'connect_payment_providers',
    status: unconfigured.length === 4 ? 'warn' : liveCount > 0 || sandboxCount > 0 ? 'ok' : 'warn',
    itemsAffected: connectivityStep.result.length,
    details: `live=${liveCount}, sandbox=${sandboxCount}, unconfigured=[${unconfigured.join(', ') || 'none'}]`,
    durationMs: connectivityStep.durationMs,
  })

  const supplierStep = await time(async () => {
    const suppliers = await db.supplier.findMany({ where: { isActive: true } })
    const countries = [...new Set(suppliers.map((s) => s.country).filter(Boolean))]
    return { suppliers, countries }
  })
  steps.push({
    step: 'connect_supplier_network',
    status: supplierStep.result.suppliers.length > 0 ? 'ok' : 'warn',
    itemsAffected: supplierStep.result.suppliers.length,
    details: `${supplierStep.result.suppliers.length} active suppliers across [${supplierStep.result.countries.join(', ') || 'none'}]`,
    durationMs: supplierStep.durationMs,
  })

  const attijari = getAttijariConfig()
  steps.push({
    step: 'verify_attijari_config',
    status: attijari ? 'ok' : 'warn',
    itemsAffected: attijari ? 1 : 0,
    details: attijari
      ? `Attijari configured (${attijari.sandbox ? 'sandbox' : 'live'} mode, ${attijari.enabled ? 'enabled' : 'disabled'})`
      : 'Attijari not configured — set ATTIJARI_CLIENT_ID / ATTIJARI_CLIENT_SECRET / ATTIJARI_API_BASE_URL',
    durationMs: 0,
  })

  const psd2Step = await time(runPsd2Connectivity)
  const enabledBanks = psd2Step.result.filter((r) => r.enabled)
  const healthyBanks = psd2Step.result.filter((r) => r.healthy)
  steps.push({
    step: 'connect_psd2_banks',
    status: enabledBanks.length === 0 ? 'skipped' : healthyBanks.length > 0 ? 'ok' : 'warn',
    itemsAffected: psd2Step.result.length,
    details:
      enabledBanks.length === 0
        ? 'No enabled PSD2 banks in registry'
        : psd2Step.result
            .filter((r) => r.enabled)
            .map((r) => `${r.bankId}=${r.healthy ? 'healthy' : r.configured ? r.error ?? 'unhealthy' : 'unconfigured'}`)
            .join(', '),
    durationMs: psd2Step.durationMs,
  })

  return {
    phase: 'connect',
    status: steps.some((s) => s.status === 'error') ? 'error' : 'success',
    steps,
    startedAt: new Date(start).toISOString(),
    durationMs: Date.now() - start,
  }
}
