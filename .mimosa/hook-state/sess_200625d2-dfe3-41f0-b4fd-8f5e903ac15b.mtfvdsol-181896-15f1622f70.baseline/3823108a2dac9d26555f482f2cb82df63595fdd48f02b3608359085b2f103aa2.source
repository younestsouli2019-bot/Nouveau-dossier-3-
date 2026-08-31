export type ProviderState = 'healthy' | 'degraded' | 'quarantined' | 'recovering'

export interface ProviderHealth {
  id: string
  state: ProviderState
  failureCount: number
  lastFailure: number | null
  unblockAt: number | null
  enabled: boolean
  priority: number
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const FAILURE_THRESHOLD = 3
const QUARANTINE_429_MS = 5 * MINUTE_MS
const BACKOFF_STEP_MS = 5 * MINUTE_MS

const SEED_PROVIDERS: ReadonlyArray<{ id: string; priority: number }> = [
  { id: 'openrouter', priority: 1 },
  { id: 'zai', priority: 2 },
]

const providers = new Map<string, ProviderHealth>(
  SEED_PROVIDERS.map(
    (seed): [string, ProviderHealth] => [
      seed.id,
      {
        id: seed.id,
        state: 'healthy',
        failureCount: 0,
        lastFailure: null,
        unblockAt: null,
        enabled: true,
        priority: seed.priority,
      },
    ]
  )
)

function quarantineDuration(errorCode: string | undefined, failureCount: number): number | null {
  if (errorCode === 'USER_BLOCKED') return null
  if (errorCode === '401' || errorCode === '403') return HOUR_MS
  if (errorCode === '429') return QUARANTINE_429_MS
  return failureCount * BACKOFF_STEP_MS
}

export function getProviderHealth(id: string): ProviderHealth | undefined {
  return providers.get(id)
}

export function getHealthyProviders(): ProviderHealth[] {
  return [...providers.values()]
    .filter((p) => p.state === 'healthy' || p.state === 'recovering')
    .sort((a, b) => a.priority - b.priority)
}

export function quarantineProvider(id: string, unblockAt?: number): void {
  const provider = providers.get(id)
  if (!provider) return
  provider.state = 'quarantined'
  provider.unblockAt = unblockAt ?? null
}

export function reportFailure(id: string, errorCode?: string): void {
  const provider = providers.get(id)
  if (!provider) return
  const now = Date.now()
  provider.failureCount += 1
  provider.lastFailure = now
  if (errorCode !== 'USER_BLOCKED' && provider.failureCount < FAILURE_THRESHOLD) {
    provider.state = 'degraded'
    return
  }
  const durationMs = quarantineDuration(errorCode, provider.failureCount)
  quarantineProvider(id, durationMs === null ? undefined : now + durationMs)
}

export function reportSuccess(id: string): void {
  const provider = providers.get(id)
  if (!provider) return
  provider.state = 'healthy'
  provider.failureCount = 0
  provider.lastFailure = null
  provider.unblockAt = null
}

export function checkUnblocks(): void {
  const now = Date.now()
  for (const provider of providers.values()) {
    if (provider.state !== 'quarantined' || provider.unblockAt === null) continue
    if (now >= provider.unblockAt) {
      provider.state = 'recovering'
      provider.unblockAt = null
    }
  }
}

export function getProviderStatus(): Record<string, ProviderHealth> {
  return Object.fromEntries(providers)
}
