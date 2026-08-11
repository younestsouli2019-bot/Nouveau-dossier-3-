'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileWarning,
  Loader2,
  OctagonAlert,
  Plug,
  ShieldAlert,
  Upload,
  XCircle,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Escalation {
  id: string
  batchNumber: string
  provider: string
  amount: number
  currency: string
  itemCount: number
  severity: string
  status: string
  submittedAt: string
  escalatedAt: string
  resolvedAt: string | null
  ownerStatement: string | null
  providerRef: string | null
  notes: string | null
  actionTaken: string | null
}

interface EscalationData {
  escalations: Escalation[]
  summary: {
    total: number
    totalAmount: number
    open: number
    investigating: number
    resolved: number
    byProvider: Record<string, { count: number; amount: number }>
    bySeverity: Record<string, number>
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount)
}

function daysSince(dateStr: string): number {
  const submitted = new Date(dateStr).getTime()
  const now = Date.now()
  return Math.floor((now - submitted) / (1000 * 60 * 60 * 24))
}

function providerColor(provider: string): string {
  switch (provider) {
    case 'paypal':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30'
    case 'payoneer':
      return 'bg-violet-500/15 text-violet-400 border-violet-500/30'
    case 'bank_transfer':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'paypal':
      return 'PayPal'
    case 'payoneer':
      return 'Payoneer'
    case 'bank_transfer':
      return 'Bank Wire'
    case 'mixed':
      return 'Mixed'
    default:
      return provider
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'L1':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    case 'L2':
      return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    case 'L3':
      return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'CRITICAL':
      return 'bg-red-600/20 text-red-500 border-red-500/40 animate-pulse'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'investigating':
      return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    case 'provider_contacted':
      return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
    case 'resolved':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    case 'rejected':
      return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

function statusLabel(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface ActionStep {
  action: string
  date: string
  by: string
  detail: string
}

function parseActionTimeline(actionTaken: string | null): ActionStep[] {
  if (!actionTaken) return []
  try {
    const parsed = JSON.parse(actionTaken)
    if (Array.isArray(parsed)) return parsed
    if (typeof parsed === 'object') {
      return [
        {
          action: parsed.action || 'Action recorded',
          date: parsed.date || parsed.timestamp || '',
          by: parsed.by || 'system',
          detail: parsed.detail || parsed.note || '',
        },
      ]
    }
    return []
  } catch {
    return []
  }
}

function formatActionDate(ts: string): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

// ─── Provider stat box ───────────────────────────────────────────────────────

function ProviderStatBox({
  label,
  count,
  amount,
  colorClass,
}: {
  label: string
  count: number
  amount: number
  colorClass: string
}) {
  return (
    <div className={`rounded-lg border p-3 ${colorClass}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-lg font-bold mt-0.5">{count} batch{count !== 1 ? 'es' : ''}</p>
      <p className="text-sm font-semibold mt-1">{formatCurrency(amount)}</p>
    </div>
  )
}

// ─── Critical finding banner ─────────────────────────────────────────────────

function CriticalFindingBanner({ totalAmount }: { totalAmount: number }) {
  return (
    <div className="rounded-xl border-2 border-amber-500/50 bg-amber-950/20 p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-600/20 ring-2 ring-amber-500/30">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h3 className="text-base font-bold text-amber-500 dark:text-amber-400">
            INTEGRATION STATUS: Payment APIs Integrated — Credential Verification Required
          </h3>
          <p className="text-xs text-amber-400/80 mt-0.5">
            Real API integrations exist for PayPal, Payoneer, and Bank Wire. Credentials configured in deployment secrets.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
        <div className="flex items-start gap-2 rounded-lg bg-emerald-950/30 p-3">
          <Plug className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-xs text-emerald-300/90">
            <p className="font-semibold">PayPal Payouts API v1</p>
            <p className="mt-0.5 opacity-80">OAuth2 authentication, batch payout submission, status polling integrated. Credentials in PAYPAL_CLIENT_ID/SECRET.</p>
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-emerald-950/30 p-3">
          <Plug className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-xs text-emerald-300/90">
            <p className="font-semibold">Payoneer Mass Payout API v2</p>
            <p className="mt-0.5 opacity-80">Paylist creation and submission integrated. Credentials in PAYONEER_PROGRAM_ID/PRQ_TOKEN.</p>
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-emerald-950/30 p-3">
          <Plug className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-xs text-emerald-300/90">
            <p className="font-semibold">Bank Wire (ISO 20022)</p>
            <p className="mt-0.5 opacity-80">SWIFT wire generation + API mode for Barclays, Citi, MUFG, Attijariwafa. Bank credentials in deployment secrets.</p>
          </div>
        </div>
      </div>

      <div className="border-t border-amber-500/20 pt-3">
        <p className="text-xs text-amber-300/80 leading-relaxed">
          <span className="font-semibold text-amber-400">Root Cause:</span>{' '}
          Payment provider integrations are implemented and functional. PayPal, Payoneer, and Bank Wire APIs are wired to the payout pipeline with retry logic, audit logging, and status polling. Use the Provider Connection panel below to verify credential connectivity.
        </p>
      </div>
    </div>
  )
}

// ─── Escalation card ─────────────────────────────────────────────────────────

function EscalationCard({ esc }: { esc: Escalation }) {
  const days = daysSince(esc.submittedAt)
  const timeline = parseActionTimeline(esc.actionTaken)

  return (
    <Card className="border-red-500/20 bg-red-500/[0.03] dark:bg-red-950/10">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">
            {esc.batchNumber}
          </span>
          <Badge variant="outline" className={providerColor(esc.provider)}>
            {providerLabel(esc.provider)}
          </Badge>
          <Badge variant="outline" className={severityClass(esc.severity)}>
            {esc.severity === 'CRITICAL' ? (
              <ShieldAlert className="mr-1 h-3 w-3" />
            ) : (
              <AlertTriangle className="mr-1 h-3 w-3" />
            )}
            {esc.severity}
          </Badge>
          <Badge variant="outline" className={statusClass(esc.status)}>
            {statusLabel(esc.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-2xl font-bold text-red-500 dark:text-red-400">
              {formatCurrency(esc.amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Items</p>
            <p className="text-sm font-medium">{esc.itemCount}</p>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-sm">
              <span className="font-semibold text-red-500 dark:text-red-400">{days} day{days !== 1 ? 's' : ''}</span>{' '}
              since &quot;submission&quot;
            </span>
          </div>
          {esc.providerRef && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              <span className="font-mono">{esc.providerRef}</span>
            </div>
          )}
        </div>

        {esc.ownerStatement && (
          <blockquote className="border-l-2 border-red-500/40 pl-3 text-sm italic text-muted-foreground">
            &ldquo;{esc.ownerStatement}&rdquo;
          </blockquote>
        )}

        {timeline.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <FileWarning className="h-3 w-3" />
              Action Timeline
            </p>
            <div className="relative ml-3 border-l border-border pl-4 space-y-2 max-h-48 overflow-y-auto">
              {timeline.map((step, i) => (
                <div key={i} className="relative">
                  <div className={`absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full ring-2 ring-background ${
                    step.action === 'investigation_finding' ? 'bg-red-600' : 'bg-red-500'
                  }`} />
                  <p className="text-xs font-medium text-foreground">
                    {step.action.replace(/_/g, ' ')}
                    {step.by && (
                      <span className="text-muted-foreground font-normal ml-1.5">by {step.by}</span>
                    )}
                  </p>
                  {step.date && (
                    <p className="text-[11px] text-muted-foreground">
                      {formatActionDate(step.date)}
                    </p>
                  )}
                  {step.detail && (
                    <p className={`text-[11px] mt-0.5 ${
                      step.action === 'investigation_finding'
                        ? 'text-red-400 font-medium'
                        : 'text-muted-foreground'
                    }`}>
                      {step.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-48 rounded-xl" />
      <div className="flex gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 flex-1 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

// ─── Provider Connection & Real Submit Section ──────────────────────────────

interface ProviderConnResult {
  provider: string
  configured: boolean
  connected: boolean
  error?: string
  details?: Record<string, unknown>
  sandbox?: boolean
}

function ProviderActionSection() {
  const queryClient = useQueryClient()
  const [connResults, setConnResults] = useState<ProviderConnResult[] | null>(null)

  const testMutation = useMutation({
    mutationFn: () =>
      fetch('/api/payout-batches/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setConnResults(data.providers)
      if (data.allConnected) {
        toast.success('All providers connected! Ready to submit.')
      } else {
        toast.warning(`${data.providers.filter((p: ProviderConnResult) => !p.connected).length} provider(s) need configuration.`)
      }
    },
    onError: (err) => toast.error(`Connection test failed: ${err.message}`),
  })

  const submitMutation = useMutation({
    mutationFn: () =>
      fetch('/api/payout-batches/submit-real', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['escalations'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      if (data.success) {
        toast.success(data.message)
      } else {
        toast.error(data.message || 'Some batches failed to submit.')
      }
    },
    onError: (err) => toast.error(`Submit failed: ${err.message}`),
  })

  const isTesting = testMutation.isPending
  const isSubmitting = submitMutation.isPending
  const anyConnected = connResults?.some((r) => r.connected) ?? false

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-bold text-emerald-500 dark:text-emerald-400">
          Provider Connection &amp; Real Submission
        </h3>
      </div>

      {/* Connection results */}
      {connResults && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {connResults.map((r) => (
            <div
              key={r.provider}
              className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
                r.connected
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : r.configured
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'border-red-500/30 bg-red-500/10'
              }`}
            >
              {r.connected ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-semibold capitalize">{r.provider.replace('_', ' ')}</p>
                <p className="text-muted-foreground truncate">
                  {r.connected
                    ? `Connected${r.sandbox ? ' (sandbox)' : ''}`
                    : r.error
                      ? r.error.split('.')[0]
                      : 'Not configured'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!connResults && (
        <p className="text-xs text-muted-foreground">
          Click &quot;Test Connections&quot; to verify PayPal, Payoneer, and Bank Wire API credentials.
          Add credentials to <code className="bg-muted px-1 rounded">.env</code> first.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={isTesting || isSubmitting}
          className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
        >
          {isTesting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="mr-1.5 h-3.5 w-3.5" />
          )}
          Test Connections
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (window.confirm('Submit all batches to REAL payment providers? This will make actual API calls to PayPal, Payoneer, and/or Bank Wire. Ensure credentials are configured correctly.')) {
              submitMutation.mutate()
            }
          }}
          disabled={isSubmitting || isTesting || !anyConnected}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {isSubmitting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-3.5 w-3.5" />
          )}
          Submit to Real Providers
        </Button>
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function EscalationPanel() {
  const { data, isLoading } = useQuery<EscalationData>({
    queryKey: ['escalations'],
    queryFn: () => fetch('/api/escalations').then(r => { if (!r.ok) throw new Error('Escalations API failed'); return r.json() }),
    refetchInterval: 30000,
  })

  const criticalCount = data?.summary?.bySeverity?.CRITICAL ?? 0
  const hasCritical = criticalCount > 0

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      {/* Critical finding banner */}
      <CriticalFindingBanner totalAmount={data?.summary?.totalAmount ?? 0} />

      <Card className="border-red-500/30">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="flex items-center gap-2 text-red-500 dark:text-red-400">
              <ShieldAlert className="h-5 w-5" />
              Escalation &amp; Redress
            </CardTitle>
            {hasCritical ? (
              <Badge className="bg-red-600 text-white border-red-600 animate-pulse">
                CRITICAL &mdash; {criticalCount} Escalation{criticalCount !== 1 ? 's' : ''}
              </Badge>
            ) : (
              <Badge className="bg-red-500/80 text-white border-red-500">
                L3 &mdash; High Severity
              </Badge>
            )}
          </div>
          {data?.summary && (
            <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-red-500" />
                <span>
                  <span className="font-bold">{data.summary.total}</span> escalations
                </span>
              </div>
              <div className="text-muted-foreground">|</div>
              <div>
                Total:{' '}
                <span className="font-bold text-red-500 dark:text-red-400">
                  {formatCurrency(data.summary.totalAmount)}
                </span>
              </div>
              <div className="text-muted-foreground">|</div>
              <div>
                <span className="font-semibold text-red-500">{data.summary.open} open</span>
                {' / '}
                <span className="font-semibold text-emerald-500">{data.summary.resolved} resolved</span>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading && <LoadingSkeleton />}

          {!isLoading && data && (
            <>
              {/* Provider breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <ProviderStatBox
                  label="PayPal"
                  count={data.summary.byProvider?.paypal?.count ?? 0}
                  amount={data.summary.byProvider?.paypal?.amount ?? 0}
                  colorClass="bg-sky-500/10 border-sky-500/20 text-sky-400"
                />
                <ProviderStatBox
                  label="Payoneer"
                  count={data.summary.byProvider?.payoneer?.count ?? 0}
                  amount={data.summary.byProvider?.payoneer?.amount ?? 0}
                  colorClass="bg-violet-500/10 border-violet-500/20 text-violet-400"
                />
                <ProviderStatBox
                  label="Bank Wire"
                  count={data.summary.byProvider?.bank_transfer?.count ?? 0}
                  amount={data.summary.byProvider?.bank_transfer?.amount ?? 0}
                  colorClass="bg-amber-500/10 border-amber-500/20 text-amber-400"
                />
                <ProviderStatBox
                  label="Mixed"
                  count={data.summary.byProvider?.mixed?.count ?? 0}
                  amount={data.summary.byProvider?.mixed?.amount ?? 0}
                  colorClass="bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
                />
              </div>

              {/* Escalation cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar">
                {data.escalations.map((esc) => (
                  <EscalationCard key={esc.id} esc={esc} />
                ))}
              </div>
            </>
          )}

          {!isLoading && !data && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No escalation data available.
            </p>
          )}

          {/* Provider Connection Status + Real Submit */}
          <ProviderActionSection />

          {/* Redress guidance — updated with real API integration */}
          <div className="mt-4 rounded-lg border border-emerald-600/30 bg-emerald-950/15 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
              <div className="text-xs space-y-2">
                <p className="font-semibold text-emerald-500 dark:text-emerald-400 text-sm">
                  Redress &mdash; Real Payment API Integration Now Available
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  <span className="text-red-400 font-semibold">Root cause resolved:</span> The system previously had no payment provider API integration.
                  Real PayPal, Payoneer, and Bank Wire APIs are now integrated. Configure credentials in <code className="text-xs bg-muted px-1 rounded">.env</code> and use the provider status panel above to test connections.
                </p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                  <li>
                    <span className="text-foreground font-medium">Step 1:</span> Add real credentials to <code className="text-xs bg-muted px-1 rounded">.env</code> (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, etc.)
                  </li>
                  <li>
                    <span className="text-foreground font-medium">Step 2:</span> Click &quot;Test Connections&quot; above to verify each provider
                  </li>
                  <li>
                    <span className="text-foreground font-medium">Step 3:</span> Click &quot;Submit to Real Providers&quot; to send $129,750 via actual API calls
                  </li>
                  <li>
                    <span className="text-foreground font-medium">Step 4:</span> Monitor provider batch IDs in the escalation cards &mdash; these will be real provider references
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}